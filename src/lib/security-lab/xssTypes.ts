import { isMatchingProbeResult, probeTargetKey, type ProbeRequestDraft, type ProbeResult, type ProbeSession } from "./probeTypes";
export type XssRequestDraft = ProbeRequestDraft & { version: "xss-practice-v1"; target: ProbeRequestDraft["target"] & { reflectionLocation: string; reflectionContext: "HTML_TEXT" | "HTML_ATTRIBUTE" | "UNKNOWN" } };
export type XssComparisonResult = ProbeResult<XssRequestDraft>;
export type XssEditorSession = ProbeSession<XssRequestDraft>;
export const xssTargetKey = probeTargetKey;
export const isMatchingXssResult = (value: unknown, expected: XssRequestDraft): value is XssComparisonResult => isMatchingProbeResult(value, expected);
