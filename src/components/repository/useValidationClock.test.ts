import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useValidationClock } from "./useValidationClock";
import { emptySecurityRecord, validateManualRetest } from "@/types/securityTestRecord";

const hooks = vi.hoisted(() => ({ mounted: false, value: 0, effect: undefined as (() => (() => void)) | undefined }));
vi.mock("react", () => ({
  useState: (initial: () => number) => {
    if (!hooks.mounted) { hooks.value = initial(); hooks.mounted = true; }
    return [hooks.value, (value: number) => { hooks.value = value; }];
  },
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => (() => void)) => { hooks.effect ??= effect; },
}));
beforeEach(() => { hooks.mounted = false; hooks.effect = undefined; vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 18, 12, 0)); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it("samples time at initialization and in effects/events, revalidates future dates, and cleans up its timer", () => {
  const readTime = vi.spyOn(Date, "now");
  const clock = useValidationClock(); const initial = clock.now;
  expect(readTime).toHaveBeenCalledTimes(1);
  useValidationClock(); expect(readTime).toHaveBeenCalledTimes(1);
  const cleanup = hooks.effect!();
  const recorded = { ...emptySecurityRecord({ apiPath: "/api/search", method: "GET" }), inspectionMethod: "manual comparison",
    beforeObservation: "before", changedFiles: "route.ts", changes: "binding", performedManually: true,
    performedAt: "2026-11-18T12:00:01", retestMethod: "same comparison", afterObservation: "after",
    afterStatus: "INCONCLUSIVE" as const, retestStatus: "RECORDED" as const };
  expect(validateManualRetest(recorded, initial).retestStatus).toBe("PLANNED");
  vi.advanceTimersByTime(1000);
  const updated = useValidationClock(); expect(updated.now).toBe(initial + 1000);
  expect(validateManualRetest(recorded, updated.now).valid).toBe(true);
  // A clock adjustment must invalidate an otherwise completed future-dated declaration again.
  vi.setSystemTime(new Date(2026, 10, 18, 11, 59)); updated.refresh();
  expect(validateManualRetest(recorded, useValidationClock().now).retestStatus).toBe("PLANNED");
  cleanup(); expect(vi.getTimerCount()).toBe(0);
});
