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

  it("rejects control characters such as NUL (Postgres can't store them)", () => {
    expect(parseMovieTitle("Heat\u0000")).toMatchObject({ ok: false });
    expect(parseMovieTitle("Heat\u0007")).toMatchObject({ ok: false });
  });

  it("rejects titles with no visible letters or digits", () => {
    expect(parseMovieTitle("​​")).toMatchObject({ ok: false });
    expect(parseMovieTitle("...")).toMatchObject({ ok: false });
  });

  it("accepts non-Latin and punctuated titles", () => {
    expect(parseMovieTitle("千と千尋の神隠し")).toMatchObject({ ok: true });
    expect(parseMovieTitle("WALL·E: 2008!")).toMatchObject({ ok: true });
  });
});
