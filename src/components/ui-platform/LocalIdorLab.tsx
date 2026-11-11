"use client";

import { useEffect, useState } from "react";
import { checkBasicSite, IDOR_LAB_URL, type BasicSiteStatus } from "@/lib/security-lab/basicSiteConnection";

const labels: Record<BasicSiteStatus, string> = {
  checking: "로컬 서버 확인 중…", ready: "실행 중 · IDOR 활성화", disabled: "서버 실행 중 · IDOR 비활성화",
  unavailable: "연결 확인 불가 · 서버 실행 또는 브라우저 권한 확인",
};

export function LocalIdorLab() {
  const [status, setStatus] = useState<BasicSiteStatus>("checking");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => controller.abort(), 3000);
    void checkBasicSite(controller.signal).then(next => { if (active) setStatus(next); });
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [attempt]);

  return <section className="vl-card" id="local-idor" aria-labelledby="local-idor-title">
    <div className="vl-card-heading"><h2 id="local-idor-title">IDOR 독립 실습 · 로컬 전용</h2></div>
    <p className="vl-description">이 브라우저를 사용하는 PC에서 직접 실행한 labs/basic-site로 이동합니다. 다른 사용자에게 자동 제공되는 실습 서버가 아닙니다.</p>
    <p className="vl-small" role="status" aria-live="polite">{labels[status]}</p>
    <div className="vl-actions">
      <a className="vl-button" href={IDOR_LAB_URL} target="_blank" rel="noopener noreferrer">IDOR 실습 열기 (새 탭)</a>
      <button type="button" className="vl-outline-button" disabled={status === "checking"} onClick={() => { setStatus("checking"); setAttempt(value => value + 1); }}>상태 다시 확인</button>
    </div>
    <p className="vl-small">{IDOR_LAB_URL} · 상태는 확인 시점 기준입니다. 브라우저가 로컬 네트워크 접근을 차단하면 실행 중이어도 확인할 수 없습니다. 이 경우 주소를 직접 열어 확인하세요.</p>
    {status !== "ready" && <div className="vl-inline-note"><div>
      <h3>실습 서버 실행 방법 (PowerShell)</h3>
      <p>Node.js 24.14 이상에서 별도 터미널을 열어 실행하세요. 실행 후 상태를 다시 확인하세요. 서버가 꺼져 있으면 새 탭에서 연결 오류가 표시됩니다.</p>
      <pre className="vl-code">{`Set-Location D:\\likelion-repo\n$env:NODE_ENV = "development"\n$env:BASIC_SITE_ENABLE_IDOR = "1"\n$env:BASIC_SITE_PORT = "4400"\nnpm.cmd --prefix labs/basic-site start`}</pre>
      {status === "disabled" && <p>기존 실습 서버를 Ctrl+C로 종료한 후 위 설정으로 다시 실행하세요.</p>}
    </div></div>}
  </section>;
}
