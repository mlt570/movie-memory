import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUser, prisma, resetDatabase } from "./helpers";

vi.mock("@/lib/auth", () => ({ getSessionUserId: vi.fn() }));

const { getSessionUserId } = await import("@/lib/auth");
const { saveFavoriteMovie } = await import("@/app/onboarding/actions");

const initial = { error: null, value: "" };
const form = (movie: string) => {
  const data = new FormData();
  data.set("movie", movie);
  return data;
};
/** next/navigation's redirect() throws a special error carrying the target URL. */
const redirectTarget = (error: unknown) =>
  (error as { digest?: string }).digest?.split(";")[2];

beforeEach(resetDatabase);

describe("saveFavoriteMovie (onboarding server action)", () => {
  it("validates server-side and does not save invalid input", async () => {
    const user = await createUser("a@example.com", null);
    vi.mocked(getSessionUserId).mockResolvedValue(user.id);

    const state = await saveFavoriteMovie(initial, form("    "));

    expect(state.error).toBe("Please enter a movie title.");
    const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(saved.favoriteMovie).toBeNull();
  });

  it("saves the trimmed title for the signed-in user and redirects to the dashboard", async () => {
    const user = await createUser("a@example.com", null);
    const other = await createUser("b@example.com", null);
    vi.mocked(getSessionUserId).mockResolvedValue(user.id);

    const error = await saveFavoriteMovie(initial, form("  Spirited   Away ")).catch((e) => e);

    expect(redirectTarget(error)).toBe("/dashboard");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).favoriteMovie).toBe(
      "Spirited Away",
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).favoriteMovie).toBeNull();
  });

  it("never overwrites an existing favorite movie", async () => {
    const user = await createUser("a@example.com", "Heat");
    vi.mocked(getSessionUserId).mockResolvedValue(user.id);

    const error = await saveFavoriteMovie(initial, form("Something Else")).catch((e) => e);

    // It ran to completion (redirected), it just didn't write anything.
    expect(redirectTarget(error)).toBe("/dashboard");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).favoriteMovie).toBe("Heat");
  });

  it("returns a validation error (not a crash) for a title with a NUL byte", async () => {
    const user = await createUser("a@example.com", null);
    vi.mocked(getSessionUserId).mockResolvedValue(user.id);

    const state = await saveFavoriteMovie(initial, form("Heat\u0000"));

    expect(state.error).toMatch(/control characters/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).favoriteMovie).toBeNull();
  });

  it("redirects to the landing page when signed out", async () => {
    vi.mocked(getSessionUserId).mockResolvedValue(null);

    const error = await saveFavoriteMovie(initial, form("Heat")).catch((e) => e);

    expect(redirectTarget(error)).toBe("/");
  });
});
