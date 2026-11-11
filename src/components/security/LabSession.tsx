"use client";
import { createContext, useCallback, useContext, useEffect, useReducer, type ReactNode } from "react";
import type { RunnerPlan, RunnerResult, RunnerState } from "@/lib/security-lab/runnerTypes";

export type SessionRecord = { id: string; target: string; input: RunnerPlan["input"]; result: RunnerResult; observedAt: number };
export type LabData = {
  session?: { token: string; port: string; expiresAt: number };
  runnerState?: RunnerState; plan?: RunnerPlan; previous?: RunnerResult;
  runnerPort: string; apiPath: string; resourceA: string; resourceB: string; policy: string;
  busy: boolean; records: SessionRecord[];
};
export const initialLabData = (): LabData => ({ runnerPort: "4317", apiPath: "/vulnerable/orders/{resourceId}", resourceA: "101", resourceB: "102", policy: "owner-only", busy: false, records: [] });
type State = { epoch: number; data: LabData };
type Action = { type: "merge"; epoch: number; patch: Partial<LabData> } | { type: "record"; epoch: number; plan: RunnerPlan; observedAt: number } | { type: "reset" } | { type: "expire"; epoch: number };
export function labSessionReducer(state: State, action: Action): State {
  if (action.type === "reset") return { epoch: state.epoch + 1, data: initialLabData() };
  if (action.epoch !== state.epoch) return state;
  if (action.type === "expire") return { epoch: state.epoch + 1, data: { ...state.data, session: undefined, runnerState: undefined, plan: undefined, busy: false } };
  if (action.type === "merge") return { ...state, data: { ...state.data, ...action.patch } };
  if (!action.plan.result || state.data.records.some(record => record.id === action.plan.id)) return state;
  const record = { id: action.plan.id, target: action.plan.target, input: action.plan.input, result: action.plan.result, observedAt: action.observedAt };
  return { ...state, data: { ...state.data, records: [record, ...state.data.records].slice(0, 10) } };
}
const Context = createContext<{ data: LabData; update: (patch: Partial<LabData>) => void; remember: (plan: RunnerPlan) => void; reset: () => void; disconnect: () => void } | null>(null);

/** Per-tab React memory only. No localStorage, sessionStorage, DB, or server uploads. */
export function LabSessionProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(labSessionReducer, undefined, () => ({ epoch: 0, data: initialLabData() }));
  const epoch = state.epoch;
  const update = useCallback((patch: Partial<LabData>) => dispatch({ type: "merge", epoch, patch }), [epoch]);
  const remember = useCallback((plan: RunnerPlan) => dispatch({ type: "record", epoch, plan, observedAt: Date.now() }), [epoch]);
  const reset = useCallback(() => dispatch({ type: "reset" }), []);
  const disconnect = useCallback(() => dispatch({ type: "expire", epoch }), [epoch]);
  useEffect(() => {
    if (!state.data.session) return;
    const timer = setTimeout(() => dispatch({ type: "expire", epoch }), Math.max(0, state.data.session.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [epoch, state.data.session]);
  return <Context.Provider value={{ data: state.data, update, remember, reset, disconnect }}>{children}</Context.Provider>;
}
export function useLabSession() {
  const context = useContext(Context);
  if (!context) throw new Error("LabSessionProvider is required");
  return context;
}
export function ClearLabOnSubmit({ children }: { children: ReactNode }) {
  const { reset } = useLabSession();
  return <div className="bp-session-reset" onSubmitCapture={reset}>{children}</div>;
}
