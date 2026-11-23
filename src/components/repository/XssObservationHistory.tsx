"use client";
import { createProbeObservationHistory } from "./ProbeObservationHistory";
import type { XssRequestDraft } from "@/lib/security-lab/xssTypes";
export const { Provider: XssObservationHistoryProvider, useHistory: useXssObservationHistory } = createProbeObservationHistory<XssRequestDraft>();
