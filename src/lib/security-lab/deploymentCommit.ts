export type DeploymentCommitStatus = "UNAVAILABLE" | "MISMATCH" | "MATCH" | "LOOKUP_FAILED";

/** Read-only observation from the authenticated server route, not execution authorization. */
export type DeploymentCommitComparison = {
  status: DeploymentCommitStatus;
  reason: string;
  connectionId: string;
  repository: string;
  analysisRunId: string | null;
  analyzedCommitSha: string | null;
  deployedCommitSha: string | null;
  deploymentUrl: string | null;
  deploymentVersion: number;
  deploymentId: string | null;
  projectId: string | null;
  source: "VERCEL_API" | null;
  checkedAt: string;
};

export const deploymentCommitLabels: Record<DeploymentCommitStatus, string> = {
  UNAVAILABLE: "배포 커밋 확인 불가", MISMATCH: "배포 커밋과 분석 커밋 불일치",
  MATCH: "배포 커밋과 분석 커밋 일치", LOOKUP_FAILED: "배포 정보 조회 실패",
};
