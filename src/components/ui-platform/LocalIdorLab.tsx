"use client";

import { useEffect, useState } from "react";
import { BASIC_SITE_URL, checkBasicSite, localPracticeAvailable, type BasicSiteHealth, type BasicSiteStatus } from "@/lib/security-lab/basicSiteConnection";
import { localPracticeUnavailableMessage } from "./LocalPracticeLink";

type Status = BasicSiteStatus | "ready";
const stateLabel = (state: Status, health: BasicSiteHealth | null) => {
  if (state === "checking") return "로컬 실습 서버 확인 중…";
  if (state === "unavailable") return "서버 상태를 확인할 수 없습니다. 실행 여부나 브라우저의 로컬 네트워크 접근을 확인하세요.";
  return `서버 실행 중 · IDOR ${health?.idorEnabled ? "활성화" : "비활성화"} · SQL Injection ${health?.sqliEnabled ? "활성화" : "비활성화"} · XSS ${health?.xssEnabled ? "활성화" : "비활성화"} · 권한 검증 ${health?.authzEnabled ? "활성화" : "비활성화"}`;
};

export function LocalPracticeStatus() {
  if (!localPracticeAvailable()) return <section className="vl-card" id="local-lab-status"><h2>기초 실습 · 로컬 개발 전용</h2><p role="status">{localPracticeUnavailableMessage}</p></section>;
  return <LocalPracticeStatusDevelopment />;
}

function LocalPracticeStatusDevelopment() {
  const [status, setStatus] = useState<Status>("checking");
  const [health, setHealth] = useState<BasicSiteHealth | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => controller.abort(), 3000);
    void checkBasicSite(controller.signal).then(result => {
      if (!active) return;
      setHealth(result);
      setStatus(result ? "ready" : "unavailable");
    });
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [attempt]);

  const needsSetup = status !== "ready" || !health?.idorEnabled || !health?.sqliEnabled || !health?.xssEnabled || !health?.authzEnabled;
  return <section className="vl-card" id="local-lab-status" aria-labelledby="local-lab-status-title">
    <div className="vl-card-heading"><h2 id="local-lab-status-title">독립 실습 서버 상태 · 로컬 전용</h2>
      <button type="button" className="vl-outline-button" disabled={status === "checking"} onClick={() => { setStatus("checking"); setHealth(null); setAttempt(value => value + 1); }}>상태 다시 확인</button></div>
    <p className="vl-description">이 실습 사이트는 이 브라우저를 사용하는 PC에서 별도로 실행합니다. 다른 사용자에게 자동 제공되지 않습니다.</p>
    <p className="vl-small" role="status" aria-live="polite">{stateLabel(status, health)}</p>
    {needsSetup && <div className="vl-inline-note"><div>
      <h3>{status === "ready" ? "비활성화된 실습 켜기 (PowerShell)" : "실습 서버 실행 방법 (PowerShell)"}</h3>
      <p>별도 터미널에서 Node.js 24.14 이상으로 실행하세요. 네 실습을 모두 활성화하며, 이미 서버가 실행 중이면 Ctrl+C로 종료한 뒤 다시 시작하세요.</p>
      <pre className="vl-code">{`Set-Location D:\\likelion-repo\n$env:NODE_ENV = "development"\n$env:BASIC_SITE_ENABLE_IDOR = "1"\n$env:BASIC_SITE_ENABLE_SQLI = "1"\n$env:BASIC_SITE_ENABLE_XSS = "1"\n$env:BASIC_SITE_ENABLE_AUTHZ = "1"\n$env:BASIC_SITE_PORT = "4400"\nnpm.cmd --prefix labs/basic-site start`}</pre>
      <p>{BASIC_SITE_URL} · 상태는 확인 시점 기준입니다. 브라우저가 로컬 네트워크 접근을 차단하면 실행 중이어도 상태를 읽지 못할 수 있습니다. 실습 링크는 새 탭에서 직접 확인할 수 있습니다.</p>
      <p>서버를 실행한 뒤 ‘상태 다시 확인’을 누르세요. 상태 확인에 실패해도 위 카드의 ‘바로 실습하기’ 링크는 계속 사용할 수 있습니다.</p>
    </div></div>}
  </section>;
}

// Keep the old export available to any local imports while sharing the dual-lab status panel.
export const LocalIdorLab = LocalPracticeStatus;
