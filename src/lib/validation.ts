import { z } from "zod";

export const MOVIE_TITLE_MIN_LENGTH = 1; // real titles can be one character, e.g. "M" (1931)
export const MOVIE_TITLE_MAX_LENGTH = 100;

/**
 * Server-side source of truth for a favorite-movie title.
 * Trims the input and collapses internal whitespace (tabs, newlines, repeated
 * spaces) before checking the length, so "  The   Matrix\n" becomes "The Matrix".
 */
export const movieTitleSchema = z
  .string({ error: "Please enter a movie title." })
  .transform((value) => value.trim().replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(MOVIE_TITLE_MIN_LENGTH, "Please enter a movie title.")
      .max(
        MOVIE_TITLE_MAX_LENGTH,
        `Movie titles must be ${MOVIE_TITLE_MAX_LENGTH} characters or fewer.`,
      ),
  );

export type ParseResult = { ok: true; value: string } | { ok: false; error: string };

export function parseMovieTitle(input: unknown): ParseResult {
  const result = movieTitleSchema.safeParse(input);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: result.error.issues[0]?.message ?? "Invalid movie title." };
}
