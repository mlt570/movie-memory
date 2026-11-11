import { prisma } from "@/lib/prisma";

export { prisma };

export async function resetDatabase() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "FactGenerationLock", "MovieFact", "Session", "Account", "User" CASCADE',
  );
}

export function createUser(email: string, favoriteMovie: string | null = "Inception") {
  return prisma.user.create({ data: { email, name: email.split("@")[0], favoriteMovie } });
}

/** A controllable clock for testing the 60-second window. */
export function createFakeClock(start = new Date("2026-01-01T12:00:00.000Z")) {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
}

/** A promise that can be resolved from outside, to hold a "slow OpenAI call" open. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
