"use client";

import { useActionState } from "react";
import { MOVIE_TITLE_MAX_LENGTH } from "@/lib/validation";
import { saveFavoriteMovie, type OnboardingState } from "./actions";

const initialState: OnboardingState = { error: null, value: "" };

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState(saveFavoriteMovie, initialState);

  return (
    <form action={formAction} className="flex w-full flex-col gap-3" noValidate>
      <label htmlFor="movie" className="font-medium">
        What&apos;s your favorite movie?
      </label>
      <input
        id="movie"
        name="movie"
        type="text"
        required
        autoFocus
        // Client-side hint only; the server action is the source of truth.
        maxLength={MOVIE_TITLE_MAX_LENGTH}
        defaultValue={state.value}
        placeholder="e.g. Spirited Away"
        aria-invalid={state.error ? true : undefined}
        aria-describedby={state.error ? "movie-error" : undefined}
        className="rounded-lg border border-stone-300 bg-white px-4 py-3 text-stone-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
      />
      {state.error && (
        <p id="movie-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-foreground px-6 py-3 font-medium text-background transition hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Continue"}
      </button>
    </form>
  );
}
