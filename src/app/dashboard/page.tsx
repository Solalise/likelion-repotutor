import Link from "next/link";
import { ArrowRight, Braces, Files, GitFork, PlayCircle } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";

const metrics = [
  { icon: Files, label: "분석 파일", value: "4", note: "TypeScript / TSX" },
  { icon: Braces, label: "함수", value: "5", note: "선언 및 메서드" },
  { icon: GitFork, label: "코드 관계", value: "5", note: "Import + Call" },
];

export default function DashboardPage() {
  return (
    <div className="app-page dashboard-page">
      <AppHeader />
      <main className="dashboard-main">
        <div className="dashboard-heading"><div><span className="eyebrow">OVERVIEW</span><h1>분석 Dashboard</h1><p>정적 분석으로 Repository의 구조와 실행 흐름을 확인합니다.</p></div><Link href="/repository" className="primary-action"><PlayCircle size={17} /> Demo 분석 열기</Link></div>
        <section className="repo-card">
          <div className="repo-card-title"><div className="repo-avatar">R</div><div><span>LOCAL DEMO</span><h2>sample-repository</h2><p>로그인 기능의 최소 실행 흐름</p></div><div className="ready-badge"><i /> 분석 준비 완료</div></div>
          <div className="metric-grid">{metrics.map(({ icon: Icon, label, value, note }) => <article key={label}><Icon size={19} /><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></article>)}</div>
          <div className="repo-route"><div><span>주요 학습 흐름</span><strong>로그인 버튼 클릭 <i>→</i> API 요청 <i>→</i> 사용자 조회</strong></div><Link href="/repository">학습 흐름에서 탐색 <ArrowRight size={15} /></Link></div>
        </section>
        <section className="coming-next"><span>NEXT MILESTONE</span><h2>실제 GitHub Repository로 확장</h2><p>GitHub App과 Octokit을 연결해 사용자의 소스 파일을 수집하고, 현재 구현된 분석 파이프라인에 그대로 전달할 예정입니다.</p><div><span>GitHub App</span><span>인증</span><span>AI 코드 설명</span><span>분석 기록</span></div></section>
      </main>
    </div>
  );
}
