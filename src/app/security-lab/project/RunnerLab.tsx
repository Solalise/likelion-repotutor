"use client";
import { useEffect, useState, type ReactNode } from "react";
import { createRequestPreview } from "@/lib/security-lab/projectPlan";
import { verdictLabels, type RunnerPlan, type RunnerResult, type RunnerState } from "@/lib/security-lab/runnerTypes";
import styles from "./project.module.css";
import Link from "next/link";
import { useLabSession } from "@/components/security/LabSession";

export default function RunnerLab({ apiPath, resourceA, resourceB, children, mode = "legacy" }: { apiPath: string; resourceA: string; resourceB: string; children: ReactNode; mode?: "connection" | "practice" | "legacy" }) {
  const { data, update, remember, disconnect } = useLabSession();
  const { runnerPort, session, runnerState: state, plan, previous, policy, busy } = data;
  const setRunnerPort = (runnerPort: string) => update({ runnerPort });
  const setSession = (session: typeof data.session) => update({ session });
  const setState = (runnerState: RunnerState | undefined) => update({ runnerState });
  const setPlan = (plan: RunnerPlan | undefined) => { update({ plan }); if (plan?.result) remember(plan); };
  const setPrevious = (previous: RunnerResult) => update({ previous });
  const setPolicy = (policy: string) => update({ policy });
  const setBusy = (busy: boolean) => update({ busy });
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [readyToExecute, setReadyToExecute] = useState(false);
  const input = { apiPath, resourceA, resourceB, policy };
  const planMatches = plan && JSON.stringify(plan.input) === JSON.stringify(input);
  const preview = createRequestPreview(apiPath, resourceA, resourceB);

  useEffect(() => {
    setReadyToExecute(false);
  }, [apiPath, resourceA, resourceB, policy, plan?.id]);

  async function rpc(path: string, data: unknown, pairing = false) {
    const targetPort = pairing ? runnerPort : session?.port;
    if (!targetPort || !/^\d{4,5}$/.test(targetPort) || Number(targetPort) < 1024 || Number(targetPort) > 65535) throw new Error("실행기 포트는 1024~65535 정수로 입력해주세요.");
    if (!pairing && (!session || session.expiresAt <= Date.now())) throw new Error("페어링 세션이 없습니다. 다시 연결해주세요.");
    const response = await fetch(`http://127.0.0.1:${targetPort}/v1/${path}`, { method: "POST", credentials: "omit", redirect: "error", cache: "no-store",
      headers: { "Content-Type": "application/json", ...(!pairing && session ? { "X-Lab-Session": session.token } : {}) },
      body: JSON.stringify(data), signal: AbortSignal.timeout(30000) });
    const payload = await response.json();
    if (!response.ok) {
      if ([401,403].includes(response.status)) disconnect();
      throw new Error(payload.message ?? "실행기 요청을 확인해주세요.");
    }
    return payload;
  }
  async function action(work: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await work(); }
    catch (error) { setMessage(error instanceof TypeError ? "로컬 실행기에 연결하지 못했습니다. 실행기 상태, 정확한 Origin, 브라우저 로컬 네트워크 권한을 확인해주세요. 보안 설정을 낮추지 마세요." : error instanceof Error ? error.message : "실행 중 오류가 발생했습니다."); }
    finally { setBusy(false); }
  }

  return <>
    {mode === "connection" || mode === "legacy" ?
    <section className={styles.card} aria-labelledby="runner-heading"><span className={styles.step}>01 / LOCAL CONNECTION</span><h2 id="runner-heading">내 웹서비스 연결</h2><p>GitHub 로그인 없이 사용할 수 있습니다. 대상은 로컬 실행기에서 승인한 <strong>127.0.0.1의 테스트 서버</strong>뿐입니다. Vercel 등 원격 배포 사이트는 지원하지 않습니다.</p>
      <details><summary>처음 연결하는 방법</summary><ol><li>터미널에서 <code>node tools/security-lab-runner/server.mjs</code>를 실행합니다.</li><li>터미널에 표시된 로컬 관리 URL을 엽니다.</li><li>테스트 서버 포트, 현재 페이지의 정확한 Origin, A/B 테스트 토큰과 응답 필드를 등록합니다.</li><li>관리 화면의 일회용 페어링 코드를 아래에 입력합니다. 코드는 2분간 한 번만 유효합니다.</li></ol><p>예제 서버: <code>node tools/security-lab-runner/demo-server.mjs</code><br />예제 API: <code>{"/vulnerable/orders/{resourceId}"}</code> → 수정 후 <code>{"/fixed/orders/{resourceId}"}</code></p></details>
      <div className={styles.grid}><div><label className={styles.label} htmlFor="runner-port">로컬 실행기 포트 (테스트 서버 포트 아님)</label><input id="runner-port" className={styles.input} inputMode="numeric" value={runnerPort} onChange={event => setRunnerPort(event.target.value)} disabled={busy || Boolean(session)} /></div><div><label className={styles.label} htmlFor="pair-code">일회용 페어링 코드</label><input id="pair-code" className={styles.input} type="password" autoComplete="off" value={code} onChange={event => setCode(event.target.value)} disabled={busy || Boolean(session)} /></div></div>
      <div className={styles.actions}><button className={styles.refresh} disabled={busy || Boolean(session) || !code} onClick={() => void action(async () => { const payload = await rpc("pair", { code }, true); setSession({ token: payload.token, port: runnerPort, expiresAt: payload.expiresAt }); setState(payload); setPlan(undefined); setCode(""); setMessage("페어링 완료. 대상과 토큰은 로컬 관리 화면에서만 변경할 수 있습니다."); })}>실행기 페어링</button>{session && <><button className={styles.refresh} disabled={busy} onClick={() => void action(async () => { const next = await rpc("state", {}); setState(next); setPlan(next.plan); setMessage("실행기 응답을 확인했습니다. 아래 대상과 현재 계획을 확인하세요."); })}>실행기 상태 확인</button><button className={styles.refresh} disabled={busy} onClick={() => { disconnect(); setMessage("이 탭의 연결 정보를 삭제했습니다. 실행기 토큰까지 폐기하려면 로컬 관리 화면에서 설정·토큰·세션 폐기를 선택해주세요."); }}>이 탭 연결 해제</button></>}</div>
      {session ? <p className={styles.confirmed}>페어링 확인 · 승인된 대상 {state?.target} · 실시간 연결 여부는 상태 확인 버튼으로 확인하세요.</p> : <p className={styles.note}>현재 탭에 유효한 페어링 세션이 없습니다. 새로고침하면 다시 연결해야 합니다.</p>}
      <p role="status" className={styles.note}>{message}</p>
    </section>
    : <section className={styles.card} aria-labelledby="runner-heading"><span className={styles.step}>01 / LOCAL CONNECTION</span><h2 id="runner-heading">내 웹서비스 연결</h2><p>GitHub 로그인 없이 사용할 수 있습니다. {session ? `이 탭에서 ${state?.target ?? "로컬 실행기"}와 페어링한 세션을 사용합니다. 실제 상태는 실행기가 요청 시 다시 확인합니다.` : "아직 이 탭에서 로컬 실행기 연결을 확인하지 않았습니다. 먼저 내 웹서비스에서 승인된 테스트 서버를 연결해주세요."}</p><Link className="bp-secondary" href="/services">{session ? "연결과 승인 범위 확인 →" : "내 웹서비스에서 실행기 연결 →"}</Link><p className={styles.note} role="status">{message}</p></section>}
    {mode !== "connection" && <>
    <section className={styles.card}><span className={styles.step}>02 / ATTACK METHOD</span><h2>공격 방식 선택</h2><div className="bp-attack-grid"><div className="bp-attack-active"><span className={styles.badge}>IDOR · 선택됨 · GET 지원</span><h3>다른 계정의 데이터 접근</h3><p>다른 계정의 리소스 ID를 대입해 서버가 객체별 접근권한을 검사하는지 확인합니다.</p></div>{["XSS", "SQL Injection", "관리자 권한 검사"].map(method=><div className="bp-attack-future" key={method} aria-disabled="true"><strong>{method}</strong><small>준비 중 · 실행 불가</small></div>)}</div></section>
    {children}
    <section className={styles.card}><span className={styles.step}>05 / APPROVAL & EXECUTION</span><h2>사용자 승인 후 실제 요청 실행</h2><p>위 API 경로와 리소스를 설정한 뒤 계획을 등록하세요. A/B 토큰과 신원 확인 경로·예상 사용자 ID·JSON 필드 위치는 실행기의 로컬 관리 화면에서 입력합니다.</p>
      <label className={styles.label} htmlFor="policy">리소스 접근 정책</label><select id="policy" className={styles.input} value={policy} onChange={event => setPolicy(event.target.value)} disabled={busy}><option value="owner-only">소유자만 접근 가능 · 공유 권한 없는 테스트 데이터</option><option value="unknown">정책을 확인하지 못함 · 판정 보류</option></select>
      <p className={styles.note}>서로 다른 A/B 신원을 확인하지 못하면 실행기는 판정을 보류하고 리소스 요청을 중단합니다. 한 실행은 신원 확인 2회 + 리소스 조회 3회, 최대 5회·요청당 4초입니다.</p>
      <button className={styles.refresh} disabled={busy || !session || preview.length !== 3} onClick={() => void action(async () => { if (plan?.result) setPrevious(plan.result); const created = await rpc("plans", input); setPlan(created); setMessage("계획을 등록했습니다. 로컬 관리 화면에서 현재 상태·계획 확인 → 정확한 대상과 5개 경로 확인 → 승인 후 이 화면에서 승인 상태를 확인하세요."); })}>현재 조건으로 요청 계획 등록</button>
      {plan && <><pre className={styles.runnerPre}>{JSON.stringify({ target: plan.target, policy: plan.policy, expiresAt: new Date(plan.expiresAt).toLocaleTimeString("ko-KR"), requests: plan.requests }, null, 2)}</pre>
        {!planMatches && <p className={styles.error}>입력 조건이 변경되었습니다. 새 계획을 등록하고 다시 승인해주세요.</p>}
        <div className={styles.actions}><button className={styles.refresh} disabled={busy || !session} onClick={() => void action(async () => { const next = await rpc("state", {}); setState(next); setPlan(next.plan); setReadyToExecute(false); setMessage(next.plan?.approved ? "로컬 승인이 확인되었습니다. 최종 실행 확인 후 전송할 수 있습니다." : "아직 승인되지 않았거나 계획이 만료되었습니다."); })}>로컬 승인 상태 확인</button></div>
        <label className={styles.label}><input type="checkbox" checked={readyToExecute} onChange={event => setReadyToExecute(event.target.checked)} disabled={busy || !planMatches || !plan.approved || plan.used} /> 승인된 테스트 대상에 위 GET 요청을 실제 전송합니다.</label>
        <button className={styles.refresh} disabled={busy || !session || !planMatches || !plan.approved || plan.used || !readyToExecute || plan.expiresAt <= Date.now()} onClick={() => void action(async () => { const executed = await rpc("execute", { planId: plan.id }); setPlan(executed); setReadyToExecute(false); setMessage("실제 HTTP 검증이 완료되었습니다. 아래 결과와 근거를 확인하세요."); })}>{busy ? "처리 중…" : "승인된 계획 실제 실행"}</button></>}
      {plan?.result && <><div className="bp-result-link"><Link href="/results">현재 세션의 검증 결과에서 자세히 보기 →</Link></div><ResultPanel result={plan.result} previous={previous} /></>}
    </section>
    </>}
  </>;
}

export function ResultPanel({ result, previous }: { result: RunnerResult; previous?: RunnerResult }) {
  return <section className={styles.result} aria-live="polite"><span className={styles.step}>06 / OBSERVED RESULT</span><h2>{verdictLabels[result.verdict]}</h2><p>{result.reason}</p><p>{result.scope}</p><p>실제 요청 {result.requestCount}회 · 응답은 설정한 ID·소유자·보호 데이터 지문만 표시합니다. 원문·토큰·응답 헤더는 전송하지 않습니다.</p>{result.evidence.map((item, index) => <article className={styles.evidence} key={index}><h3>{item.purpose} · 계정 {item.account}</h3><code>GET {item.path}</code><pre className={styles.runnerPre}>{JSON.stringify({ status: item.status, error: item.error, response: item.response }, null, 2)}</pre></article>)}
    <h3>왜 소유권 검사가 필요한가요?</h3><p>로그인은 사용자가 누구인지 확인합니다. 인가는 그 사용자가 해당 리소스를 볼 수 있는지 확인합니다. 서버는 ID로 조회한 뒤 현재 사용자의 소유권 또는 공유 권한을 확인해야 합니다. 버튼을 숨기는 것만으로는 보호되지 않습니다.</p><pre className={styles.runnerPre}>{`// 서버에서 조회 범위와 권한을 확인하세요.\nconst order = await findOrder(id);\nif (!order || order.ownerId !== verifiedUser.id) {\n  return forbidden();\n}\nreturn json(order);`}</pre>
    <h3>수정 후 재검증</h3><p>자신의 로컬 서버 코드를 수정하고 재시작한 뒤 같은 API 경로·A/B 데이터로 새 계획을 등록·승인·실행하세요. 매 실행에 별도 승인이 필요합니다. 계정·소유권·응답 필드 조건이 달라지면 동일 조건 비교가 아닙니다.</p>{previous && <p>이전 실행: <strong>{verdictLabels[previous.verdict]}</strong> → 이번 실행: <strong>{verdictLabels[result.verdict]}</strong><br />{result.comparisonKey && result.comparisonKey === previous.comparisonKey ? "동일한 대상·요청·계정·응답 필드 설정으로 비교했습니다." : "테스트 설정이 달라졌거나 동일 조건을 확인하지 못했습니다. 참고용 비교입니다."}</p>}</section>;
}
