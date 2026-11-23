"use client";

import type { RepositoryAnalysis } from "@/types/analysis";
import type { AccessCheckEvidence, SqlInjectionEvidence } from "@/types/security";
import { useSecuritySession } from "./SecurityTestRecord";
import { ManualSecurityTarget, type ManualSecurityKind } from "./ManualSecurityTarget";
import { SourceCodeViewer } from "./SourceCodeViewer";

const controls: Record<AccessCheckEvidence["control"], string> = {
  "guard-before-operation": "작업 전 조건 분기 관찰 (거부 방향·정책은 직접 확인)",
  "query-filter": "DB where 범위 연결 관찰", "after-operation": "작업 이후 비교",
  "conditional-or-unused": "조건부·반환값 사용/차단 효과 미확인", unresolved: "구현·적용 미확인",
};
const kinds: Record<AccessCheckEvidence["kind"], string> = { authentication: "인증", ownership: "소유권", role: "역할", middleware: "미들웨어", "external-check": "외부 검사" };
function EvidenceList({ items }: { items: SqlInjectionEvidence[] }) {
  return <ul>{items.map((item, i) => <li key={`${item.filePath}:${item.line}:${i}`}>{item.description} · {item.filePath}:{item.line}<pre><code>{item.code}</code></pre></li>)}</ul>;
}

/** Static review only. Candidate forms reuse the same versioned manual target/record store. */
export function AccessStaticFindings({ analysis, kind }: { analysis: RepositoryAnalysis; kind: ManualSecurityKind }) {
  const [selectedId, setSelectedId] = useSecuritySession<string | undefined>(`access-selection:${kind}`, () => undefined);
  const report = analysis.accessControl, findings = report?.findings.filter(f => f.type === kind) ?? [];
  const selected = findings.find(f => f.id === selectedId) ?? findings[0];
  const title = kind === "IDOR" ? "IDOR" : "권한 검증";
  const file = selected && analysis.files.find(f => f.path === selected.filePath);
  const start = selected ? Math.max(1, selected.line - 4) : 1;
  const source = file?.sourceCode.split(/\r?\n/).slice(start - 1, Math.min(start + 42, (selected?.endLine ?? start) + 4)).join("\n");
  return <section aria-label={`${title} 정적 분석`}>
    <h3>{title} · 취약점 의심 후보</h3>
    <p>정적 분석 근거와 사용자의 HTTP 관찰·판단은 별도입니다. 실제 실행과 취약점은 미검증이며, 검사 코드 존재나 후보 없음으로 안전성을 보장하지 않습니다.</p>
    {!report ? <p role="status">이 분석에는 접근 제어 정보가 없습니다. 저장소를 다시 분석하세요. 아래 수동 등록은 계속 사용할 수 있습니다.</p> : <>
      <p role="status">분석 상태: {report.status === "failed" ? "실패 · 기존 SQLi/XSS 결과 유지" : report.status === "partial" || analysis.collection?.partial ? "일부 범위 미확인" : "지원 범위 분석 완료"} · 의심 후보 {findings.length}개{report.truncated ? " · 분석 예산 도달" : ""}</p>
      {!findings.length && <p>수집·지원 범위에서 후보를 찾지 못했습니다. 분석하지 못한 코드의 접근 정책은 수동 확인하세요.</p>}
      <div className="call-list" role="group" aria-label={`${title} 후보 선택`}>{findings.map(f => <button key={f.id} type="button" className="secondary-action" aria-pressed={selected?.id === f.id} onClick={() => setSelectedId(f.id)}>{f.filePath}:{f.line} · {f.functionName} · 취약점 의심 후보</button>)}</div>
      {selected && <article aria-label={`${title} 정적 후보 상세`}>
        <h4>{selected.functionName} · {selected.filePath}:{selected.line}</h4>
        <dl className="repository-metadata">
          <div><dt>확인된 API</dt><dd>{selected.api ? `${selected.api.method} ${selected.api.path} (구문 관계 확인 · 실행 미검증)` : "미확인 · 경로와 메서드 직접 입력"}</dd></div>
          <div><dt>작업 관계</dt><dd>{selected.operationRelation === "confirmed" ? "기존 서버·DB 관계 확인" : "이름·클라이언트 단서 추정"}</dd></div>
          <div><dt>근거 수준</dt><dd>{{ HIGH: "높음", MEDIUM: "중간", LOW: "낮음" }[selected.confidence]} · 취약점 확률 아님</dd></div>
          <div><dt>검사 코드</dt><dd>{selected.reviewState === "CHECKS_OBSERVED" ? "관련 구문 관찰 · 보호 효과 미검증" : "수집 범위에서 보호 효과 미확인"}</dd></div>
        </dl>
        <SourceCodeViewer sourceCode={source || selected.code} startLine={source ? start : selected.line} highlightLine={selected.line} />
        <h4>의심 근거</h4><p>{selected.reason}</p><EvidenceList items={selected.evidence} />
        <h4>확인된 호출 경로</h4>{selected.callPath.length ? <EvidenceList items={selected.callPath} /> : <p>직접 진입점이거나 확정된 추가 호출 경로가 없습니다.</p>}
        <h4>인증·인가 검사 코드</h4>{selected.checks.length ? <ul>{selected.checks.map((c,i) => <li key={i}>{kinds[c.kind]} · {c.relation === "confirmed" ? "구문 관계 확인" : "추정 관계"} · {controls[c.control]}<EvidenceList items={[c]} /></li>)}</ul> : <p>관련 검사를 확정하지 못했습니다. 외부 함수·미들웨어·RLS 검사가 없다는 뜻은 아닙니다.</p>}
        <h4>분석하지 못한 부분</h4><ul>{selected.limitations.map(l => <li key={l}>{l}</li>)}</ul>
        <h4>직접 확인할 사항</h4><ul>{selected.manualChecks.map(l => <li key={l}>{l}</li>)}</ul>
        <details><summary>{kind === "IDOR" ? "계정 A/B·리소스 비교 대상 확인" : "역할·작업 비교 대상 확인"}</summary>
          <ManualSecurityTarget key={selected.id} kind={kind} candidate={selected} />
        </details>
      </article>}
      <details><summary>분석 경계 및 전체 제한</summary><EvidenceList items={report.boundaries} /><ul>{report.limitations.map(l => <li key={l}>{l}</li>)}</ul></details>
    </>}
  </section>;
}
