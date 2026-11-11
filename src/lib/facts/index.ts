import "server-only";
import { generateMovieFact } from "@/lib/openai";
import { prisma } from "@/lib/prisma";
import { createFactService } from "./fact-service";

export { FactUnavailableError, NoFavoriteMovieError } from "./fact-service";
export type { FactResult, FactSource } from "./fact-service";

/** The app's fact service, wired to the real database and OpenAI. */
export const factService = createFactService({ db: prisma, generateFact: generateMovieFact });
