import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FACT_CACHE_WINDOW_MS,
  FACT_LOCK_TTL_MS,
  FactUnavailableError,
  NoFavoriteMovieError,
  createFactService,
} from "@/lib/facts/fact-service";
import { createFakeClock, createUser, deferred, prisma, resetDatabase } from "./helpers";

function setup(options: { sleep?: (ms: number) => Promise<void> } = {}) {
  const clock = createFakeClock();
  let counter = 0;
  const generateFact = vi.fn(async (movie: string) => `Fact #${++counter} about ${movie}`);
  const service = createFactService({
    db: prisma,
    generateFact,
    now: clock.now,
    sleep: options.sleep ?? (() => new Promise((resolve) => setTimeout(resolve, 5))),
    logError: () => {},
  });
  return { clock, generateFact, service };
}

beforeEach(resetDatabase);

describe("60-second cache window", () => {
  it("generates and stores a fact when none exists", async () => {
    const { service, generateFact } = setup();
    const user = await createUser("a@example.com");

    const result = await service.getFactForUser(user.id);

    expect(result.source).toBe("generated");
    expect(result.fact.content).toBe("Fact #1 about Inception");
    expect(generateFact).toHaveBeenCalledTimes(1);
    expect(await prisma.movieFact.count({ where: { userId: user.id } })).toBe(1);
  });

  it("returns the cached fact while it is less than 60 seconds old", async () => {
    const { service, generateFact, clock } = setup();
    const user = await createUser("a@example.com");
    const first = await service.getFactForUser(user.id);

    clock.advance(FACT_CACHE_WINDOW_MS - 1); // 59.999s later
    const second = await service.getFactForUser(user.id);

    expect(second.source).toBe("cache");
    expect(second.fact.id).toBe(first.fact.id);
    expect(generateFact).toHaveBeenCalledTimes(1);
  });

  it("generates a new fact once the latest one is 60 seconds old", async () => {
    const { service, generateFact, clock } = setup();
    const user = await createUser("a@example.com");
    const first = await service.getFactForUser(user.id);

    clock.advance(FACT_CACHE_WINDOW_MS); // exactly 60s: no longer "less than 60s old"
    const second = await service.getFactForUser(user.id);

    expect(second.source).toBe("generated");
    expect(second.fact.id).not.toBe(first.fact.id);
    expect(generateFact).toHaveBeenCalledTimes(2);
    expect(await prisma.movieFact.count({ where: { userId: user.id } })).toBe(2);
  });

  it("caches per movie: a fresh fact for a previous movie is not reused", async () => {
    const { service, generateFact } = setup();
    const user = await createUser("a@example.com", "Inception");
    await service.getFactForUser(user.id);

    await prisma.user.update({ where: { id: user.id }, data: { favoriteMovie: "Heat" } });
    const result = await service.getFactForUser(user.id);

    expect(result.source).toBe("generated");
    expect(result.fact.movie).toBe("Heat");
    expect(generateFact).toHaveBeenLastCalledWith("Heat", expect.any(AbortSignal));
  });
});

describe("burst / concurrency protection", () => {
  it("generates only one fact when many first requests arrive at once", async () => {
    const gate = deferred<string>();
    // The first time a request has to wait, let the in-flight generation finish.
    const { service, generateFact } = setup({
      sleep: async () => {
        gate.resolve("The only fact");
        await new Promise((resolve) => setTimeout(resolve, 5));
      },
    });
    generateFact.mockImplementation(() => gate.promise);
    const user = await createUser("a@example.com");

    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.getFactForUser(user.id)),
    );

    expect(generateFact).toHaveBeenCalledTimes(1);
    expect(new Set(results.map((r) => r.fact.id)).size).toBe(1);
    expect(results.filter((r) => r.source === "generated")).toHaveLength(1);
    expect(await prisma.movieFact.count()).toBe(1);
  });

  it("serves the previous fact to concurrent requests while one regenerates", async () => {
    const { service, generateFact, clock } = setup();
    const user = await createUser("a@example.com");
    const old = await service.getFactForUser(user.id);
    clock.advance(FACT_CACHE_WINDOW_MS + 1);

    const gate = deferred<string>();
    generateFact.mockImplementation(() => gate.promise);
    const pending = Array.from({ length: 5 }, () => service.getFactForUser(user.id));
    setTimeout(() => gate.resolve("A brand new fact"), 50);
    const results = await Promise.all(pending);

    expect(generateFact).toHaveBeenCalledTimes(2); // 1 initial + 1 for the burst
    expect(results.filter((r) => r.source === "generated")).toHaveLength(1);
    for (const r of results.filter((r) => r.source !== "generated")) {
      expect(r.source).toBe("refreshing");
      expect(r.fact.id).toBe(old.fact.id);
    }
    expect(await prisma.movieFact.count()).toBe(2);
  });

  it("takes over an expired lock left behind by a crashed request", async () => {
    const { service, generateFact, clock } = setup();
    const user = await createUser("a@example.com");
    await prisma.factGenerationLock.create({
      data: {
        userId: user.id,
        movie: "Inception",
        token: "crashed-request",
        lockedUntil: new Date(clock.now().getTime() - 1),
      },
    });

    const result = await service.getFactForUser(user.id);

    expect(result.source).toBe("generated");
    expect(generateFact).toHaveBeenCalledTimes(1);
    expect(await prisma.factGenerationLock.count()).toBe(0); // released afterwards
  });

  it("re-checks the cache after locking, so a request that raced a finished generation doesn't generate again", async () => {
    const { clock, generateFact } = setup();
    const user = await createUser("a@example.com");
    await prisma.movieFact.create({
      data: { userId: user.id, movie: "Inception", content: "Old", createdAt: clock.now() },
    });
    clock.advance(FACT_CACHE_WINDOW_MS + 1);

    // Simulate another request finishing its generation right after this
    // request's first read (which saw only the stale fact) and before it locks.
    let raced = false;
    const racingDb = new Proxy(prisma, {
      get(target, prop, receiver) {
        if (prop !== "movieFact") return Reflect.get(target, prop, receiver);
        return {
          ...target.movieFact,
          findFirst: async (args: Parameters<typeof target.movieFact.findFirst>[0]) => {
            const result = await target.movieFact.findFirst(args);
            if (!raced) {
              raced = true;
              await target.movieFact.create({
                data: { userId: user.id, movie: "Inception", content: "Fresh from the other request", createdAt: clock.now() },
              });
            }
            return result;
          },
          create: target.movieFact.create.bind(target.movieFact),
        };
      },
    }) as typeof prisma;
    const service = createFactService({ db: racingDb, generateFact, now: clock.now, logError: () => {} });

    const result = await service.getFactForUser(user.id);

    expect(result).toMatchObject({ source: "cache", fact: { content: "Fresh from the other request" } });
    expect(generateFact).not.toHaveBeenCalled();
  });

  it("a holder whose lease expired never releases the lease a newer request took over", async () => {
    const { service, generateFact, clock } = setup();
    const user = await createUser("a@example.com");
    const slowA = deferred<string>();
    const slowB = deferred<string>();
    generateFact.mockImplementationOnce(() => slowA.promise).mockImplementationOnce(() => slowB.promise);

    const requestA = service.getFactForUser(user.id);
    await vi.waitFor(() => expect(generateFact).toHaveBeenCalledTimes(1));

    clock.advance(FACT_LOCK_TTL_MS + 1); // A's lease expires (e.g. A is stuck)
    const requestB = service.getFactForUser(user.id);
    await vi.waitFor(() => expect(generateFact).toHaveBeenCalledTimes(2)); // B took over

    slowA.resolve("A's late fact");
    await requestA;
    const lock = await prisma.factGenerationLock.findFirstOrThrow();
    expect(lock.lockedUntil.getTime()).toBe(clock.now().getTime() + FACT_LOCK_TTL_MS); // B's lease survives

    slowB.resolve("B's fact");
    await requestB;
    expect(await prisma.factGenerationLock.count()).toBe(0);
  });

  it("gives up with a 'busy' error if another request holds the lock for too long", async () => {
    const { service, generateFact, clock } = setup({ sleep: async () => {} });
    const user = await createUser("a@example.com");
    await prisma.factGenerationLock.create({
      data: {
        userId: user.id,
        movie: "Inception",
        token: "other-request",
        lockedUntil: new Date(clock.now().getTime() + FACT_LOCK_TTL_MS),
      },
    });

    const error = await service.getFactForUser(user.id).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FactUnavailableError);
    expect((error as FactUnavailableError).reason).toBe("busy");
    expect(generateFact).not.toHaveBeenCalled();
  });
});

describe("OpenAI failure handling", () => {
  it("returns the most recent fact when generation fails", async () => {
    const { service, generateFact, clock } = setup();
    const user = await createUser("a@example.com");
    const old = await service.getFactForUser(user.id);
    clock.advance(FACT_CACHE_WINDOW_MS * 5);

    generateFact.mockRejectedValueOnce(new Error("OpenAI timeout"));
    const result = await service.getFactForUser(user.id);

    expect(result.source).toBe("stale");
    expect(result.fact.id).toBe(old.fact.id);
  });

  it("throws a FactUnavailableError when generation fails and nothing is cached", async () => {
    const { service, generateFact } = setup();
    const user = await createUser("a@example.com");
    generateFact.mockRejectedValueOnce(new Error("OpenAI 500"));

    const error = await service.getFactForUser(user.id).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FactUnavailableError);
    expect((error as FactUnavailableError).reason).toBe("generation_failed");
    expect(await prisma.movieFact.count()).toBe(0);
  });

  it("releases the lock after a failure so the next request can retry", async () => {
    const { service, generateFact } = setup();
    const user = await createUser("a@example.com");
    generateFact.mockRejectedValueOnce(new Error("OpenAI 500"));
    await service.getFactForUser(user.id).catch(() => {});

    const result = await service.getFactForUser(user.id);

    expect(result.source).toBe("generated");
    expect(await prisma.factGenerationLock.count()).toBe(0);
  });

  it("enforces a hard deadline on generation, even if the generator hangs", async () => {
    const clock = createFakeClock();
    let receivedSignal: AbortSignal | undefined;
    const generateFact = vi.fn((_movie: string, signal: AbortSignal) => {
      receivedSignal = signal;
      return new Promise<string>(() => {}); // never settles
    });
    const service = createFactService({
      db: prisma,
      generateFact,
      generationTimeoutMs: 50,
      now: clock.now,
      logError: () => {},
    });
    const user = await createUser("a@example.com");

    const error = await service.getFactForUser(user.id).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FactUnavailableError);
    expect(receivedSignal?.aborted).toBe(true); // the OpenAI request gets cancelled
    expect(await prisma.factGenerationLock.count()).toBe(0);
  });

  it("still returns a generated fact if releasing the lock fails", async () => {
    const { clock, generateFact } = setup();
    const user = await createUser("a@example.com");
    const flakyDb = new Proxy(prisma, {
      get(target, prop, receiver) {
        if (prop !== "factGenerationLock") return Reflect.get(target, prop, receiver);
        return {
          create: target.factGenerationLock.create.bind(target.factGenerationLock),
          deleteMany: async () => {
            throw new Error("connection reset");
          },
        };
      },
    }) as typeof prisma;
    const logError = vi.fn();
    const service = createFactService({ db: flakyDb, generateFact, now: clock.now, logError });

    const result = await service.getFactForUser(user.id);

    expect(result.source).toBe("generated");
    expect(logError).toHaveBeenCalledWith("Failed to release fact generation lock", expect.any(Error));
  });

  it("tells waiting requests when the in-flight generation failed", async () => {
    const gate = deferred<string>();
    const { service, generateFact } = setup({
      sleep: async () => {
        gate.reject(new Error("OpenAI down"));
        await new Promise((resolve) => setTimeout(resolve, 5));
      },
    });
    generateFact.mockImplementation(() => gate.promise);
    const user = await createUser("a@example.com");

    const results = await Promise.allSettled([
      service.getFactForUser(user.id),
      service.getFactForUser(user.id),
    ]);

    expect(generateFact).toHaveBeenCalledTimes(1);
    for (const r of results) {
      expect(r.status).toBe("rejected");
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(FactUnavailableError);
    }
  });
});

describe("authorization / data isolation", () => {
  it("never returns another user's fact, even for the same movie", async () => {
    const { service, generateFact } = setup();
    const alice = await createUser("alice@example.com", "Inception");
    const bob = await createUser("bob@example.com", "Inception");
    generateFact.mockResolvedValueOnce("Bob's private fact");
    const bobsFact = await service.getFactForUser(bob.id);

    // Bob's fact is fresh and for the same movie, but Alice must get her own.
    generateFact.mockResolvedValueOnce("Alice's fact");
    const alicesFact = await service.getFactForUser(alice.id);

    expect(alicesFact.source).toBe("generated");
    expect(alicesFact.fact.id).not.toBe(bobsFact.fact.id);
    expect(alicesFact.fact.content).toBe("Alice's fact");
    const stored = await prisma.movieFact.findUniqueOrThrow({ where: { id: alicesFact.fact.id } });
    expect(stored.userId).toBe(alice.id);
  });

  it("refuses to generate facts for a user without a favorite movie", async () => {
    const { service, generateFact } = setup();
    const user = await createUser("new@example.com", null);

    await expect(service.getFactForUser(user.id)).rejects.toBeInstanceOf(NoFavoriteMovieError);
    expect(generateFact).not.toHaveBeenCalled();
  });
});
