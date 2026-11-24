import type { RepositoryAnalysis } from "@/types/analysis";
import type { SecurityRecordKind } from "@/types/securityTestRecord";
import { projectGuideEvidence, reviewKinds } from "./projectReview";
import { containsCredentialMaterial } from "./manualAccess";
import { scanPresentation } from "@/lib/repository/scanPresentation";
import { collectReviewFeatures, type ReviewFactRole, type ReviewFeature } from "./reviewFeatures";

export type GuideSource = { id: string; location: string; code: string; reason: string; role?: ReviewFactRole };
export type GuideStep = { id: string; action: string; explanation: string; expected: string; observe: string; sourceIds: string[]; featureId?: string; feature?: string; preparation?: string; interpretation?: { expected: string; unexpected: string; unknown: string } };
export type GuideFeature = Omit<ReviewFeature, "facts"> & { sourceIds: string[]; roles: ReviewFactRole[] };
export type ProjectGuide = { kind: SecurityRecordKind; applicability: "review" | "not-applicable" | "unsupported" | "inconclusive"; summary: string; sources: GuideSource[]; steps: GuideStep[]; features: GuideFeature[] };
export type GuideBundle = { guides: ProjectGuide[]; origin: "ai" | "fallback"; reason?: string; cached?: boolean };
const relevant: Record<SecurityRecordKind, ReviewFactRole[]> = {
  SQL_INJECTION: ["input", "sql", "database"], XSS: ["form", "input", "server-action", "database", "output"],
  IDOR: ["database", "input", "ownership", "role", "authentication", "server-action"], AUTHORIZATION: ["role", "authentication", "server-action", "database", "form"],
};
function idorOperations(feature: ReviewFeature) {
  return feature.facts.filter(f => f.role === "database" && /\bfindById(?:And\w+)?\s*\(|\b(?:findOne|findUnique|updateOne|deleteOne|update|delete)\s*\([^\n]*(?:\b_id|\bid)\s*:/.test(f.code)).map(operation => {
    const checks = feature.facts.filter(f => f.ownerId === operation.ownerId);
    const owned = checks.some(f => f.role === "ownership" && /\.(?:ownerId|userId|tenantId)\s*[!=]==?|\b(?:findOne|findUnique|updateOne|deleteOne|update|delete)\s*\(\s*\{[^}]*(?:ownerId|userId|tenantId)\s*:/.test(f.code));
    const restricted = checks.some(f => f.role === "role");
    return { ownerId: operation.ownerId, score: owned || restricted ? 100 + Number(owned) * 80 + Number(restricted) * 40 : 0 };
  }).filter(operation => operation.score > 0);
}
function featureScore(feature: ReviewFeature, kind: SecurityRecordKind) {
  const has = (role: ReviewFactRole) => feature.facts.some(f => f.role === role);
  if (kind === "SQL_INJECTION") return has("sql") ? 100 + Number(has("input")) * 20 : 0;
  if (kind === "XSS") {
    const fields = feature.facts.filter(f => f.role === "input").flatMap(f => [...f.code.matchAll(/\.get\(\s*["'](\w+)["']/g)].map(m => m[1]));
    const matchingField = fields.some(field => feature.facts.some(f => f.role === "output" && f.code.includes(`.${field}`)));
    return has("output") ? 1 + Number(has("input")) * 50 + Number(has("database")) * 30 + Number(has("form")) * 20 + Number(matchingField) * 30 : 0;
  }
  if (kind === "IDOR") {
    // DOM keys and owner-scoped lists do not establish an object-specific operation.
    return Math.max(0, ...idorOperations(feature).map(operation => operation.score));
  }
  return (has("role") ? 80 : 0) + (has("authentication") ? 30 : 0) + (has("server-action") && has("database") ? 10 : 0);
}
export function buildReviewGuides(analysis: RepositoryAnalysis): ProjectGuide[] {
  const all = collectReviewFeatures(analysis);
  return reviewKinds.map(kind => {
    const sources: GuideSource[] = [], features: GuideFeature[] = [];
    const ranked = all.filter(f => featureScore(f, kind) > 0).sort((a, b) => featureScore(b, kind) - featureScore(a, kind));
    const inputConnected = ranked.filter(f => f.facts.some(fact => fact.role === "input"));
    const roleConnected = ranked.filter(f => f.facts.some(fact => fact.role === "role"));
    const selected = (kind === "XSS" && inputConnected.length ? inputConnected : kind === "AUTHORIZATION" && roleConnected.length ? roleConnected : ranked).slice(0, 2);
    for (const feature of selected) {
      const ids: string[] = [];
      const owners = kind === "IDOR" ? new Set(idorOperations(feature).map(operation => operation.ownerId)) : undefined;
      const facts = owners ? feature.facts.filter(f => owners.has(f.ownerId)) : feature.facts;
      for (const role of relevant[kind]) for (const fact of facts.filter(f => f.role === role).sort((a, b) => Number(/FormData/.test(a.code)) - Number(/FormData/.test(b.code))).slice(0, 2)) {
        if (containsCredentialMaterial(fact) || /(?:^|\/)(?:\.env|secrets?|credentials?|private)(?:[./]|$)/i.test(fact.location)) continue;
        let source = sources.find(s => s.location === fact.location && s.role === fact.role);
        if (!source) { source = { id: `${kind}:s${sources.length}`, location: fact.location, code: fact.code, reason: fact.reason, role: fact.role }; sources.push(source); }
        ids.push(source.id);
      }
      if (ids.length) features.push({ id: feature.id, label: feature.label, sourceIds: [...new Set(ids)], roles: [...new Set(facts.map(f => f.role))], relations: feature.relations, limitations: feature.limitations });
    }
    // Existing scanner evidence remains useful, but arbitrary file-boundary line 1 never becomes an operation.
    if (!sources.length) for (const point of [...projectGuideEvidence(analysis, kind).findings.map(f => ({ filePath: f.filePath, line: f.line, code: f.code, description: f.reason })), ...projectGuideEvidence(analysis, kind).points].slice(0, 4)) {
      if (!point.code || containsCredentialMaterial(point) || /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(JSON.stringify(point))) continue;
      sources.push({ id: `${kind}:s${sources.length}`, location: `${point.filePath}:${point.line}`, code: point.code.slice(0, 1000), reason: point.description });
    }
    if (!features.length && sources.length && kind !== "IDOR") features.push({ id: `${kind}-unmapped`, label: "관찰된 코드 구문 · 서비스 페이지 연결 미확인", sourceIds: sources.map(s => s.id), roles: [], relations: [], limitations: ["관련 페이지·입력·출력의 연결이 확인되지 않았습니다."] });
    const status = scanPresentation(analysis, kind).status;
    const mongoOnly = kind === "SQL_INJECTION" && (analysis.technology?.databases ?? []).some(db => /mongo/i.test(db)) && !sources.length;
    const applicability: ProjectGuide["applicability"] = kind === "IDOR" && !features.length ? "inconclusive" : sources.length ? "review" : status === "failed" || analysis.collection?.partial ? "inconclusive" : mongoOnly ? "not-applicable" : status === "unsupported" ? "unsupported" : "inconclusive";
    const summary = applicability === "not-applicable" ? "MongoDB 사용이 확인되며 SQL 실행 지점은 관찰되지 않았습니다. 분석 범위에서 SQL 사용 여부를 확인하세요. NoSQL Injection은 별도 범위입니다."
      : applicability === "unsupported" ? "관련 기능을 현재 분석기로 확인하지 못했습니다. 미지원이며 안전함이나 해당 없음의 증명이 아닙니다."
        : applicability === "inconclusive" ? "관련 기능의 근거가 부족하거나 분석이 불완전하여 판정할 수 없습니다."
          : `${features.map(f => f.label).join(" / ")}의 구문을 확인했습니다. 입력·DB·출력의 런타임 전달, 소유 정책과 관리자 전용 여부는 확인한 범위에서만 기록하세요.`;
    const target = features[0];
    const refs = target?.sourceIds ?? [];
    const roles = target?.roles ?? [];
    const interpretation = { expected: "선택한 범위에서 기대 동작과 일치했다는 수동 관찰입니다. 서비스 전체의 안전 증명이 아닙니다.", unexpected: "문제 의심으로 기록하고 실제 조건과 코드를 다시 확인하세요. 취약점 확정은 아닙니다.", unknown: "환경·정책·코드 연결을 확인하지 못했다면 판정 불가로 남기세요. 미확인 결과를 채우지 마세요." };
    const step = (id: string, action: string, explanation: string, preparation: string, expected: string, observe: string, ids = refs): GuideStep => ({ id, action, explanation, preparation, expected, observe, sourceIds: ids, featureId: target?.id, feature: target?.label ?? "적용 범위 확인", interpretation });
    const steps: GuideStep[] = [];
    if (!features.length) steps.push(step("scope", applicability === "not-applicable" ? "사용 중인 DB가 MongoDB인지 확인하세요." : "검토 대상을 선정할 근거가 충분한지 확인하세요.", kind === "IDOR" ? "공개 목록이나 로그인 확인만으로 대상을 선정하지 않습니다. 객체 식별자와 같은 작업의 소유권·접근 제한 근거가 부족해 판정 불가입니다." : summary, "관련 기능과 정책을 담당자나 기존 테스트 기록에서 확인하세요. 없는 기능을 만들거나 경로를 추측하지 않습니다.", "기술 미사용과 근거 부족·미지원을 구분합니다.", "대상이나 정책을 확인하지 못했다면 판정 불가를 선택하세요."));
    else if (kind === "XSS") {
      steps.push(step("map", "사용자 입력이 표시되는 기능과 코드 연결을 확인하세요.", `${target.label}에서 입력 요소·액션·DB·출력 구문을 순서대로 펼쳐 보세요. ${roles.includes("input") ? "입력 구문이 관찰되었습니다." : "입력 출처는 미확인입니다."} 정적 연결은 저장 후 출력의 증명이 아닙니다.`, "비밀정보 없는 합성 입력 문구와 승인된 격리 환경을 준비하세요. 환경이 없으면 코드 검토만 진행합니다.", "입력한 문구를 표시하는 위치와 HTML 처리 방식이 구분됩니다.", "입력·출력 연결을 실제로 확인했는지, 일부만 확인했는지 선택하세요."));
      steps.push(step("text", "격리 환경에서 무해한 HTML 모양의 문구가 어떻게 보이는지 확인하세요.", "승인된 격리 환경에서만 고정된 무해한 예시 <b>VulnLab 메모</b>를 사용하세요. 스크립트나 이벤트 속성은 사용하지 않습니다. 저장·출력 경로가 미확인이면 실행 대신 코드만 확인하세요.", "기존 입력·출력 기능이 확인된 경우에만 합성 데이터를 만드세요. 기존 운영 데이터는 사용하지 않습니다.", "일반 텍스트 필드에서는 태그가 문자로 보입니다. HTML을 허용하는 기능이라면 허용 정책과 정화 처리를 별도로 확인합니다.", "그대로 보임·서식으로 해석됨·확인 못함을 구분해 기록하세요. 서식 해석만으로 XSS 확정은 아닙니다."));
    } else if (kind === "IDOR") {
      steps.push(step("policy", "이 데이터가 누구의 것인지 먼저 확인하세요.", `${target.label}의 객체 식별자와 조회·변경 조건을 확인하세요. ${roles.includes("ownership") ? "소유자·사용자 식별자 구문이 관찰됐지만 접근 제한 조건인지 확인해야 합니다." : "소유권 조건은 확인되지 않았습니다."} 공개 데이터인지 작성자 전용인지 업무 정책은 담당자가 확인해야 합니다.`, "승인된 격리 환경, 합성 계정 A·B, 각 계정이 만든 별도 데이터, 공개·비공개 정책을 준비하세요.", "공개 정책은 그대로 허용하고 비공개 데이터에는 객체별 서버 접근 제한을 적용합니다.", "데이터 소유자·공개 정책·식별자를 확인했는지 선택하세요."));
      steps.push(step("access", "본인 데이터와 다른 계정 데이터의 접근 결과를 비교하세요.", "승인된 격리 환경에서 기존 객체별 접근 제어 테스트를 실행하거나 기록을 읽으세요. 필요한 경로나 기능이 확인되지 않았다면 추측해 만들지 마세요.", "A의 데이터와 B의 데이터가 섞이지 않도록 합성 식별자를 기록하세요. 운영 계정·실제 데이터는 사용하지 않습니다.", "본인에게 허용된 작업은 가능하고, 비공개인 타인 데이터는 내용 노출과 변경 없이 거부됩니다.", "응답 성공 여부뿐 아니라 표시된 데이터 소유자와 변경 발생 여부를 비교하세요."));
    } else if (kind === "AUTHORIZATION") {
      steps.push(step("roles", "이 서버 작업을 누가 실행할 수 있어야 하는지 확인하세요.", `${target.label}의 인증 호출과 역할 조건을 구분해 읽으세요. ${roles.includes("role") ? "역할 조건 구문이 관찰되었지만 관리자 전용 정책이나 실제 거부는 별도 확인이 필요합니다." : "역할 조건이 확인되지 않아 관리자 전용이라고 가정할 수 없습니다."}`, "승인된 격리 환경에서 일반 사용자·관리자 역할이 실제로 존재하는지 먼저 확인하고 합성 계정을 준비하세요.", "담당자가 확인한 역할 정책과 서버의 작업 권한 검사가 일치합니다.", "로그인만 검사하는지, 역할·작업 권한도 검사하는지, 아직 모르는지 선택하세요."));
      steps.push(step("denial", "허용 역할과 비허용 역할의 기존 테스트 결과를 비교하세요.", "실제 확인된 서버 작업에 대한 기존 권한 테스트를 사용하세요. 버튼 숨김만으로 서버 권한 검사가 된다고 판단하지 않습니다.", "합성 계정과 되돌릴 수 있는 합성 데이터를 사용하세요. 역할이 없는 프로젝트라면 해당 없음 근거를 확인합니다.", "허용 역할의 작업은 성공하고 비허용 역할은 데이터 조회·수정 부작용 없이 거부됩니다.", "역할별 응답과 데이터 변경 여부를 확인하세요. 정책·테스트 환경 미확인은 판정 불가로 남기세요."));
    } else {
      steps.push(step("binding", "입력값과 SQL 호출 인수가 분리되어 있는지 확인하세요.", `${target.label}에서 입력 구문과 SQL 호출을 함께 읽으세요. ORM 사용만으로 모든 호출이 안전하다고 단정하지 않습니다.`, "관찰된 DB 기술과 쿼리 호출, 합성 데이터용 승인된 격리 DB를 준비하세요.", "입력값은 쿼리 문법에 합쳐지지 않고 매개변수나 안전한 ORM 값으로 전달됩니다.", "값 바인딩·문자열 결합·판정 불가 중 확인한 내용을 기록하세요."));
      steps.push(step("query-result", "기존 정상 입력·경계값 방어 테스트의 결과를 비교하세요.", "승인된 격리 DB에서 합성 값으로 작성된 기존 테스트만 사용하세요. 대상별 공격 입력이나 쿼리를 새로 만들지 않습니다.", "정상 값과 무해한 경계값의 예상 조회 범위를 미리 정하세요.", "허용한 데이터 범위만 처리하고 오류가 내부 쿼리나 비밀정보를 노출하지 않습니다.", "예상 건수·오류 처리·데이터 변경을 비교하고 확인하지 못한 항목은 남겨 두세요."));
    }
    return { kind, applicability, summary, sources, steps, features };
  });
}
