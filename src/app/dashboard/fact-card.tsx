"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FactResponse } from "@/lib/api-types";
import { type FactState, fetchFact, isRefreshing, loadFact } from "./load-fact";

const SOURCE_NOTE: Record<FactResponse["source"], string | null> = {
  generated: null,
  cache: "New facts are available once a minute. This is your latest one.",
  refreshing: "A new fact is still being written. Try again in a moment.",
  stale: "We couldn't get a new fact just now, so here's your most recent one.",
};

export function FactCard() {
  const [state, setState] = useState<FactState>({ status: "loading" });
  const [busy, setBusy] = useState(true);
  const router = useRouter();
  // Only the latest load may update the card. This also ignores the extra
  // effect run React makes in development (Strict Mode) and loads that finish
  // after unmount.
  const latestLoad = useRef(0);

  // Session expired or signed out in another tab: back to the sign-in page.
  useEffect(() => {
    if (state.status === "unauthenticated") router.replace("/");
  }, [state.status, router]);

  const load = useCallback(async () => {
    const id = ++latestLoad.current;
    const isCancelled = () => latestLoad.current !== id;
    await loadFact(fetchFact, setState, { isCancelled });
    if (!isCancelled()) setBusy(false);
  }, []);

  useEffect(() => {
    const loads = latestLoad;
    void load();
    return () => {
      loads.current++; // cancel this load on unmount
    };
  }, [load]);

  function refresh() {
    setBusy(true);
    void load();
  }

  const note =
    state.status !== "ready"
      ? null
      : busy
        ? isRefreshing(state)
          ? "Writing a new fact…"
          : "Getting a new fact…"
        : SOURCE_NOTE[state.data.source];

  return (
    <section
      aria-live="polite"
      aria-busy={busy}
      className="rounded-2xl border border-amber-200 bg-amber-50 p-6 dark:border-amber-900/60 dark:bg-amber-950/30"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-amber-800 dark:text-amber-300">
          Fun fact
        </h2>
        {(state.status === "ready" || state.status === "error") && (
          <button
            type="button"
            onClick={refresh}
            disabled={busy}
            className="rounded-full px-3 py-1 text-sm font-medium text-amber-900 transition hover:bg-amber-100 disabled:opacity-60 dark:text-amber-200 dark:hover:bg-amber-900/40"
          >
            {busy ? "Loading…" : state.status === "error" ? "Try again" : "Another fact"}
          </button>
        )}
      </div>

      {(state.status === "loading" || state.status === "unauthenticated") && (
        <p className="mt-3 animate-pulse text-stone-500">Thinking of something interesting…</p>
      )}

      {state.status === "error" && (
        <p role="alert" className="mt-3 text-red-700 dark:text-red-400">
          {state.message}
        </p>
      )}

      {state.status === "ready" && (
        <>
          <p className={`mt-3 text-lg leading-relaxed ${busy ? "opacity-60" : ""}`}>
            {state.data.fact.content}
          </p>
          {note && (
            <p className={`mt-3 text-sm text-stone-500 ${busy ? "animate-pulse" : ""}`}>{note}</p>
          )}
        </>
      )}
    </section>
  );
}
