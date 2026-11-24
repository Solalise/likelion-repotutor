import type { RepositoryAnalysis } from "@/types/analysis";
import type { FileExclusion } from "@/types/scanCoverage";
import { scanStatusLabels } from "@/types/scanCoverage";
import { scanPresentation } from "@/lib/repository/scanPresentation";

const reasons: Record<FileExclusion, string> = {
  "unsupported-language": "미지원 언어·파일 형식", "excluded-directory": "제외 디렉터리", "generated-file": "선언·생성·압축 파일",
  "empty-file": "빈 파일", "file-size-limit": "파일 크기 제한 (256KiB)", "file-count-limit": "파일 개수 제한 (200개)", "total-byte-limit": "전체 소스 크기 제한 (8MiB)",
};
export function AnalysisSummary({ analysis }: { analysis: RepositoryAnalysis }) {
  const collection = analysis.collection, manifest = collection?.manifest;
  const inspected = new Set(analysis.files.map(file => file.path));
  const diagnostics = analysis.diagnostics ?? [];
  const securityFiles = new Set([...(analysis.sqlInjection?.findings ?? []), ...(analysis.xss?.findings ?? []), ...(analysis.accessControl?.findings ?? [])].map(f => f.filePath));
  const securityDiagnostics = diagnostics.filter(d => d.kind !== "unresolved" || securityFiles.has(d.filePath) || /db|mongo|prisma|sql|auth|session|permission|sanitize|security/i.test(d.code));
  const unresolved = analysis.files.flatMap(file => file.functions.flatMap(fn => (fn.relations ?? []).filter(relation => !analysis.edges.some(edge => edge.source === fn.id && edge.target === relation.targetId && edge.relation === relation.relation && edge.line === relation.line)).map(relation => ({ filePath: file.path, ...relation }))));
  const internal = unresolved.filter(r => !r.diagnosticKind || r.diagnosticKind === "internal-unresolved");
  const securityRelations = internal.filter(r => /query|execute|raw|find|save|auth|permission|session|sanitize|html|owner|role/i.test(r.name));
  const statuses = (["SQL_INJECTION", "XSS", "IDOR", "AUTHORIZATION"] as const).map(kind => scanPresentation(analysis, kind).status);
  const status = statuses.every(s => s === "failed") ? "failed" : statuses.every(s => s === "unsupported") ? "unsupported"
    : statuses.some(s => s === "partial" || s === "failed" || s === "unsupported") || collection?.partial ? "partial" : "completed";
  return <section aria-label="전체 분석 요약">
    <h3>전체 분석 요약</h3>
    <p role="status">전체 상태: {scanStatusLabels[status]} · 유형별 지원 범위와 실패 여부는 아래 카드에서 확인하세요.</p>
    <p>저장소: {analysis.repository} · 커밋: <code>{collection?.commitSha ?? "로컬 합성 코드 / 커밋 미제공"}</code></p>
    <p><strong>기술 스택</strong> · 프레임워크: {analysis.technology?.frameworks.join(", ") || "미확인"} · DB: {analysis.technology?.databases.join(", ") || "미확인"} · ORM/ODM: {analysis.technology?.persistence.join(", ") || "미확인"}</p>
    {analysis.technology?.databases.includes("MongoDB") && !analysis.sqlInjection?.coverage?.sinks.length && <p>MongoDB/Mongoose 사용 근거가 있고 SQL 실행 지점은 관찰되지 않았습니다. MongoDB 쿼리는 SQL Injection 분석 대상이 아니며 NoSQL Injection은 미지원입니다. IDOR·권한 검증은 직접 모델 호출만 제한적으로 검토합니다.</p>}
    {Boolean(analysis.serverActions?.length) && <p>Server Actions {analysis.serverActions!.length}개 · 인수/FormData 입력을 추적합니다. 자동 API URL·배포 호출·인가 효과는 확정하지 않습니다.</p>}
    <dl className="repository-metadata">
      <div><dt>저장소 전체 파일</dt><dd>{collection?.repositoryFiles ?? "미기록"}</dd></div>
      <div><dt>수집 조건을 통과한 분석 가능 파일</dt><dd>{collection?.analyzableFiles ?? "미기록"}</dd></div>
      <div><dt>실제 검사 파일</dt><dd>{analysis.files.length}</dd></div>
      <div><dt>제외 파일</dt><dd>{collection?.repositoryFiles === undefined ? "미기록" : collection.repositoryFiles - analysis.files.length}</dd></div>
      <div><dt>파싱 오류 / 내부 미해결 관계</dt><dd>{diagnostics.filter(d => d.kind === "parse").length} / {internal.length}</dd></div>
    </dl>
    <p>정적 검토 결과입니다. 검사 완료·후보 없음은 안전성 또는 실제 취약점의 증명이 아닙니다. 전체 파일은 Git 아카이브의 일반 파일 기준이며 디렉터리·심볼릭 링크는 포함하지 않습니다.</p>
    {collection?.partial && <p role="status">일부 완료: 수집 제한으로 빠진 파일이 있습니다.</p>}
    <details><summary>검사·제외 파일과 수집 제한 확인</summary>
      <p>JS/TS · 파일당 256KiB · 최대 200개 / 소스 8MiB · 압축 15MiB / 해제 50MiB. 분석 가능 파일은 언어·생성 파일·크기 필터를 통과한 파일입니다. 파싱 오류 파일도 검사 시도 수에 포함됩니다.</p>
      {manifest ? <ul>{manifest.map(file => <li key={file.path}><code>{file.path}</code> · {file.bytes} bytes · {inspected.has(file.path) ? "검사" : file.reason ? reasons[file.reason] : "AST 입력 제외"}</li>)}</ul>
        : <><p>이전 결과에는 전체 수집 목록이 없습니다. 다시 분석하면 제외 사유를 확인할 수 있습니다.</p><ul>{analysis.files.map(file => <li key={file.path}>{file.path} · 검사</li>)}</ul></>}
    </details>
    {(securityDiagnostics.length > 0 || securityRelations.length > 0) && <details><summary>보안 관련 진단 ({securityDiagnostics.length + securityRelations.length}개)</summary>
      {securityDiagnostics.length ? <ul>{securityDiagnostics.map((d, i) => <li key={i}>{d.kind} · {d.filePath}:{d.line} · {d.message}<pre><code>{d.code}</code></pre></li>)}</ul> : <p>별도 보안 진단 없음</p>}
      <ul>{securityRelations.map((r, i) => <li key={i}>{r.filePath}:{r.line} · {r.name} · 보안 관련 내부 연결 미확정</li>)}</ul>
    </details>}
    <details><summary>개발자용 전체 진단·기술 스택 근거</summary>
      <ul>{diagnostics.map((d, i) => <li key={i}>{d.filePath}:{d.line} · {d.message}<pre><code>{d.code}</code></pre></li>)}</ul>
      <p>기본 태그 {unresolved.filter(r => r.diagnosticKind === "native-tag").length}개 · JS 내장 {unresolved.filter(r => r.diagnosticKind === "builtin").length}개 · React Hook {unresolved.filter(r => r.diagnosticKind === "react-hook").length}개 · 외부 라이브러리 {unresolved.filter(r => r.diagnosticKind === "external-library").length}개 · 내부 미확정 {internal.length}개</p>
      <ul>{analysis.technology?.evidence.map((e, i) => <li key={i}>{e.package} · {e.kind} · {e.source}</li>)}</ul>
      <ul>{analysis.technology?.notes.map(note => <li key={note}>{note}</li>)}</ul>
      <p>미해결 관계 {analysis.stats.unresolvedRelations ?? 0}개 · 연결되지 않은 API 요청 {analysis.stats.unmatchedApiRequests ?? 0}개</p>
      <ul>{unresolved.map((r, i) => <li key={i}>{r.filePath}:{r.line} · {r.name} · {r.diagnosticKind ?? "internal-unresolved"}</li>)}</ul>
    </details>
  </section>;
}
