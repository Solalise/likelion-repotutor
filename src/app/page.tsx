import Link from "next/link";
import { ArrowUp, ArrowRight, BookOpen, Bot, Braces, FolderGit2, Github, MousePointer2, Network } from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";

const learningSteps = [
  { icon: FolderGit2, title: "저장소 연결", description: "GitHub로 로그인하고 App에서 학습할 저장소의 접근을 허용해요." },
  { icon: MousePointer2, title: "기능·함수 선택", description: "분석에서 찾은 페이지·함수 등 기능 후보를 살펴보고 궁금한 항목을 골라요." },
  { icon: Network, title: "코드 관계 탐색", description: "그래프와 실제 코드를 오가며 함수 호출과 파일 사이의 연결을 확인해요." },
  { icon: Bot, title: "AI 설명으로 이해", description: "연결한 저장소의 선택한 코드에 대해 설명을 요청하고 원문과 함께 읽어요." },
];

export default function HomePage() {
  return (
    <div className="landing-page landing-refresh">
      <AppHeader landing />
      <a className="landing-skip" href="#landing-main">본문으로 이동</a>
      <main id="landing-main">
        <section className="landing-hero landing-container" aria-labelledby="landing-title">
          <div className="landing-hero-copy">
            <span className="eyebrow">코드 읽기를 시작하는 개발자를 위해</span>
            <h1 id="landing-title">코드가 낯설 때,<br /><em>연결부터</em> 읽어보세요.</h1>
            <p>파일은 많은데 어디부터 읽어야 할지 막막한가요?<br />RepoTutor는 저장소의 코드 관계와 실제 소스를 함께 보여주는 코드 학습 공간입니다.</p>
            <div className="hero-actions">
              <Link href="/login" className="primary-action"><Github size={17} />GitHub로 시작하기</Link>
              <Link href="/repository" className="secondary-action">데모 분석 시작 <ArrowRight size={16} /></Link>
            </div>
            <small>로그인 없이 샘플을 먼저 살펴보세요. 내 저장소 연결은 로그인 후 진행합니다.</small>
          </div>
          <figure className="landing-flow-preview" aria-labelledby="flow-example-title">
            <figcaption><span><Network size={16} />코드 연결 미리보기</span><span className="example-label">예시 화면</span></figcaption>
            <div className="preview-context"><span>sample-repository</span><strong id="flow-example-title">로그인 코드, 이렇게 읽어요</strong></div>
            <ol className="example-flow" aria-label="로그인 샘플 코드의 연결을 설명하는 예시">
              <li><span className="example-node-icon"><Braces size={18} /></span><div><small>화면 컴포넌트</small><strong>LoginPage</strong><p>로그인 버튼이 있는 화면</p></div></li>
              <li><span className="example-node-icon"><MousePointer2 size={18} /></span><div><small>이벤트 처리</small><strong>handleLogin</strong><p>버튼을 누르면 호출하는 함수</p></div></li>
              <li><span className="example-node-icon"><Braces size={18} /></span><div><small>연결된 함수</small><strong>login</strong><p>로그인 요청을 보내는 함수</p></div></li>
            </ol>
            <div className="example-code"><code>onClick=&#123;handleLogin&#125;</code><span>관련 코드를 함께 확인</span></div>
            <p className="example-disclaimer">샘플 코드를 바탕으로 재구성한 설명용 예시입니다. 실제 분석 화면과 다르며, 전체 실행 순서를 보장하지 않습니다.</p>
          </figure>
        </section>

        <section className="landing-problem landing-container" aria-labelledby="problem-title">
          <div className="landing-section-heading"><span className="eyebrow">읽기의 출발점</span><h2 id="problem-title">파일을 열었지만,<br className="mobile-only" /> 맥락이 보이지 않을 때</h2><p>코드를 혼자 읽을 때 생기는 질문을, 작은 연결부터 풀어가세요.</p></div>
          <div className="landing-problem-grid">
            <article className="tutor-card"><span>01</span><h3>어디부터 읽을까요?</h3><p>저장소 구조와 분석에서 찾은 항목을 살펴보며 읽기 시작할 지점을 찾아요.</p></article>
            <article className="tutor-card"><span>02</span><h3>이 함수는 어디와 연결될까요?</h3><p>호출과 참조 관계를 그래프로 확인하고, 연결된 코드의 원문을 읽어요.</p></article>
            <article className="tutor-card"><span>03</span><h3>읽었는데 잘 이해되지 않나요?</h3><p>선택한 코드의 AI 설명을 참고하며, 이해한 내용을 실제 코드와 비교해요.</p></article>
          </div>
        </section>

        <section id="learning-process" className="landing-process" aria-labelledby="process-title">
          <div className="landing-container">
            <div className="landing-section-heading"><span className="eyebrow">학습 방법</span><h2 id="process-title">연결하고, 고르고, 따라 읽어요.</h2><p>작은 코드 하나를 이해하는 것부터 시작해 보세요.</p></div>
            <ol className="learning-process-list">{learningSteps.map(({ icon: Icon, title, description }, index) => <li key={title}>
              <div className="process-step-number"><span>0{index + 1}</span><Icon size={21} aria-hidden="true" /></div>
              <h3>{title}</h3><p>{description}</p>
            </li>)}</ol>
            <p className="process-note"><BookOpen size={16} />데모는 샘플 코드 탐색용입니다. 내 저장소의 AI 학습은 로그인과 저장소 연결 후 사용할 수 있어요.</p>
          </div>
        </section>

        <section className="landing-scope landing-container" aria-labelledby="scope-title">
          <div className="landing-section-heading"><span className="eyebrow">지금의 RepoTutor</span><h2 id="scope-title">코드에서 확인한 관계부터 차근차근</h2></div>
          <div className="landing-scope-grid">
            <article className="tutor-card"><span className="scope-label">현재 사용할 수 있어요</span><h3>코드 구조 탐색과 AI 학습</h3><ul><li>샘플 및 지원하는 저장소의 코드 분석</li><li>분석된 항목 선택, 코드 관계 그래프와 원문 탐색</li><li>연결한 저장소의 선택 코드에 대한 AI 설명</li></ul><p>현재 분석은 JavaScript·TypeScript 계열 코드를 대상으로 합니다. 그래프의 관계는 전체 실행 흐름과 다를 수 있어요.</p></article>
            <article className="tutor-card future-scope"><span className="scope-label">앞으로의 개발 목표</span><h3>기능 전체의 동작 흐름 이해</h3><p>사용자 입력부터 화면, API, 서버, DB까지 이어지는 기능 단위의 전체 흐름 분석은 향후 목표입니다.</p><p>지금은 자동으로 완성된 전체 기능 흐름을 제공하지 않습니다. 코드 피드백·문제 풀이·Teach-back·학습 기록 전용 화면도 준비 중입니다.</p></article>
          </div>
        </section>

        <section className="landing-start landing-container" aria-labelledby="start-title">
          <div><span className="eyebrow">첫 번째 코드 읽기</span><h2 id="start-title">궁금했던 코드, 함께 살펴볼까요?</h2><p>내 저장소로 시작하거나, 샘플에서 먼저 익숙해지세요.</p></div>
          <div className="hero-actions"><Link href="/login" className="primary-action"><Github size={17} />GitHub로 시작하기</Link><Link href="/repository" className="secondary-action">데모 분석 시작 <ArrowRight size={16} /></Link></div>
        </section>
      </main>
      <footer className="landing-footer"><Link href="/" className="footer-brand">RepoTutor</Link><span>코드를 읽는 나만의 학습 공간</span><a href="#learning-process">학습 방법 <ArrowUp size={13} /></a></footer>
    </div>
  );
}
