import Link from "next/link";
import { ArrowUpRight, BookOpen, Crosshair } from "lucide-react";
import { LocalPracticeStatus } from "./LocalIdorLab";
import { BASIC_SITE_URL, IDOR_LAB_URL, SQLI_LAB_URL } from "@/lib/security-lab/basicSiteConnection";
import styles from "./practice.module.css";
import { LocalPracticeLink } from "./LocalPracticeLink";

export const practiceTopics = [
  { id: "idor", title: "IDOR", level: "입문", label: "객체 접근 제어", description: "게시글 번호를 변경했을 때 다른 사용자의 비공개 데이터에 접근할 수 있는지 확인합니다.", goal: "취약한 객체 접근과 안전한 접근 제어의 차이 이해", url: IDOR_LAB_URL },
  { id: "sqli", title: "SQL Injection", level: "기초", label: "검색 조건 우회", description: "검색 입력이 SQL 쿼리에 영향을 주는 상황을 실습합니다.", goal: "취약한 SQL 처리와 안전한 매개변수 바인딩의 차이 이해", url: SQLI_LAB_URL },
  { id: "xss", title: "XSS", level: "초급", label: "브라우저의 입력 해석", description: "사용자 입력이 브라우저에서 코드로 해석되는 상황을 격리된 환경에서 확인합니다.", goal: "취약한 HTML 출력과 안전한 출력 인코딩 비교", url: `${BASIC_SITE_URL}/lab/xss` },
  { id: "authz", title: "권한 검증", level: "초급", label: "관리자 기능 접근", description: "일반 사용자와 관리자의 API 접근 결과를 비교합니다.", goal: "인증과 인가의 차이 및 서버 측 권한 검증 이해", url: `${BASIC_SITE_URL}/lab/authz` },
];

export function PracticeDashboard() {
  return <main id="main-content" className={`vl-main ${styles.page}`}>
    <header className={styles.hero}><small>VULNLAB / LOCAL PRACTICE</small><h1>아는 만큼, 바로 실험하세요.</h1><p>두 모드 모두 같은 실습 웹사이트를 사용합니다. 처음이라면 행동 결과로 진행하는 가이드 실습을, 직접 탐색하려면 자유 실습을 선택하세요.</p><div className={styles.pills}><span>학습·퀴즈 선행 조건 없음</span><span>가상 계정과 데이터</span><span>로컬 격리 환경</span></div></header>
    <div className={styles.heading}><h2>실습 선택</h2><span>4개 환경 · 취약 모드 / 안전 모드 비교</span></div>
    <div className={styles.grid}>{practiceTopics.map((topic, i) => <article id={topic.id} key={topic.id} className={styles.card}>
      <h2>{topic.title}</h2><div className={styles.cardTop}><span className={styles.level}>난이도 · {topic.level}</span><span><Crosshair size={17}/> LAB 0{i + 1} · {topic.label}</span></div>
      <p>{topic.description}</p><div className={styles.goal}><small>실습 목표</small><strong>{topic.goal}</strong></div>
      <p>가이드 실습: 웹사이트에서 미션을 수행하고 실제 결과로 진행합니다.<br/>자유 실습: 같은 웹사이트를 직접 탐색하고 필요할 때만 힌트를 확인합니다.</p>
      <div className={styles.actions}><LocalPracticeLink className={styles.primary} aria-label={`${topic.title} 가이드 실습 (새 탭)`} href={`${topic.url}${topic.url.includes("?") ? "&" : "?"}mode=guided`} target="_blank" rel="noopener noreferrer">가이드 실습 <ArrowUpRight size={16}/></LocalPracticeLink><LocalPracticeLink className={styles.secondary} aria-label={`${topic.title} 자유 실습 (새 탭)`} href={`${topic.url}${topic.url.includes("?") ? "&" : "?"}mode=free`} target="_blank" rel="noopener noreferrer">자유 실습 <ArrowUpRight size={16}/></LocalPracticeLink><Link className={styles.secondary} href={`/learn/${topic.id}`}><BookOpen size={15}/> 개념 학습하기</Link></div>
    </article>)}</div>
    <LocalPracticeStatus/>
    <section className={styles.paths} aria-labelledby="practice-paths"><h2 id="practice-paths">시작하는 방법은 달라도, 확인할 근거는 같습니다.</h2><div><p><strong>가이드 실습</strong><span>실습 계정 로그인 → 웹사이트 미션 수행 → 실제 결과 확인</span></p><p><strong>자유 실습</strong><span>실습 계정 로그인 → 자유 탐색 → 필요할 때만 힌트</span></p></div><p>실습 계정 로그인과 서버 활성화는 필요합니다. 개념 설명과 퀴즈는 /learn에서 학습합니다. 실습에서는 같은 게시판·검색·댓글·운영 화면을 사용하며, 모드 전환 시 입력과 실제 행동 기록을 유지합니다. 새로고침하면 진행 기록은 초기화됩니다.</p></section>
  </main>;
}
