"use client";
import { createProbeObservationHistory } from "./ProbeObservationHistory";
import type { SqliRequestDraft } from "@/lib/security-lab/sqliTypes";
export const { Provider: SqliObservationHistoryProvider, useHistory: useSqliObservationHistory } = createProbeObservationHistory<SqliRequestDraft>();
