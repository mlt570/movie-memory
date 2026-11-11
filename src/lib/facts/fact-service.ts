import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

/** A fact younger than this is served from the DB instead of calling OpenAI. */
export const FACT_CACHE_WINDOW_MS = 60_000;

/**
 * How long a "generation in progress" lease lasts. Must comfortably exceed the
 * worst-case OpenAI call (see lib/openai.ts) so a live holder never loses its
 * lease; if the holder crashes, the lease simply expires and can be taken over.
 */
export const FACT_LOCK_TTL_MS = 30_000;

/** When a request has no fact to show and another request is generating one, it polls for the result. */
export const WAIT_POLL_INTERVAL_MS = 500;
export const WAIT_MAX_ATTEMPTS = 30; // ~15s, longer than one OpenAI call

export type Fact = {
  id: string;
  movie: string;
  content: string;
  createdAt: Date;
};

/**
 * - "cache":     a fact less than 60s old (no OpenAI call was made)
 * - "generated": a brand-new fact from OpenAI
 * - "stale":     the most recent fact, older than 60s, returned because a new
 *                one couldn't be produced right now (OpenAI failed, or another
 *                request is already generating it)
 */
export type FactSource = "cache" | "generated" | "stale";

export type FactResult = { fact: Fact; source: FactSource };

export class NoFavoriteMovieError extends Error {
  constructor() {
    super("User has not chosen a favorite movie yet");
    this.name = "NoFavoriteMovieError";
  }
}

/** No fact can be shown: generation failed (or is still running elsewhere) and nothing is cached. */
export class FactUnavailableError extends Error {
  constructor(public readonly reason: "generation_failed" | "busy") {
    super(`No fact available (${reason})`);
    this.name = "FactUnavailableError";
  }
}

export type FactServiceDeps = {
  db: PrismaClient;
  generateFact: (movie: string) => Promise<string>;
  /** Injectable clock so the 60s window can be tested deterministically. */
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  logError?: (message: string, error: unknown) => void;
};

const FACT_SELECT = { id: true, movie: true, content: true, createdAt: true } as const;

export function createFactService({
  db,
  generateFact,
  now = () => new Date(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  logError = (message, error) => console.error(message, error),
}: FactServiceDeps) {
  // -- Queries --------------------------------------------------------------
  // Every query is scoped by userId. The userId always comes from the server
  // session (never from the request), so one user can't read another's facts.

  function findLatestFact(userId: string, movie: string): Promise<Fact | null> {
    return db.movieFact.findFirst({
      where: { userId, movie },
      orderBy: { createdAt: "desc" },
      select: FACT_SELECT,
    });
  }

  function isFresh(fact: Fact): boolean {
    return now().getTime() - fact.createdAt.getTime() < FACT_CACHE_WINDOW_MS;
  }

  // -- Generation lease ("generation in progress" flag) ---------------------

  /** Returns a lease token if we acquired the lock, or null if someone else holds it. */
  async function tryAcquireLock(userId: string, movie: string): Promise<string | null> {
    const token = randomUUID();
    const currentTime = now();
    const lockedUntil = new Date(currentTime.getTime() + FACT_LOCK_TTL_MS);

    // Fast path: no lock row exists. The composite primary key guarantees only
    // one concurrent insert can succeed; the others get a unique violation.
    try {
      await db.factGenerationLock.create({ data: { userId, movie, token, lockedUntil } });
      return token;
    } catch (error) {
      const isUniqueViolation =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
      if (!isUniqueViolation) throw error;
    }

    // A lock row exists. Take it over only if its lease has expired (holder
    // crashed). Postgres re-checks the WHERE clause after acquiring the row
    // lock, so if several requests race here, exactly one update matches.
    const { count } = await db.factGenerationLock.updateMany({
      where: { userId, movie, lockedUntil: { lt: currentTime } },
      data: { token, lockedUntil },
    });
    return count === 1 ? token : null;
  }

  async function releaseLock(userId: string, movie: string, token: string): Promise<void> {
    // Matching on the token means we never delete a lease someone else holds.
    await db.factGenerationLock.deleteMany({ where: { userId, movie, token } });
  }

  async function isLockHeld(userId: string, movie: string): Promise<boolean> {
    const lock = await db.factGenerationLock.findUnique({
      where: { userId_movie: { userId, movie } },
      select: { lockedUntil: true },
    });
    return lock !== null && lock.lockedUntil > now();
  }

  // -- Public API -----------------------------------------------------------

  async function getFactForUser(userId: string): Promise<FactResult> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { favoriteMovie: true },
    });
    if (!user?.favoriteMovie) throw new NoFavoriteMovieError();
    const movie = user.favoriteMovie;

    // 1. Cache hit: the newest fact is younger than 60 seconds.
    const latest = await findLatestFact(userId, movie);
    if (latest && isFresh(latest)) return { fact: latest, source: "cache" };

    // 2. Cache miss: only one request per (user, movie) may call OpenAI.
    const token = await tryAcquireLock(userId, movie);
    if (!token) return waitForConcurrentGeneration(userId, movie, latest);

    try {
      // Double-check after locking: another request may have generated and
      // released between our read above and acquiring the lock.
      const current = await findLatestFact(userId, movie);
      if (current && isFresh(current)) return { fact: current, source: "cache" };

      let content: string;
      try {
        content = await generateFact(movie);
      } catch (error) {
        // 3. OpenAI failed: fall back to the most recent fact, if any.
        logError("Fact generation failed", error);
        if (current) return { fact: current, source: "stale" };
        throw new FactUnavailableError("generation_failed");
      }

      const fact = await db.movieFact.create({
        data: { userId, movie, content, createdAt: now() },
        select: FACT_SELECT,
      });
      return { fact, source: "generated" };
    } finally {
      await releaseLock(userId, movie, token);
    }
  }

  /**
   * Another request is generating a fact for this user + movie right now.
   * - If we have an older fact, return it immediately rather than making the
   *   user wait; the next request will see the new one.
   * - If this is the very first fact (nothing to show), poll briefly for the
   *   other request's result.
   */
  async function waitForConcurrentGeneration(
    userId: string,
    movie: string,
    latest: Fact | null,
  ): Promise<FactResult> {
    if (latest) return { fact: latest, source: "stale" };

    for (let attempt = 0; attempt < WAIT_MAX_ATTEMPTS; attempt++) {
      await sleep(WAIT_POLL_INTERVAL_MS);

      const fact = await findLatestFact(userId, movie);
      if (fact) return { fact, source: "cache" };

      if (!(await isLockHeld(userId, movie))) {
        // The holder stores its fact *before* releasing the lock, so re-read
        // once: it may have finished between our two queries above.
        const finalFact = await findLatestFact(userId, movie);
        if (finalFact) return { fact: finalFact, source: "cache" };
        // The other request finished without storing a fact: it failed.
        throw new FactUnavailableError("generation_failed");
      }
    }
    throw new FactUnavailableError("busy");
  }

  return { getFactForUser };
}

export type FactService = ReturnType<typeof createFactService>;
