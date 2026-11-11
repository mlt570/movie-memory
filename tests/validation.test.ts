import { describe, expect, it } from "vitest";
import { MOVIE_TITLE_MAX_LENGTH, parseMovieTitle } from "@/lib/validation";

describe("parseMovieTitle", () => {
  it("trims and collapses whitespace", () => {
    expect(parseMovieTitle("  The   Matrix\n")).toEqual({ ok: true, value: "The Matrix" });
  });

  it("accepts one-character titles", () => {
    expect(parseMovieTitle("M")).toEqual({ ok: true, value: "M" });
  });

  it("rejects empty and whitespace-only input", () => {
    expect(parseMovieTitle("")).toMatchObject({ ok: false });
    expect(parseMovieTitle("   \t ")).toMatchObject({ ok: false });
  });

  it("enforces the maximum length after trimming", () => {
    const max = "a".repeat(MOVIE_TITLE_MAX_LENGTH);
    expect(parseMovieTitle(`  ${max}  `)).toEqual({ ok: true, value: max });
    expect(parseMovieTitle(max + "a")).toMatchObject({ ok: false });
  });

  it("rejects non-string input", () => {
    expect(parseMovieTitle(undefined)).toMatchObject({ ok: false });
    expect(parseMovieTitle(42)).toMatchObject({ ok: false });
  });
});
