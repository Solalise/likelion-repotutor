"use client";

import { useState } from "react";
import type { RepositoryAnalysis } from "@/types/analysis";
import { SourceCodeViewer } from "./SourceCodeViewer";
import { FindingPreparation } from "./FindingPreparation";
import { AccessStaticFindings } from "./AccessStaticFindings";
import { ManualSecurityTarget, type ManualSecurityKind } from "./ManualSecurityTarget";
import { SecurityTargetRecords, SecurityTestRecordProvider } from "./SecurityTestRecord";
import { practiceTarget } from "@/lib/security-lab/practiceTarget";
import styles from "./securityFindings.module.css";

const levels = { HIGH: "높음", MEDIUM: "중간", LOW: "낮음" };

type FindingKind = "SQL_INJECTION" | "XSS" | "IDOR" | "AUTHORIZATION";

const findingTabs: { id: FindingKind; label: string }[] = [
  { id: "SQL_INJECTION", label: "SQL Injection" },
  { id: "XSS", label: "XSS" },
  { id: "IDOR", label: "IDOR" },
  { id: "AUTHORIZATION", label: "권한 검증" },
];
const manualKinds: ManualSecurityKind[] = ["IDOR", "AUTHORIZATION"];

export function SqlInjectionFindings({ analysis, connectionId, archived = false }: { analysis: RepositoryAnalysis; connectionId?: string; archived?: boolean }) {
  const [kind, setKind] = useState<FindingKind>("SQL_INJECTION");
  const [selectedId, setSelectedId] = useState<string>();
  const supported = kind === "SQL_INJECTION" || kind === "XSS";
  const title = findingTabs.find(tab => tab.id === kind)?.label ?? "";
  const report = kind === "SQL_INJECTION" ? analysis.sqlInjection : kind === "XSS" ? analysis.xss : undefined;
  const selected = report?.findings.find(finding => finding.id === selectedId) ?? report?.findings[0];
  const file = selected && analysis.files.find(item => item.path === selected.filePath);
  const firstLine = selected ? Math.max(1, selected.line - 4) : 1;
  const lastLine = selected ? Math.min(selected.endLine + 4, firstLine + 45) : 1;
  const source = file?.sourceCode.split(/\r?\n/).slice(firstLine - 1, lastLine).join("\n");
  const suggestedTarget = selected ? practiceTarget(analysis, selected) : undefined;

  return <SecurityTestRecordProvider key={JSON.stringify([connectionId, analysis.repository, analysis.collection?.commitSha])} archived={archived} persistence={analysis.collection?.commitSha ? { repositoryFullName: analysis.repository, commitSha: analysis.collection.commitSha } : undefined}><section className={`tutor-card ${styles.findings}`} aria-label="소스코드 취약점 정적 분석">
    <h2 id="sql-injection-findings-title">소스코드 취약점 정적 분석</h2>
    <p>SQL Injection·XSS·IDOR·권한 검증의 지원되는 코드 패턴을 정적으로 분석합니다. 모든 의심 후보는 실제 취약점 확정 결과가 아니며 HTTP 관찰과 사용자 판단을 별도로 기록합니다.</p>
    <div className={`view-toggle ${styles.tabs}`} role="group" aria-label="취약점 유형 선택">
      {findingTabs.map(tab => <button key={tab.id} type="button" aria-pressed={kind === tab.id}
        onClick={() => { setKind(tab.id); setSelectedId(undefined); }}>{tab.label}</button>)}
    </div>
    <p>저장소: {analysis.repository} · 커밋: <code>{analysis.collection?.commitSha ?? "확인되지 않음"}</code> · 수집 파일: {analysis.files.length}개{analysis.collection?.partial ? " (일부 수집)" : ""}</p>
    {!supported ? <AccessStaticFindings analysis={analysis} kind={kind as ManualSecurityKind} /> : !report ? <p role="status">현재 결과에는 {title} 분석 정보가 없습니다. 저장소를 다시 분석해 주세요.</p> : <>
      <h3>{title} 분석 결과</h3>
      <p role="status">입력 흐름 관찰 {report.findings.filter(item => item.relationship === "input-flow-observed" && !(item.type === "XSS" && item.disposition === "protected")).length}개 · 의심 후보 {report.findings.filter(item => item.relationship === "suspected" && !(item.type === "XSS" && item.disposition === "protected")).length}개{kind === "XSS" ? ` · 안전 처리 관찰 ${analysis.xss?.findings.filter(item => item.disposition === "protected").length ?? 0}개` : ""}{report.truncated ? " · 출력 지점 100개 표시 제한 도달" : ""}</p>
      {!report.findings.length && <p>현재 지원하는 패턴과 수집 범위에서 후보를 찾지 못했습니다. 저장소가 안전하다는 의미는 아닙니다.</p>}
      <div className="call-list" role="group" aria-label={`${title} 분석 항목 선택`}>
        {report.findings.map(finding => <button className="secondary-action" type="button" key={finding.id}
          aria-pressed={selected?.id === finding.id} onClick={() => setSelectedId(finding.id)}>
          {finding.filePath}:{finding.line} · {finding.type === "XSS" && finding.disposition === "protected" ? "안전 처리 관찰" : finding.relationship === "input-flow-observed" ? "입력 흐름 관찰" : "의심 후보"}{finding.type === "XSS" && finding.disposition === "protected" ? "" : ` · 위험도 ${levels[finding.severity]}`}
        </button>)}
      </div>
      {selected && <article aria-label={`선택한 ${title} 분석 항목 상세`}>
        <h3>{title} · {selected.type === "XSS" && selected.disposition === "protected" ? "안전 처리 관찰" : "취약점 후보"} · {selected.filePath}:{selected.line}</h3>
        <dl className="repository-metadata">
          <div><dt>위험도</dt><dd>{selected.type === "XSS" && selected.disposition === "protected" ? "해당 없음 (지원 문맥의 보호 처리 관찰)" : levels[selected.severity]}</dd></div>
          <div><dt>분석 확신 수준</dt><dd>{levels[selected.confidence]}</dd></div>
          <div><dt>{selected.type === "XSS" ? "HTML 출력 지점" : "SQL 실행 지점"}</dt><dd><code>{selected.sink}</code>{selected.type === "SQL_INJECTION" ? ` · ${selected.clientLibrary ?? "클라이언트 출처 미확정"}` : ""}</dd></div>
          <div><dt>입력 연결</dt><dd>{selected.relationship === "input-flow-observed" ? `입력 → 지역 값 → ${selected.type === "XSS" ? "HTML 출력" : "SQL 인수"}의 정적 연결 관찰` : "입력 또는 출력/실행 연결에 미확정 구간이 있음"}</dd></div>
          {selected.type === "XSS" && <>
            <div><dt>출력 환경</dt><dd>{selected.environment === "client" ? "클라이언트 DOM/React" : selected.environment === "server" ? "서버 HTML 응답" : "클라이언트/서버 또는 출력 의미 미확정"}</dd></div>
            <div><dt>보호 처리</dt><dd>{selected.protection === "sanitized" ? "HTML 정화 관찰" : selected.protection === "escaped" ? "HTML 텍스트 이스케이프 관찰" : "전체 출력의 안전성 미확정"}</dd></div>
          </>}
        </dl>
        <h4>관련 코드 위치</h4>
        <SourceCodeViewer key={selected.id} sourceCode={source ?? selected.code} startLine={source ? firstLine : selected.line} highlightLine={selected.line} />
        {selected.type === "XSS" && <><h4>입력 출처</h4>{selected.inputSources.length ? <ul>{selected.inputSources.map((item, index) => <li key={index}>{item.description} · {item.filePath}:{item.line}<pre><code>{item.code}</code></pre></li>)}</ul> : <p>지원하는 입력 출처를 확인하지 못했습니다.</p>}</>}
        <h4>탐지 근거와 입력·{selected.type === "XSS" ? "HTML" : "SQL"} 관계</h4>
        <ol>{selected.evidence.map((item, index) => <li key={`${item.filePath}:${item.line}:${index}`}>
          <strong>{item.description}</strong><p>{item.filePath}:{item.line}</p><pre><code>{item.code}</code></pre>
        </li>)}</ol>
        <h4>{selected.type === "XSS" && selected.disposition === "protected" ? "안전 처리 분류 근거" : "취약할 수 있는 이유"}</h4><p>{selected.reason}</p>
        <h4>안전한 수정 방법</h4><p>{selected.remediation}</p>
        <h4>추가 확인 사항</h4><ul>{selected.limitations.map(item => <li key={item}>{item}</li>)}</ul>
        <p>이 정적 분석 항목은 실제 실행 여부나 SQLi 성공을 판정하지 않습니다. HTTP 관찰 결과와 사용자 판단은 아래 검사 흐름에서 별도로 관리합니다.</p>
        {!(selected.type === "XSS" && selected.disposition === "protected") && <FindingPreparation analysis={analysis} finding={selected} connectionId={connectionId} />}
        <details key={selected.id}>
          <summary>검사 결과 수동 기록 · 수정 및 재검증</summary>
          <SecurityTargetRecords scope={`finding:${selected.type}:${selected.id}`} kind={selected.type} suggestion={suggestedTarget}
            codeLocation={`${selected.filePath}:${selected.line}–${selected.endLine}`} />
        </details>
      </article>}
      <details><summary>분석 지원 범위와 한계</summary><ul>{report.limitations.map(item => <li key={item}>{item}</li>)}</ul></details>
    </>}
    {manualKinds.map(manualKind => <div key={JSON.stringify([connectionId, analysis.repository, analysis.collection?.commitSha, manualKind])} hidden={!archived && kind !== manualKind}>
      <ManualSecurityTarget kind={manualKind} />
    </div>)}
  </section></SecurityTestRecordProvider>;
}
