"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderGit2, LoaderCircle, Search } from "lucide-react";

type Row = {
  id: string; name: string; owner: string; visibility: string; branch: string;
  suspended: boolean; status: string; analyzedAt: string | null; startedAt: string | null;
};
const statuses: Record<string, string> = { NONE: "분석 전", RUNNING: "분석 중", COMPLETED: "분석 완료", FAILED: "분석 실패" };

export function RepositoryList({ repositories }: { repositories: Row[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [sort, setSort] = useState("name");
  const router = useRouter();
  const running = repositories.some(row => row.status === "RUNNING");
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), 10000);
    return () => clearInterval(timer);
  }, [running, router]);
  const rows = repositories.filter(row => `${row.owner}/${row.name}`.toLowerCase().includes(query.toLowerCase()) && (status === "ALL" || row.status === status))
    .sort((a, b) => sort === "recent" ? (b.startedAt ?? "").localeCompare(a.startedAt ?? "") : `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`));
  return (
    <section aria-label="연결된 저장소">
      <div className="repository-filters">
        <label className="search-field"><Search size={18} /><span className="sr-only">저장소 검색</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="소유자 또는 저장소 이름 검색" /></label>
        <label>상태 <select value={status} onChange={event => setStatus(event.target.value)}><option value="ALL">전체 상태</option>{Object.entries(statuses).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>정렬 <select value={sort} onChange={event => setSort(event.target.value)}><option value="name">이름순</option><option value="recent">최근 분석순</option></select></label>
      </div>
      <p className="result-count" role="status">연결된 저장소 {repositories.length}개 · 검색 결과 {rows.length}개</p>
      {!repositories.length ? <div className="tutor-card quiet-empty">
        <FolderGit2 size={32} /><h2>아직 연결된 저장소가 없어요</h2>
        <p>GitHub App을 설치하고 학습할 저장소를 허용한 뒤 목록을 동기화해 주세요.</p>
        <Link className="primary-action" href="/api/github/installations/start">첫 저장소 연결하기</Link>
      </div> : !rows.length ? <div className="tutor-card quiet-empty">
        <h2>검색 결과가 없어요</h2><p>검색어나 상태 필터를 바꿔 보세요.</p>
        <button className="secondary-action" onClick={() => { setQuery(""); setStatus("ALL"); }}>검색 초기화</button>
      </div> : <div className="repository-list">{rows.map(row => (
        <article className="tutor-card repository-row" key={row.id}>
          <div className="repository-info">
            <span className="card-kicker">{row.owner}</span>
            <h2><FolderGit2 size={19} /><span className="repository-name">{row.name}</span><span className="visibility-badge">{row.visibility === "PUBLIC" ? "공개" : row.visibility === "PRIVATE" ? "비공개" : "내부"}</span></h2>
            <dl className="repository-metadata">
              <div><dt>브랜치</dt><dd>{row.branch}</dd></div>
              <div><dt>마지막 분석 종료</dt><dd>{row.analyzedAt ? <time dateTime={row.analyzedAt}>{new Date(row.analyzedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" })}</time> : "기록 없음"}</dd></div>
            </dl>
          </div>
          <div className="repository-state">
            <span className={`status-badge status-${row.status.toLowerCase()}`}>{row.status === "RUNNING" && <LoaderCircle className="spin" size={14} />}{statuses[row.status]}</span>
            {row.suspended ? <p className="notice-error">설치가 중지되었습니다. 관리에서 권한을 확인해 주세요.</p> : row.status === "FAILED" ? <p className="notice-error">다시 분석하면 상세 오류를 확인할 수 있어요.</p> : row.status === "RUNNING" ? <p>상태를 자동 확인하고 있어요.</p> : null}
          </div>
          <div className="repository-row-actions">
            {!row.suspended && (row.status === "RUNNING" ? <button className="secondary-action" disabled>분석 중…</button> : <Link className="primary-action" href={`/repository?connected=${encodeURIComponent(row.id)}`}>{row.status === "COMPLETED" ? "분석 결과 보기" : row.status === "FAILED" ? "다시 분석하기" : "분석 시작"} →</Link>)}
            <details className="repository-manage">
              <summary aria-label={`${row.name} 저장소 관리`}>관리</summary>
              <div>
                <a href={`https://github.com/${encodeURIComponent(row.owner)}/${encodeURIComponent(row.name)}`} target="_blank" rel="noreferrer">GitHub에서 보기 ↗</a>
                <Link href="/api/github/installations/start">App 권한 관리 ↗</Link>
              </div>
            </details>
          </div>
        </article>
      ))}</div>}
    </section>
  );
}
