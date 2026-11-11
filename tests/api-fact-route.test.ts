import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUser, prisma, resetDatabase } from "./helpers";

// Replace only the edges: who is signed in, and what OpenAI returns.
// Everything in between (route handler, fact service, Postgres) is real.
vi.mock("@/lib/auth", () => ({ getSessionUserId: vi.fn() }));
vi.mock("@/lib/openai", () => ({ generateMovieFact: vi.fn() }));

const { getSessionUserId } = await import("@/lib/auth");
const { generateMovieFact } = await import("@/lib/openai");
const { GET } = await import("@/app/api/fact/route");

const signInAs = (userId: string | null) => vi.mocked(getSessionUserId).mockResolvedValue(userId);

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(generateMovieFact).mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/fact", () => {
  it("returns 401 and does no work when not signed in", async () => {
    signInAs(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Please sign in." },
    });
    expect(generateMovieFact).not.toHaveBeenCalled();
  });

  it("only ever returns the signed-in user's own facts", async () => {
    const alice = await createUser("alice@example.com", "Alien");
    const bob = await createUser("bob@example.com", "Alien");
    await prisma.movieFact.create({
      data: { userId: bob.id, movie: "Alien", content: "Bob's secret fact" },
    });
    vi.mocked(generateMovieFact).mockResolvedValue("Alice's fact");

    signInAs(alice.id);
    const aliceBody = await (await GET()).json();

    signInAs(bob.id);
    const bobBody = await (await GET()).json();

    expect(aliceBody.fact.content).toBe("Alice's fact");
    expect(aliceBody.source).toBe("generated");
    expect(bobBody.fact.content).toBe("Bob's secret fact");
    expect(bobBody.source).toBe("cache");
    // Response exposes no internal ids.
    expect(Object.keys(aliceBody.fact).sort()).toEqual(["content", "createdAt", "movie"]);
  });

  it("returns 409 when the user hasn't finished onboarding", async () => {
    const user = await createUser("new@example.com", null);
    signInAs(user.id);

    const res = await GET();

    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NO_FAVORITE_MOVIE");
  });

  it("falls back to the last fact when OpenAI fails", async () => {
    const user = await createUser("a@example.com", "Alien");
    await prisma.movieFact.create({
      data: {
        userId: user.id,
        movie: "Alien",
        content: "An older fact",
        createdAt: new Date(Date.now() - 5 * 60_000),
      },
    });
    vi.mocked(generateMovieFact).mockRejectedValue(new Error("timeout"));
    signInAs(user.id);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ fact: { content: "An older fact" }, source: "stale" });
  });

  it("returns a friendly 503 when OpenAI fails and nothing is cached", async () => {
    const user = await createUser("a@example.com", "Alien");
    vi.mocked(generateMovieFact).mockRejectedValue(new Error("OpenAI 500: internal details"));
    signInAs(user.id);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error.code).toBe("FACT_UNAVAILABLE");
    expect(body.error.message).not.toContain("internal details");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});
