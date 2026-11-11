"use client";

import { useEffect, useState } from "react";
import type { ApiErrorResponse, FactResponse } from "@/lib/api-types";

type FactState =
  | { status: "loading" }
  | { status: "ready"; data: FactResponse }
  | { status: "error"; message: string };

const GENERIC_ERROR = "We couldn't load a fact right now. Please try again.";

async function fetchFact(): Promise<FactState> {
  try {
    const res = await fetch("/api/fact", { cache: "no-store" });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const message = (body as ApiErrorResponse | null)?.error?.message ?? GENERIC_ERROR;
      return { status: "error", message };
    }
    return { status: "ready", data: body as FactResponse };
  } catch {
    return { status: "error", message: GENERIC_ERROR };
  }
}

const SOURCE_NOTE: Record<FactResponse["source"], string | null> = {
  generated: null,
  cache: "New facts are available once a minute. This is your latest one.",
  stale: "We couldn't get a new fact just now, so here's your most recent one.",
};

export function FactCard() {
  const [state, setState] = useState<FactState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchFact().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function refresh() {
    setRefreshing(true);
    setState(await fetchFact());
    setRefreshing(false);
  }

  return (
    <section
      aria-live="polite"
      className="rounded-2xl border border-amber-200 bg-amber-50 p-6 dark:border-amber-900/60 dark:bg-amber-950/30"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-amber-800 dark:text-amber-300">
          Fun fact
        </h2>
        {state.status !== "loading" && (
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="rounded-full px-3 py-1 text-sm font-medium text-amber-900 transition hover:bg-amber-100 disabled:opacity-60 dark:text-amber-200 dark:hover:bg-amber-900/40"
          >
            {refreshing ? "Loading…" : state.status === "error" ? "Try again" : "Another fact"}
          </button>
        )}
      </div>

      {state.status === "loading" && (
        <p className="mt-3 animate-pulse text-stone-500">Thinking of something interesting…</p>
      )}

      {state.status === "error" && (
        <p role="alert" className="mt-3 text-red-700 dark:text-red-400">
          {state.message}
        </p>
      )}

      {state.status === "ready" && (
        <>
          <p className="mt-3 text-lg leading-relaxed">{state.data.fact.content}</p>
          {SOURCE_NOTE[state.data.source] && (
            <p className="mt-3 text-sm text-stone-500">{SOURCE_NOTE[state.data.source]}</p>
          )}
        </>
      )}
    </section>
  );
}
