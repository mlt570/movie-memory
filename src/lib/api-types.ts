// Response contract for GET /api/fact, shared by the route and the client.
import type { FactSource } from "@/lib/facts/fact-service";

export type FactResponse = {
  fact: { movie: string; content: string; createdAt: string };
  source: FactSource;
};

export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "NO_FAVORITE_MOVIE"
  | "FACT_UNAVAILABLE"
  | "INTERNAL_ERROR";

export type ApiErrorResponse = { error: { code: ApiErrorCode; message: string } };
