import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRepositoryAccess } from "@/lib/github/repositoryAccess";
import { getGithubAnalysisCache, githubAnalysisCacheKey } from "@/lib/repository/githubAnalysisCache";
import { loadVercelAccount, verifyVercelProject, vercelJson, object, identifier } from "@/lib/vercel/deploymentCommit";
import { ManagedProbeError } from "./managedProbePolicy";
import type { ProbeRequestDraft, ProbeResult } from "./probeTypes";
import type { RepositoryAnalysis } from "@/types/analysis";
import type { ManagedSqliTarget, SqliExecutionApproval } from "./sqliRegistry";
import type { SqliExecutionStatus, SqliResponseEvidence } from "./sqliTypes";
import { observeManagedSqli } from "./sqliTransport";

const asObject = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
type Binding = { target: ManagedSqliTarget; approval: SqliExecutionApproval };

export function createManagedProbeExecutor<D extends ProbeRequestDraft>(config: {
  select: (userId: string, draft: D) => Binding;
  fingerprint: (target: ManagedSqliTarget, approval: SqliExecutionApproval) => string;
  hasCandidate: (analysis: RepositoryAnalysis, findingId: string) => boolean;
  counter: "sqliExecution" | "xssExecution";
}) {
  const { select: selectApproval, fingerprint: approvalFingerprint } = config;
  async function verifyContext(userId: string, draft: D, expected?: string): Promise<Binding> {
    const binding = selectApproval(userId, draft), { target, approval } = binding;
    if (expected && approvalFingerprint(target, approval) !== expected) throw new ManagedProbeError("조회 중 서버 실행 승인이 변경되었습니다.");
    const connection = await requireRepositoryAccess(userId, approval.connectionId);
    if (connection.vercelUrl !== target.origin || connection.deploymentVersion !== approval.deploymentVersion
      || connection.repository.fullName !== approval.repository || connection.deploymentOwnershipStatus !== "VERIFIED" || !connection.deploymentVerifiedAt) {
      throw new ManagedProbeError("저장소·배포 URL·버전·소유권이 서버 실행 승인과 일치하지 않습니다.");
    }
    const run = await db.analysisRun.findFirst({ where: { id: approval.analysisRunId, repositoryId: connection.repositoryId,
      requestedByUserId: userId, status: "COMPLETED", source: "CONNECTED_REPOSITORY", commitSha: approval.commitSha }, select: { id: true } });
    const analysis = getGithubAnalysisCache(githubAnalysisCacheKey(`installation:${connection.installation.installationId}`, connection.repository.fullName, approval.commitSha));
    if (!run || analysis?.repository !== approval.repository || analysis.collection?.commitSha !== approval.commitSha
      || !config.hasCandidate(analysis, approval.findingId)) {
      throw new ManagedProbeError("승인된 분석 이력 또는 서버 캐시의 검사 후보가 없습니다. 저장소를 다시 분석해 주세요.");
    }
    // Reuse user-scoped encrypted Vercel credentials and project/repository validation.
    const auth = await loadVercelAccount(userId);
    if (connection.vercelAccountId !== auth.account.id || connection.vercelProjectId !== target.projectId) throw new ManagedProbeError("승인된 Vercel 계정·프로젝트 연결이 아닙니다.");
    const project = await verifyVercelProject(auth, target.projectId, connection.vercelTeamId, connection.repository.githubRepositoryId);
    const query = new URLSearchParams({ withGitRepoInfo: "true", ...(connection.vercelTeamId ? { teamId: connection.vercelTeamId } : {}) });
    const deployment = await vercelJson(`/v13/deployments/${encodeURIComponent(target.deploymentId)}?${query}`, auth.token, auth.signal);
    const git = object(deployment?.gitSource);
    if (!deployment || deployment.id !== target.deploymentId || deployment.projectId !== target.projectId
      || deployment.url !== new URL(target.origin).hostname || deployment.target !== null || deployment.readyState !== "READY"
      || deployment.source !== "git" || deployment.microfrontends || project.microfrontends || project.rollingRelease
      || object(object(project.targets)?.production)?.id === target.deploymentId
      || git?.type !== "github" || identifier(git.repoId) !== connection.repository.githubRepositoryId || git.sha !== approval.commitSha) {
      throw new ManagedProbeError("승인된 고정 URL의 비운영 READY Git 배포·저장소·커밋을 확인하지 못했습니다. 운영 배포와 이동 가능한 별칭은 허용하지 않습니다.");
    }
    const latest = await requireRepositoryAccess(userId, approval.connectionId);
    const account = await db.account.findFirst({ where: { id: auth.account.id, userId, provider: "vercel" }, select: { access_token: true, expires_at: true } });
    if (!account?.access_token || createHash("sha256").update(account.access_token).digest("hex") !== createHash("sha256").update(auth.encryptedToken).digest("hex")
      || account.expires_at !== null && account.expires_at * 1000 <= Date.now()
      || latest.vercelUrl !== target.origin || latest.deploymentVersion !== approval.deploymentVersion
      || latest.deploymentOwnershipStatus !== "VERIFIED" || !latest.deploymentVerifiedAt
      || latest.vercelAccountId !== connection.vercelAccountId || latest.vercelProjectId !== target.projectId || latest.vercelTeamId !== connection.vercelTeamId) {
      throw new ManagedProbeError("검증 중 계정·토큰·배포 연결·소유권이 변경되었습니다.");
    }
    const fresh = selectApproval(userId, draft);
    if (approvalFingerprint(fresh.target, fresh.approval) !== approvalFingerprint(target, approval)) throw new ManagedProbeError("검증 중 실행 승인이 변경되었습니다.");
    return binding;
  }

  /** Existing analysis JSON holds only a small usage counter, never response bodies. */
  async function budget(userId: string, binding: Binding, reserve: boolean) {
    const { target, approval } = binding, fingerprint = approvalFingerprint(target, approval);
    return db.$transaction(async tx => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`;
      if (locked.length !== 1 || !(clock?.now instanceof Date) || Date.parse(approval.expiresAt) <= clock.now.getTime()) throw new ManagedProbeError("사용자·DB 시간 또는 승인 만료 검증에 실패했습니다.");
      const run = await tx.analysisRun.findFirst({ where: { id: approval.analysisRunId, requestedByUserId: userId, status: "COMPLETED", source: "CONNECTED_REPOSITORY", commitSha: approval.commitSha }, select: { stats: true } });
      if (!run || !run.stats) throw new ManagedProbeError("지속적인 요청 예산을 저장할 분석 이력이 없습니다.");
      const stats = asObject(run.stats), usage = asObject(stats[config.counter]);
      if (Object.keys(usage).length && (usage.approvalId !== approval.id || usage.fingerprint !== fingerprint
        || !Number.isSafeInteger(usage.usedRequests) || (usage.usedRequests as number) < 0)) throw new ManagedProbeError("이 분석 이력의 승인 예산이 다른 승인에 묶여 있거나 손상되었습니다.");
      const used = (usage.usedRequests as number | undefined) ?? 0;
      const recent = await tx.analysisRun.findMany({ where: { requestedByUserId: userId,
        OR: ["sqliExecution", "xssExecution"].map(key => ({ stats: { path: [key, "lastReservedAt"], gte: clock.now.getTime() - 60 * 60_000 } })) }, select: { stats: true } });
      let total = 0;
      for (const row of recent) for (const key of ["sqliExecution", "xssExecution"]) {
        const entry = asObject(asObject(row.stats)[key]);
        if (!Object.keys(entry).length) continue;
        if (!Number.isFinite(entry.lastReservedAt) || !Number.isSafeInteger(entry.usedRequests) || (entry.usedRequests as number) < 0) throw new ManagedProbeError("사용자 요청 예산을 검증할 수 없습니다.");
        if ((entry.lastReservedAt as number) >= clock.now.getTime() - 60 * 60_000) total += entry.usedRequests as number;
      }
      const remaining = Math.min(approval.maxRequests - used, 6 - total);
      if (remaining < 2) throw new ManagedProbeError("요청 예산을 소진했습니다. 승인별 제한 및 사용자별 시간당 최대 6회가 적용됩니다.", 429);
      if (reserve) await tx.analysisRun.update({ where: { id: approval.analysisRunId }, data: { stats: { ...stats,
        [config.counter]: { approvalId: approval.id, fingerprint, usedRequests: used + 2, lastReservedAt: clock.now.getTime() },
      } as Prisma.InputJsonValue } });
      return reserve ? remaining - 2 : remaining;
    }, { maxWait: 5000, timeout: 10000 });
  }

  async function status(userId: string, draft: D): Promise<SqliExecutionStatus> {
    const binding = await verifyContext(userId, draft);
    const remainingRequests = await budget(userId, binding, false);
    return { allowed: true, reason: "등록 대상·별도 실행 승인·소유권·비운영 배포·커밋·요청 예산 확인 완료. 전송 시 다시 검증합니다.",
      approvalId: binding.approval.id, targetId: binding.target.id, expiresAt: binding.approval.expiresAt, remainingRequests };
  }

  async function execute(userId: string, draft: D): Promise<ProbeResult<D>> {
    const binding = await verifyContext(userId, draft), fingerprint = approvalFingerprint(binding.target, binding.approval);
    await budget(userId, binding, true); // Reserve BOTH requests atomically; no refunds/retries after uncertain failures.
    const assertApproval = () => {
      const current = selectApproval(userId, draft);
      if (approvalFingerprint(current.target, current.approval) !== fingerprint) throw new ManagedProbeError("실행 승인이 변경되었습니다.");
    };
    await verifyContext(userId, draft, fingerprint);
    const baseline = await observeManagedSqli(binding.target, draft.baseline.value, assertApproval, Date.parse(binding.approval.expiresAt), config.counter === "xssExecution" ? "XSS" : "SQLI");
    let test: SqliResponseEvidence;
    const skipped = (reason: string): SqliResponseEvidence => ({ requestId: randomUUID(), observedAt: new Date().toISOString(), outcome: "BLOCKED",
      statusCode: null, durationMs: null, body: null, bodyTruncated: false, errorMessage: reason });
    if (baseline.outcome !== "RESPONSE") test = skipped("정상 요청 실패·차단·제한으로 테스트 요청은 전송하지 않았습니다.");
    else {
      try { await verifyContext(userId, draft, fingerprint); test = await observeManagedSqli(binding.target, draft.test.value, assertApproval, Date.parse(binding.approval.expiresAt), config.counter === "xssExecution" ? "XSS" : "SQLI"); }
      catch { test = skipped("두 번째 요청 전 권한·배포·승인 재검증 실패로 전송하지 않았습니다."); }
    }
    return { runId: randomUUID(), request: draft, baseline, test,
      assessment: { status: "INCONCLUSIVE", reason: "HTTP 응답 비교만으로 취약점 또는 스크립트 실행 여부를 확정하지 않습니다.", evidenceReferences: [] } };
  }

  return { status, execute };
}
