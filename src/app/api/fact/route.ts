import { NextResponse } from "next/server";
import type { ApiErrorCode, ApiErrorResponse, FactResponse } from "@/lib/api-types";
import { getSessionUserId } from "@/lib/auth";
import { FactUnavailableError, NoFavoriteMovieError, factService } from "@/lib/facts";

// Facts are per-user and time-sensitive: never let a browser or CDN cache them.
const NO_STORE = { "Cache-Control": "private, no-store" };

function errorResponse(status: number, code: ApiErrorCode, message: string) {
  return NextResponse.json<ApiErrorResponse>(
    { error: { code, message } },
    { status, headers: NO_STORE },
  );
}

/**
 * GET /api/fact: a fun fact about the signed-in user's favorite movie.
 *
 * Takes no parameters on purpose: the user is identified only by the session
 * cookie, so there is no way to ask for another user's facts.
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return errorResponse(401, "UNAUTHENTICATED", "Please sign in.");

  try {
    const { fact, source } = await factService.getFactForUser(userId);
    return NextResponse.json<FactResponse>(
      {
        fact: { movie: fact.movie, content: fact.content, createdAt: fact.createdAt.toISOString() },
        source,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof NoFavoriteMovieError) {
      return errorResponse(409, "NO_FAVORITE_MOVIE", "Choose a favorite movie first.");
    }
    if (error instanceof FactUnavailableError) {
      return errorResponse(
        503,
        "FACT_UNAVAILABLE",
        error.reason === "busy"
          ? "Your fact is still being written. Please try again in a moment."
          : "We couldn't come up with a fact right now. Please try again shortly.",
      );
    }
    console.error("Unexpected error in GET /api/fact", error);
    return errorResponse(500, "INTERNAL_ERROR", "Something went wrong. Please try again.");
  }
}
