import type { RepositoryAnalysis } from "@/types/analysis";
import { emptySecurityRecord, type SecurityRecordDraft, type SecurityRecordKind } from "@/types/securityTestRecord";
import type { DeploymentConnectionSnapshot } from "./findingPreparation";
import { containsCredentialMaterial } from "./manualAccess";

export const reviewKinds: SecurityRecordKind[] = ["SQL_INJECTION", "XSS", "IDOR", "AUTHORIZATION"];
export const reviewOutcomes = { UNSET: "선택 전", OBSERVED: "문제 발견", NOT_OBSERVED: "문제 미관찰", INCONCLUSIVE: "판정 불가", NOT_APPLICABLE: "해당 없음" } as const;
export type ReviewOutcome = keyof typeof reviewOutcomes;
export type ProjectReview = { completed: boolean; outcome: ReviewOutcome; expected: string; observed: string; notes: string; evidence: string; codeLocation: string };
export const emptyProjectReview = (): ProjectReview => ({ completed: false, outcome: "UNSET", expected: "", observed: "", notes: "", evidence: "", codeLocation: "" });
export const reviewGuides: Record<SecurityRecordKind, { concept: string; expected: string; procedure: string[]; defense: string }> = {
  SQL_INJECTION: { concept: "입력값이 SQL 문법과 섞여 의도하지 않은 DB 작업으로 해석되는 문제입니다.", expected: "SQL을 사용하는 기능에서는 입력이 쿼리 구조를 바꾸지 않고 매개변수 값으로 처리되어야 합니다. SQL을 사용하지 않는다면 관련성부터 확인하세요.", procedure: ["분석 근거의 입력과 SQL 실행 코드를 확인합니다. 관련 기능이 미확인이라면 존재를 추정하지 않습니다.", "합성 DB의 정상 입력과 경계값을 기존 테스트로 비교하고 값 바인딩·오류 처리·데이터 노출 여부를 관찰합니다.", "SQL 기능이 없는 경우 그 근거와 분석 범위를 기록합니다. MongoDB의 NoSQL Injection은 이 가이드의 자동 분석 범위가 아닙니다."], defense: "매개변수 바인딩, 안전한 ORM API, 식별자 허용 목록, 최소 DB 권한과 안전한 오류 처리를 검토하세요." },
  XSS: { concept: "사용자 입력이 브라우저에서 텍스트 대신 실행 가능한 HTML/스크립트로 해석되는 문제입니다.", expected: "텍스트는 텍스트로 출력되고, HTML이 필요한 위치에는 해당 문맥에 맞는 정화·인코딩이 적용되어야 합니다.", procedure: ["입력 출처·HTML 출력·정화 근거와 실제 렌더링 문맥을 확인합니다.", "격리된 브라우저와 합성 입력으로 정상 텍스트·특수문자의 표시와 인코딩을 비교합니다. 운영 사용자에게 입력을 노출하지 않습니다.", "반영이나 HTML 표시만으로 코드 실행 또는 안전성을 확정하지 말고 관찰 범위를 기록합니다."], defense: "일반 JSX 텍스트·textContent를 우선하고 필요한 HTML에는 유지 관리되는 정화 도구와 문맥별 인코딩을 적용하세요. CSP는 추가 방어입니다." },
  IDOR: { concept: "리소스 식별자를 바꿨을 때 다른 사용자의 비공개 데이터에 접근할 수 있는 문제입니다.", expected: "비공개 리소스의 접근은 인증 사용자·소유자·tenant 범위로 제한되어야 합니다. 공개 리소스의 예외 정책은 사용자가 확인해야 합니다.", procedure: ["관찰된 식별자·DB 조회·소유권 검사와 업무상 공개 범위를 확인합니다.", "격리 환경의 합성 계정 A/B와 각자의 리소스로 본인·다른 사용자 접근을 비교합니다.", "응답 코드뿐 아니라 반환 데이터와 변경 여부를 기록합니다. 실제 소유 관계가 미확인이면 판정 불가로 남깁니다."], defense: "서버에서 객체별 인가를 적용하고 조회·수정 범위를 인증 주체로 제한하세요. 클라이언트가 보낸 ownerId를 신뢰하지 마세요." },
  AUTHORIZATION: { concept: "사용자 역할이나 작업 권한이 서버에서 올바르게 검증되지 않는 문제입니다.", expected: "업무 정책상 허용된 역할만 작업을 수행해야 하며, 거부된 요청은 응답이나 부작용을 발생시키지 않아야 합니다. 필수 역할은 코드 이름만으로 결정하지 않습니다.", procedure: ["관찰된 서버 작업·역할 검사·검사 시점과 사용자 확인이 필요한 정책을 구분합니다.", "합성 역할별 테스트 계정으로 승인된 격리 환경에서 같은 작업의 허용·거부 결과를 비교합니다.", "클라이언트 UI 제한과 서버 인가를 구분하고, 거부 시 데이터 변경이 없는지도 기록합니다."], defense: "인증과 인가를 분리하고 서버의 작업 전 권한 검증·기본 거부·역할별 회귀 테스트를 적용하세요." },
};

export function projectGuideEvidence(analysis: RepositoryAnalysis, kind: SecurityRecordKind) {
  const report = kind === "SQL_INJECTION" ? analysis.sqlInjection : kind === "XSS" ? analysis.xss : analysis.accessControl;
  return { findings: report?.findings.filter(f => f.type === kind) ?? [], limitations: report?.limitations ?? ["이 분석에는 해당 유형의 분석 정보가 없습니다."],
    points: kind === "SQL_INJECTION" ? analysis.sqlInjection?.coverage?.sinks ?? [] : kind === "XSS" ? analysis.xss?.coverage?.sinks ?? [] : [] };
}
export function confirmedReviewEnvironment(connectionId: string, snapshot?: DeploymentConnectionSnapshot) {
  return Boolean(snapshot?.connectionId === connectionId && snapshot.deployment.vercelUrl && snapshot.deployment.ownershipStatus === "VERIFIED" && snapshot.deployment.verifiedAt);
}
export function reviewContentComplete(review: ProjectReview) {
  return review.outcome !== "UNSET" && Boolean(review.expected.trim() && review.observed.trim() && review.evidence.trim()
    && (review.outcome !== "NOT_APPLICABLE" || review.notes.trim())) && !containsCredentialMaterial(review);
}
export function reviewProgress(reviews: Record<SecurityRecordKind, ProjectReview>) {
  const completed = reviewKinds.filter(kind => reviews[kind].completed && reviewContentComplete(reviews[kind])).length;
  return { completed, percent: completed * 25 };
}
export function reviewRecordKey(connectionId: string, version: number, kind: SecurityRecordKind) { return JSON.stringify(["project-review-v1", connectionId, version, kind]); }
export function reviewRecordDraft(review: ProjectReview, snapshot: DeploymentConnectionSnapshot): SecurityRecordDraft {
  // Site root is a user-registered review scope, never an inferred application API.
  const target = { apiPath: "/", method: "GET", inputLocation: "manual-project-review", parameter: "", deploymentUrl: snapshot.deployment.vercelUrl!, details: { workflow: "project-review-v1", environmentVersion: String(snapshot.deploymentVersion), scope: "등록 사이트 전체 검토 범위 · API 추정 아님" } };
  return { ...emptySecurityRecord({ apiPath: "/", method: "GET", targetSnapshot: target, codeLocation: review.codeLocation }),
    status: review.outcome === "OBSERVED" ? "OBSERVED" : review.outcome === "NOT_OBSERVED" ? "NOT_OBSERVED" : review.outcome === "UNSET" ? "NOT_RUN" : "INCONCLUSIVE",
    inspectionMethod: review.expected, beforeObservation: review.observed,
    memo: JSON.stringify({ workflow: "project-review-v1", completed: review.completed && reviewContentComplete(review), outcome: review.outcome, notes: review.notes, evidence: review.evidence }) };
}
export function reviewFromRecord(draft: SecurityRecordDraft): ProjectReview | null {
  try {
    const meta = JSON.parse(draft.memo);
    if (meta.workflow !== "project-review-v1" || !Object.hasOwn(reviewOutcomes, meta.outcome) || typeof meta.completed !== "boolean" || typeof meta.notes !== "string" || typeof meta.evidence !== "string") return null;
    const review: ProjectReview = { completed: meta.completed, outcome: meta.outcome, notes: meta.notes, evidence: meta.evidence, expected: draft.inspectionMethod, observed: draft.beforeObservation, codeLocation: draft.codeLocation };
    if (containsCredentialMaterial(review)) return null;
    return { ...review, completed: review.completed && reviewContentComplete(review) };
  } catch { return null; }
}
