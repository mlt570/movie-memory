import type { ApiErrorResponse, FactResponse } from "@/lib/api-types";

export type FactState =
  | { status: "loading" }
  | { status: "ready"; data: FactResponse }
  | { status: "error"; message: string }
  | { status: "unauthenticated" };

const GENERIC_ERROR = "We couldn't load a fact right now. Please try again.";

// While another request is generating, /api/fact answers "refreshing" with the
// previous fact. Ask again until the new fact lands in the cache, for at most
// about one server lease (30s).
export const REFRESH_POLL_MS = 1_500;
export const REFRESH_MAX_POLLS = 20;

/** One GET /api/fact, mapped to a UI state. Never throws. */
export async function fetchFact(): Promise<FactState> {
  try {
    const res = await fetch("/api/fact", { cache: "no-store" });
    if (res.status === 401) return { status: "unauthenticated" };
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

export function isRefreshing(state: FactState): boolean {
  return state.status === "ready" && state.data.source === "refreshing";
}

type LoadOptions = {
  isCancelled?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  maxPolls?: number;
};

/**
 * Fetch a fact and report each result via `onUpdate`. If the server says a new
 * fact is still being generated ("refreshing"), show the previous fact and
 * poll until the new one is ready (or the poll budget runs out).
 */
export async function loadFact(
  fetchOnce: () => Promise<FactState>,
  onUpdate: (state: FactState) => void,
  {
    isCancelled = () => false,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    pollMs = REFRESH_POLL_MS,
    maxPolls = REFRESH_MAX_POLLS,
  }: LoadOptions = {},
): Promise<void> {
  for (let polls = 0; ; polls++) {
    const state = await fetchOnce();
    if (isCancelled()) return;
    onUpdate(state);
    if (!isRefreshing(state) || polls >= maxPolls) return;
    await sleep(pollMs);
    if (isCancelled()) return;
  }
}
