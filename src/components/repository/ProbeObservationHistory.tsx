"use client";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { isMatchingProbeResult, type ProbeRequestDraft, type ProbeResult } from "@/lib/security-lab/probeTypes";
export type ProbeHistory<D extends ProbeRequestDraft> = { results: ProbeResult<D>[]; add: (result: ProbeResult<D>) => void };
export function createProbeObservationHistory<D extends ProbeRequestDraft>() {
  const Context = createContext<ProbeHistory<D> | null>(null);
  function Provider({ children }: { children: ReactNode }) {
    const [results, setResults] = useState<ProbeResult<D>[]>([]);
    const add = useCallback((result: ProbeResult<D>) => setResults(previous => !isMatchingProbeResult(result, result.request) || previous.some(row => row.runId === result.runId) ? previous : [...previous, result].slice(-10)), []);
    return <Context.Provider value={{ results, add }}>{children}</Context.Provider>;
  }
  function useHistory() { return useContext(Context); }
  return { Provider, useHistory };
}
