export type RunnerEvidence = {
  account: "A" | "B"; purpose: string; method?: "GET"; path: string; status?: number; error?: string;
  response?: { subject?: string; resourceId?: string; ownerId?: string; protectedFingerprint?: string; resourcePresent?: boolean; ownerPresent?: boolean; protectedPresent?: boolean };
};
export type RunnerResult = {
  verdict: "confirmed" | "blocked" | "suspected" | "inconclusive";
  reason: string; evidence: RunnerEvidence[]; requestCount: number; scope: string; comparisonKey?: string;
};
export type RunnerPlan = {
  id: string; input: { apiPath: string; resourceA: string; resourceB: string; policy: string };
  requests: RunnerEvidence[]; target: string; policy: string; expiresAt: number; approved: boolean; used: boolean; result?: RunnerResult;
};
export type RunnerState = { configured: boolean; paired: boolean; target?: string; plan?: RunnerPlan; running: boolean };
export const verdictLabels: Record<RunnerResult["verdict"], string> = {
  confirmed: "IDOR 재현 확인", blocked: "접근 차단 관찰", suspected: "취약점 의심", inconclusive: "판정 불가",
};
