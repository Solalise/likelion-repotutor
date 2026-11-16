import Link from "next/link";
import { ArrowUpRight, BookOpen, Crosshair } from "lucide-react";
import { LocalPracticeStatus } from "./LocalIdorLab";
import { BASIC_SITE_URL, IDOR_LAB_URL, SQLI_LAB_URL } from "@/lib/security-lab/basicSiteConnection";
import styles from "./practice.module.css";

export const practiceTopics = [
  { id: "idor", title: "IDOR", level: "입문", label: "객체 접근 제어", description: "게시글 번호를 바꿨을 때 다른 사용자의 비공개 글이 반환되는지 확인합니다.", goal: "같은 세션·같은 ID로 취약 조회와 소유권 검사를 비교하기", url: IDOR_LAB_URL },
  { id: "sqli", title: "SQL Injection", level: "기초", label: "검색 조건 우회", description: "검색 입력이 SQL 조건으로 해석되는 상황을 실제 메모리 SQLite에서 재현합니다.", goal: "문자열 결합과 바인딩에서 동일 입력의 결과 비교하기", url: SQLI_LAB_URL },
  { id: "xss", title: "XSS", level: "기초", label: "브라우저의 입력 해석", description: "댓글 미리보기에서 HTML 해석과 안전한 텍스트 출력의 차이를 확인합니다.", goal: "격리된 프레임의 코드 실행과 출력 인코딩 비교하기", url: `${BASIC_SITE_URL}/lab/xss` },
  { id: "authz", title: "권한 검증", level: "입문", label: "관리자 기능 접근", description: "일반 사용자로 관리자 통계를 요청해 서버 역할 검사의 효과를 확인합니다.", goal: "로그인 검사만 있는 경로와 관리자 권한 검사 비교하기", url: `${BASIC_SITE_URL}/lab/authz` },
];

export function PracticeDashboard() {
  return <main id="main-content" className={`vl-main ${styles.page}`}>
    <header className={styles.hero}><small>VULNLAB / LOCAL PRACTICE</small><h1>아는 만큼, 바로 실험하세요.</h1><p>기초 학습과 독립된 네 가지 공격 실습입니다.<br/>처음이라면 개념부터, 익숙하다면 바로 요청을 보내고 결과를 비교하세요.</p><div className={styles.pills}><span>학습·퀴즈 선행 조건 없음</span><span>가상 계정과 데이터</span><span>로컬 격리 환경</span></div></header>
    <div className={styles.heading}><h2>실습 선택</h2><span>4개 환경 · 취약 / 안전 동작 비교</span></div>
    <div className={styles.grid}>{practiceTopics.map((topic, i) => <article id={topic.id} key={topic.id} className={styles.card}>
      <div className={styles.cardTop}><span><Crosshair size={17}/> LAB 0{i + 1} · {topic.label}</span><span className={styles.level}>난이도 · {topic.level}</span></div>
      <h2>{topic.title}</h2><p>{topic.description}</p><div className={styles.goal}><small>실습 목표</small><strong>{topic.goal}</strong></div>
      <div className={styles.actions}><a className={styles.primary} aria-label={`${topic.title} 가이드 실습 (새 탭)`} href={`${topic.url}${topic.url.includes("?") ? "&" : "?"}mode=guided`} target="_blank" rel="noopener noreferrer">가이드 실습 <ArrowUpRight size={16}/></a><a className={styles.secondary} aria-label={`${topic.title} 자유 실습 (새 탭)`} href={`${topic.url}${topic.url.includes("?") ? "&" : "?"}mode=free`} target="_blank" rel="noopener noreferrer">자유 실습 <ArrowUpRight size={16}/></a><Link className={styles.secondary} href={`/learn/${topic.id}`}><BookOpen size={15}/> 개념 학습하기</Link></div>
    </article>)}</div>
    <LocalPracticeStatus/>
    <section className={styles.paths} aria-labelledby="practice-paths"><h2 id="practice-paths">시작하는 방법은 달라도, 확인할 근거는 같습니다.</h2><div><p><strong>처음 배우는 사용자</strong><span>개념 학습 → 로컬 실습 로그인 → 선택형 단계 가이드 → 직접 재현</span></p><p><strong>바로 실험할 사용자</strong><span>바로 실습하기 → 로컬 실습 로그인 → 자유 요청 편집기 → 취약·안전 응답 비교</span></p></div><p>실습 계정 로그인과 서버 활성화는 필요합니다. 학습 완료나 퀴즈 점수는 실습 접근 조건이 아닙니다. 네 취약점 모두 6단계 가이드 실습과 즉시 재현하는 자유 실습을 제공합니다. 모드 사이를 이동해도 현재 화면의 가이드 진도는 유지되며 자유 실습 결과가 진도를 자동으로 올리지 않습니다.</p></section>
  </main>;
}
