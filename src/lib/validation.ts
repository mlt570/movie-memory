import { z } from "zod";
import { MOVIE_TITLE_MAX_LENGTH, MOVIE_TITLE_MIN_LENGTH } from "@/lib/movie-title";

export { MOVIE_TITLE_MAX_LENGTH, MOVIE_TITLE_MIN_LENGTH };

/**
 * Server-side source of truth for a favorite-movie title.
 * 1. Trims and collapses whitespace (tabs, newlines, repeated spaces), so
 *    "  The   Matrix\n" becomes "The Matrix".
 * 2. Checks the length.
 * 3. Rejects control characters (e.g. NUL, which Postgres can't store) and
 *    titles with no visible content (e.g. only zero-width characters).
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
      )
      .refine((title) => !/\p{Cc}/u.test(title), "Movie titles can't contain control characters.")
      .refine((title) => /[\p{L}\p{N}]/u.test(title), "Please enter a movie title."),
  );

export type ParseResult = { ok: true; value: string } | { ok: false; error: string };

export function parseMovieTitle(input: unknown): ParseResult {
  const result = movieTitleSchema.safeParse(input);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: result.error.issues[0]?.message ?? "Invalid movie title." };
}
