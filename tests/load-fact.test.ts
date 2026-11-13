import { describe, expect, it, vi } from "vitest";
import { type FactState, loadFact } from "@/app/dashboard/load-fact";
import type { FactResponse } from "@/lib/api-types";

const ready = (content: string, source: FactResponse["source"]): FactState => ({
  status: "ready",
  data: { fact: { movie: "Heat", content, createdAt: "2026-01-01T00:00:00.000Z" }, source },
});

/** A fake /api/fact that returns the given states in order. */
function fakeApi(...responses: FactState[]) {
  return vi.fn(async () => responses.shift() ?? ready("unexpected extra request", "cache"));
}

const noSleep = vi.fn(async () => {});

describe("loadFact (fact card loading)", () => {
  it("shows a generated fact after a single request", async () => {
    const fetchOnce = fakeApi(ready("New", "generated"));
    const onUpdate = vi.fn();

    await loadFact(fetchOnce, onUpdate, { sleep: noSleep });

    expect(fetchOnce).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenLastCalledWith(ready("New", "generated"));
  });

  it("shows the previous fact while refreshing, then the new fact once it is cached", async () => {
    const fetchOnce = fakeApi(
      ready("Old", "refreshing"),
      ready("Old", "refreshing"),
      ready("New", "cache"),
    );
    const onUpdate = vi.fn();

    await loadFact(fetchOnce, onUpdate, { sleep: noSleep });

    expect(fetchOnce).toHaveBeenCalledTimes(3);
    expect(onUpdate.mock.calls.map(([s]) => (s as { data: FactResponse }).data.fact.content)).toEqual([
      "Old",
      "Old",
      "New",
    ]);
  });

  it("stops polling after the budget and leaves the previous fact", async () => {
    const fetchOnce = vi.fn(async () => ready("Old", "refreshing"));
    const onUpdate = vi.fn();

    await loadFact(fetchOnce, onUpdate, { sleep: noSleep, maxPolls: 3 });

    expect(fetchOnce).toHaveBeenCalledTimes(4); // first request + 3 polls
    expect(onUpdate).toHaveBeenLastCalledWith(ready("Old", "refreshing"));
  });

  it("does not poll after cached, stale or error responses", async () => {
    for (const state of [
      ready("Same", "cache"),
      ready("Old", "stale"),
      { status: "error", message: "Try again" } as FactState,
    ]) {
      const fetchOnce = fakeApi(state);
      await loadFact(fetchOnce, vi.fn(), { sleep: noSleep });
      expect(fetchOnce).toHaveBeenCalledTimes(1);
    }
  });

  it("ignores results once cancelled (unmount, Strict Mode re-run, or a newer load)", async () => {
    let cancelled = false;
    const fetchOnce = vi.fn(async () => {
      cancelled = true; // cancelled while the request was in flight
      return ready("New", "generated");
    });
    const onUpdate = vi.fn();

    await loadFact(fetchOnce, onUpdate, { sleep: noSleep, isCancelled: () => cancelled });

    expect(onUpdate).not.toHaveBeenCalled();
  });
});
