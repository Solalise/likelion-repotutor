"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { checkBasicSite, localPracticeAvailable } from "@/lib/security-lab/basicSiteConnection";
import { LocalPracticeLink } from "@/components/ui-platform/LocalPracticeLink";
import styles from "./learning.module.css";

export function XssPracticeConnection({ learningComplete }: { learningComplete: boolean }) {
  const [state, setState] = useState<"checking" | "ready" | "disabled" | "unavailable" | "production">("checking");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => controller.abort(), 3000);
    void (async () => {
      if (!localPracticeAvailable()) { if (active) setState("production"); return; }
      const result = await checkBasicSite(controller.signal);
      if (active) setState(!result ? "unavailable" : result.xssEnabled ? "ready" : "disabled");
    })();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [attempt]);
  return <section className={styles.summary} aria-labelledby="xss-practice-title">
    <h3 id="xss-practice-title">XSS 실습 준비</h3>
    <p>기초 학습: {learningComplete ? "6/6단계 완료" : "진행 중"}<br/>실제 실습: 이 학습 화면에서는 완료 여부를 수집하지 않습니다.</p>
    <p role="status">{state === "checking" ? "실습 서버 연결 확인 중…" : state === "ready" ? "연결됨 · XSS 실습 사용 가능" : state === "disabled" ? "서버는 연결되었지만 XSS 실습이 꺼져 있습니다." : state === "production" ? "공개 배포 환경에서는 로컬 실습을 제공하지 않습니다." : "연결을 확인하지 못했습니다. 서버 실행·접속 기기·브라우저 권한을 확인하세요."}</p>
    {state === "ready" && <LocalPracticeLink className={styles.primary} href="http://127.0.0.1:4400/lab/xss?mode=guided" target="_blank" rel="noopener noreferrer">XSS 가이드 실습 시작 ↗</LocalPracticeLink>}
    {state !== "production" && <button type="button" disabled={state === "checking"} onClick={() => { setState("checking"); setAttempt(n => n + 1); }}>연결 다시 확인</button>}
    <p>실습은 새 탭에서 열립니다. 가상 계정으로 로그인한 뒤 같은 입력을 취약 모드와 안전 모드에 넣어 비교하세요. 실습 후 이 학습 탭으로 돌아오면 저장한 위치에서 계속할 수 있습니다. 퀴즈와 실제 실습은 별도 과정입니다.</p>
    {state !== "ready" && state !== "production" && <details><summary>연결하는 방법과 문제 해결</summary><ol><li>이 페이지를 연 PC의 터미널에서 프로젝트 폴더로 이동합니다.</li><li>아래 명령으로 로컬 서버를 실행합니다. 이미 실행 중이면 해당 서버를 종료한 뒤 다시 켜세요.</li></ol><pre className={styles.requestExample}>{'$env:NODE_ENV = "development"\n$env:BASIC_SITE_ENABLE_XSS = "1"\n$env:BASIC_SITE_PORT = "4400"\nnpm.cmd --prefix labs/basic-site start'}</pre><p>Node.js 24.14 이상이 필요합니다. 서버를 켠 뒤 ‘연결 다시 확인’을 누르세요. 실행 중인데 연결되지 않으면 포트 4400과 브라우저의 로컬 네트워크 접근 권한을 확인하세요.</p><p>127.0.0.1은 현재 접속한 기기 자신입니다. 휴대폰의 127.0.0.1로 PC 서버에 접속할 수 없습니다. 현재 제공되는 실습 링크는 서버를 실행한 PC의 브라우저에서 사용하세요. 다른 기기 지원은 별도 격리 환경과 연결 설정이 필요합니다.</p></details>}
    <Link className={styles.back} href="/practice">전체 실습 목록 →</Link>
  </section>;
}
