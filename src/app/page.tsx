import Link from "next/link";
import { ArrowRight, Bot, GitBranch, Github, Network, Sparkles } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";

const features = [
  { icon: GitBranch, number: "01", title: "기능별 코드 흐름 분석", description: "파일을 넘나드는 함수 호출과 import 관계를 AST로 정확하게 추적합니다." },
  { icon: Network, number: "02", title: "Repository 구조 시각화", description: "복잡한 코드베이스를 탐색 가능한 그래프로 바꿔 전체 구조를 한눈에 보여줍니다." },
  { icon: Bot, number: "03", title: "맥락 기반 코드 학습", description: "관련 코드만 선별해 AI가 기능의 동작 원리와 학습 포인트를 설명할 준비를 합니다." },
];

export default function HomePage() {
  return (
    <div className="landing-page">
      <AppHeader />
      <main>
        <section className="hero-section">
          <div className="hero-orb orb-one" /><div className="hero-orb orb-two" />
          <div className="hero-copy">
            <div className="hero-pill"><Sparkles size={14} /> 개발자를 위한 코드 러닝 맵</div>
            <h1>읽기 어려운 코드도,<br /><em>흐름을 보면 이해됩니다.</em></h1>
            <p>RepoTutor는 Repository를 분석해 코드의 구조와 호출 관계를<br className="desktop-only" /> 하나의 지도처럼 보여주는 코드 학습 도구입니다.</p>
            <div className="hero-actions">
              <Link href="/repository" className="primary-action">Demo repository 분석 <ArrowRight size={17} /></Link>
              <button className="secondary-action" disabled><Github size={17} /> GitHub 연결 <span>SOON</span></button>
            </div>
            <small>회원가입 없이 샘플 프로젝트를 바로 탐색할 수 있어요.</small>
          </div>
          <div className="hero-visual" aria-label="RepoTutor 코드 흐름 미리보기">
            <div className="visual-topbar"><i /><i /><i /><span>sample-repository / login flow</span></div>
            <svg className="connection-lines" viewBox="0 0 620 360" preserveAspectRatio="none" aria-hidden="true">
              <path d="M155 75 C235 75 205 142 298 142" /><path d="M385 142 C465 142 435 228 515 228" /><path d="M298 178 C238 178 252 270 160 270" />
            </svg>
            <div className="preview-node file-node" style={{ left: "7%", top: "13%" }}><span>TSX</span><div><small>PAGE</small><strong>LoginPage</strong></div></div>
            <div className="preview-node function-node" style={{ left: "38%", top: "34%" }}><span>ƒ</span><div><small>FUNCTION</small><strong>handleLogin()</strong></div></div>
            <div className="preview-node function-node" style={{ left: "70%", top: "58%" }}><span>ƒ</span><div><small>SERVICE</small><strong>login()</strong></div></div>
            <div className="preview-node repository-node" style={{ left: "8%", top: "70%" }}><span>DB</span><div><small>REPOSITORY</small><strong>findUser()</strong></div></div>
            <div className="visual-badge">AST based · deterministic</div>
          </div>
        </section>

        <section className="feature-section">
          <div className="section-heading"><span>HOW IT WORKS</span><h2>코드를 외우지 말고, 연결을 이해하세요.</h2><p>정적 분석으로 확인된 관계를 학습하기 좋은 크기로 좁혀갑니다.</p></div>
          <div className="feature-grid">{features.map(({ icon: Icon, number, title, description }) => <article key={number}><div className="feature-icon"><Icon size={21} /></div><span>{number}</span><h3>{title}</h3><p>{description}</p></article>)}</div>
        </section>
      </main>
      <footer><span>RepoTutor · First development milestone</span><Link href="/dashboard">Dashboard 보기 <ArrowRight size={13} /></Link></footer>
    </div>
  );
}
