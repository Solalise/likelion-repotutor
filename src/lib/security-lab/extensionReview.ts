import type { RepositoryAnalysis } from "@/types/analysis";
import { securityRecordLabels, type SecurityRecordKind } from "@/types/securityTestRecord";
import type { DeploymentConnectionSnapshot } from "./findingPreparation";
import { containsCredentialMaterial } from "./manualAccess";
import { projectGuideEvidence, reviewGuides, reviewKinds, reviewOutcomes, reviewContentComplete, reviewRecordDraft, reviewFromRecord, emptyProjectReview, type ProjectReview } from "./projectReview";
import { practiceTargetIdentity } from "@/types/securityPracticeTarget";
import type { SavedRecord } from "@/components/results/RecordPersistence";
import { scanPresentation } from "@/lib/repository/scanPresentation";
import { buildReviewGuides } from "./reviewGuide";
import { presentGuideBundle } from "@/lib/ai/guideDisplaySteps";

export function extensionSession(analysis: RepositoryAnalysis, environment: DeploymentConnectionSnapshot) {
  if (!analysis.collection?.commitSha || environment.repository.fullName !== analysis.repository) throw new Error("저장소 분석 정보를 확인하세요.");
  const guides = reviewKinds.map(kind => {
    const evidence = projectGuideEvidence(analysis, kind);
    // Only observed source snippets; never send the repository, credentials or invented routes.
    const snippets = evidence.findings.slice(0, 10).map(f => ({ location: `${f.filePath}:${f.line}`, code: f.code.slice(0, 3000), reason: f.reason, remediation: f.remediation,
      evidence: f.evidence.slice(0, 5).map(e => `${e.filePath}:${e.line} ${e.description}`) }))
      .filter(f => !containsCredentialMaterial(f));
    const points = evidence.points.slice(0, 10).map(p => ({ location: `${p.filePath}:${p.line}`, code: p.code.slice(0, 3000), reason: p.description })).filter(p => !containsCredentialMaterial(p));
    return { kind, label: securityRecordLabels[kind], ...reviewGuides[kind], snippets, points,
      status: scanPresentation(analysis, kind).status, candidates: evidence.findings.length, limitations: evidence.limitations.slice(0, 5) };
  });
  return { protocol: "vulnlab-review-v1", id: JSON.stringify([environment.connectionId, analysis.collection.commitSha, environment.deploymentVersion]),
    project: analysis.repository, commit: analysis.collection.commitSha, site: environment.deployment.vercelUrl,
    stack: [...(analysis.technology?.frameworks ?? []), ...(analysis.technology?.databases ?? []), ...(analysis.technology?.persistence ?? [])], guides,
    guideBundle: analysis.savedReviewGuides ?? { guides: presentGuideBundle({ guides: buildReviewGuides(analysis), origin: "fallback" }).guides, origin: "fallback" as "fallback" | "ai", reason: "기본 가이드" },
    recordProgress: { current: [] as SecurityRecordKind[], previous: [] as { commit: string; environmentVersion: number; count: number }[], loaded: false, limited: false, error: "" } };
}
export type ExtensionSession = ReturnType<typeof extensionSession>;
export function extensionRecordProgress(records: SavedRecord[], analysis: RepositoryAnalysis, environment: DeploymentConnectionSnapshot) {
  const current = new Set<SecurityRecordKind>(), groups = new Map<string, { commit: string; environmentVersion: number; kinds: Set<SecurityRecordKind> }>();
  const target = extensionRecordDraft(emptyProjectReview(), environment).targetSnapshot!;
  for (const row of records) {
    try {
      if (row.repositoryFullName !== analysis.repository || !reviewKinds.includes(row.kind) || !/^[a-f0-9]{40}$/i.test(row.commitSha)) continue;
      const key = JSON.parse(row.recordKey), review = reviewFromRecord(row.draft), snapshot = row.draft.targetSnapshot;
      if (!Array.isArray(key) || key.length !== 4 || key[0] !== "project-review-v1" || key[1] !== environment.connectionId || key[3] !== row.kind || !Number.isSafeInteger(key[2])
        || !review || !reviewContentComplete(review) || !snapshot || snapshot.inputLocation !== "manual-project-review" || snapshot.details?.workflow !== "project-review-v1" || snapshot.details.environmentVersion !== String(key[2])) continue;
      const identity = practiceTargetIdentity(snapshot);
      if (row.commitSha === analysis.collection?.commitSha && key[2] === environment.deploymentVersion && identity === practiceTargetIdentity(target)) current.add(row.kind);
      else {
        const groupKey = JSON.stringify([row.commitSha, key[2], identity]);
        const group = groups.get(groupKey) ?? { commit: row.commitSha, environmentVersion: key[2], kinds: new Set<SecurityRecordKind>() };
        group.kinds.add(row.kind); groups.set(groupKey, group);
      }
    } catch { /* Malformed or unrelated records never count as current progress. */ }
  }
  return { current: [...current], previous: [...groups.values()].slice(0, 6).map(group => ({ commit: group.commit, environmentVersion: group.environmentVersion, count: group.kinds.size })) };
}
export function extensionRecordDraft(review: ProjectReview, environment: DeploymentConnectionSnapshot) {
  // Educational observations never credit actual security verification completion.
  const draft = reviewRecordDraft({ ...review, completed: false }, environment);
  if (draft.targetSnapshot && !environment.deployment.vercelUrl) delete draft.targetSnapshot.deploymentUrl;
  draft.memo = JSON.stringify({ ...JSON.parse(draft.memo), recordMode: "manual-observation", executionApproved: false });
  return draft;
}
export function extensionObservation(value: unknown): { kind: SecurityRecordKind; review: ProjectReview } {
  if (!value || typeof value !== "object") throw new Error("관찰 기록을 확인하세요.");
  const { kind, review } = value as { kind: SecurityRecordKind; review: ProjectReview };
  if (!reviewKinds.includes(kind) || !review || !Object.hasOwn(reviewOutcomes, review.outcome)
    || typeof review.completed !== "boolean" || ["expected", "observed", "notes", "evidence", "codeLocation"].some(key => typeof review[key as keyof ProjectReview] !== "string")
    || review.expected.length > 1000 || review.observed.length > 2000 || review.notes.length > 800 || review.evidence.length > 800 || review.codeLocation.length > 1000
    || containsCredentialMaterial(review) || !review.completed || !reviewContentComplete(review)) throw new Error("기대 결과·관찰 결과·근거를 입력하세요. 해당 없음은 사유가 필요하며 인증정보는 저장할 수 없습니다.");
  return { kind, review };
}
