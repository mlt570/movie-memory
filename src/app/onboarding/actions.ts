"use server";

import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseMovieTitle } from "@/lib/validation";

export type OnboardingState = { error: string | null; value: string };

export async function saveFavoriteMovie(
  _previous: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  // Server Actions are public HTTP endpoints: re-check the session here rather
  // than trusting that the caller came from the onboarding page.
  const userId = await getSessionUserId();
  if (!userId) redirect("/");

  const raw = formData.get("movie");
  const parsed = parseMovieTitle(typeof raw === "string" ? raw : undefined);
  if (!parsed.ok) {
    return { error: parsed.error, value: typeof raw === "string" ? raw : "" };
  }

  // Onboarding is first-time only: the `favoriteMovie: null` condition means a
  // replayed or duplicate submission can never overwrite an existing choice.
  await prisma.user.updateMany({
    where: { id: userId, favoriteMovie: null },
    data: { favoriteMovie: parsed.value },
  });

  redirect("/dashboard");
}
