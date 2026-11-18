import { requireUserId } from "@/lib/auth/currentUser";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { requireRepositoryAccess, RepositoryAccessError, repositoryAccessResponse, repositoryJson } from "@/lib/github/repositoryAccess";
import type { DeploymentCommitComparison } from "@/lib/security-lab/deploymentCommit";
import { readVercelDeploymentCommit, VercelMetadataError } from "@/lib/vercel/deploymentCommit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ connectionId: string }> }) {
  let userId: string;
  try { userId = await requireUserId(); }
  catch { return repositoryJson({ message: "로그인이 필요합니다." }, { status: 401 }); }
  if (request.headers.get("origin") !== new URL(request.url).origin) return repositoryJson({ message: "동일한 사이트에서만 조회할 수 있습니다." }, { status: 403 });
  let sha: string;
  try {
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new Error();
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1
      || !("analysisCommitSha" in body) || typeof body.analysisCommitSha !== "string" || !/^[0-9a-f]{40}$/i.test(body.analysisCommitSha)) throw new Error();
    sha = body.analysisCommitSha.toLowerCase();
  } catch { return repositoryJson({ message: "분석에 사용된 완전한 커밋 SHA만 전달해 주세요." }, { status: 400 }); }
  try {
    const { connectionId } = await context.params;
    const connection = await requireRepositoryAccess(userId, connectionId);
    const run = await db.analysisRun.findFirst({
      where: { repositoryId: connection.repositoryId, requestedByUserId: userId, source: "CONNECTED_REPOSITORY", status: "COMPLETED", commitSha: sha },
      orderBy: { completedAt: "desc" }, select: { id: true, commitSha: true },
    });
    const result: DeploymentCommitComparison = {
      status: "UNAVAILABLE", reason: "", connectionId, repository: connection.repository.fullName,
      // SHA is echoed for request correlation only; no MATCH is possible without run.
      analysisRunId: run?.id ?? null, analyzedCommitSha: run?.commitSha ?? sha,
      deployedCommitSha: null, deploymentUrl: connection.vercelUrl, deploymentVersion: connection.deploymentVersion,
      deploymentId: null, projectId: null, source: null, checkedAt: new Date().toISOString(),
    };
    if (!run || !connection.vercelUrl) {
      result.reason = !run ? "현재 사용자와 연결 저장소의 완료된 분석 이력에 해당 커밋이 없습니다. 연결 저장소를 다시 분석해 주세요." : "배포 URL을 먼저 등록해 주세요.";
      return repositoryJson(result);
    }
    try {
      const proof = await readVercelDeploymentCommit(userId, connection.vercelUrl, connection.repository.githubRepositoryId, connection);
      const latest = await requireRepositoryAccess(userId, connectionId);
      const account = await db.account.findFirst({ where: { id: proof.accountId, userId, provider: "vercel" },
        select: { providerAccountId: true, access_token: true, expires_at: true } });
      if (!account?.access_token || account.providerAccountId !== proof.vercelUserId
        || createHash("sha256").update(account.access_token).digest("hex") !== proof.credentialFingerprint
        || account.expires_at !== null && account.expires_at * 1000 <= Date.now()
        || latest.deploymentVersion !== connection.deploymentVersion || latest.vercelUrl !== connection.vercelUrl) {
        throw new VercelMetadataError("조회 중 인증 또는 배포 연결 정보가 변경되었습니다. 최신 정보로 다시 확인해 주세요.", "LOOKUP_FAILED");
      }
      result.deployedCommitSha = proof.deployedCommitSha;
      result.deploymentId = proof.deploymentId;
      result.projectId = proof.projectId;
      result.source = "VERCEL_API";
      result.status = proof.deployedCommitSha === sha ? "MATCH" : "MISMATCH";
      result.reason = result.status === "MATCH" ? "공식 Git 배포 메타데이터 기준으로 조회 시점의 커밋이 일치합니다. 소유권 확인과 실습 승인은 별도입니다."
        : "배포 커밋과 분석 커밋이 다릅니다. 현재 배포 커밋으로 다시 분석하거나 분석 커밋을 재배포한 후 확인해 주세요.";
      result.checkedAt = new Date().toISOString();
    } catch (error) {
      // Authorization failures must not expose stale metadata.
      if (error instanceof RepositoryAccessError) return repositoryAccessResponse(error);
      result.status = error instanceof VercelMetadataError ? error.kind : "LOOKUP_FAILED";
      result.reason = error instanceof VercelMetadataError ? error.message : "Vercel 정보 조회 중 오류 또는 제한 시간 초과가 발생했습니다. 일치 여부를 확인하지 못했습니다.";
    }
    return repositoryJson(result);
  } catch (error) { return repositoryAccessResponse(error); }
}
