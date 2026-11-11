"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./lab.module.css";

const endpoints = {
  vulnerable: "/api/security-lab/vulnerable/orders",
  fixed: "/api/security-lab/fixed/orders",
} as const;
type Result = { path: string; status?: number; statusText?: string; body: string; contentType?: string; cacheControl?: string };

export default function SecurityLab() {
  const [orderId, setOrderId] = useState("101");
  const [selected, setSelected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Partial<Record<keyof typeof endpoints, Result>>>({});
  async function send() {
    if (!selected || !/^\d{1,6}$/.test(orderId)) return;
    setBusy(true);
    setResults({});
    const id = orderId;
    try {
      await Promise.all((Object.keys(endpoints) as (keyof typeof endpoints)[]).map(async (mode) => {
        const path = `${endpoints[mode]}?orderId=${encodeURIComponent(id)}`;
        let result: Result;
        try {
          const response = await fetch(path, { method: "GET", credentials: "omit", cache: "no-store", redirect: "error" });
          result = { path, status: response.status, statusText: response.statusText, body: await response.text(), contentType: response.headers.get("content-type") ?? "", cacheControl: response.headers.get("cache-control") ?? "" };
        } catch {
          result = { path, body: "HTTP 응답을 받지 못했습니다. 로컬 서버 연결을 확인하고 다시 요청해주세요." };
        }
        setResults((previous) => ({ ...previous, [mode]: result }));
      }));
    } finally { setBusy(false); }
  }
  return <div className={styles.lab}>
    <header className={styles.header}><Link href="/learn">↖ 취약점 학습</Link><span>BREAKPROOF / IDOR 예제</span><span className={styles.pill}>읽기 전용 · 가상 데이터</span></header>
    <main id="main-content" className={styles.main}>
      <section className={styles.intro}><span className={styles.eyebrow}>직접 요청하며 배우는 보안</span><h1>번호 하나를 바꾸면,<br />누구의 주문이 보일까요?</h1><p>IDOR 실습 — 같은 요청을 두 API에 보내고, 소유권 검사 한 줄이 만드는 차이를 확인하세요.</p></section>
      <div className={styles.steps}><span>01 테스트 계정 선택</span><span>02 주문 ID 변경</span><span>03 실제 응답 비교</span></div>
      <section className={styles.card} aria-labelledby="request-title"><h2 id="request-title">요청 만들기</h2><p>사용자 A의 주문은 <strong>101</strong>, 사용자 B의 주문은 <strong>102</strong>입니다. 먼저 101을 요청한 뒤 102로 바꿔보세요.</p>
        <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <label>테스트 계정<select value={selected ? "A" : ""} onChange={(event) => setSelected(event.target.value === "A")} disabled={busy} required><option value="" disabled>계정을 선택하세요</option><option value="A">사용자 A · 내 주문 101</option></select></label>
          <label>주문 ID<input value={orderId} onChange={(event) => setOrderId(event.target.value)} inputMode="numeric" pattern="[0-9]{1,6}" maxLength={6} required disabled={busy} /></label>
          <button disabled={busy || !selected || !/^\d{1,6}$/.test(orderId)}>{busy ? "요청 중…" : "두 API에 요청 전송 →"}</button>
        </form><small>계정 선택은 실습용 역할입니다. 실제 로그인과 무관하며 서버의 테스트 신원은 A로 고정됩니다.</small>
      </section>
      <section className={styles.grid} aria-label="실제 HTTP 응답 비교" aria-live="polite" aria-busy={busy}>
        {(["vulnerable", "fixed"] as const).map((mode) => {
          const result = results[mode];
          return <article className={styles.card} key={mode}><div className={styles.titleRow}><h2>{mode === "vulnerable" ? "소유권 검사가 없는 API" : "소유권 검사를 추가한 API"}</h2><span className={styles.pill}>{mode === "vulnerable" ? "취약한 예제" : "수정된 예제"}</span></div>
            <p>{mode === "vulnerable" ? "주문 번호만 맞으면 누구의 주문이든 반환합니다." : "현재 사용자의 주문인지 확인한 뒤 반환합니다."}</p>
            {result ? <><h3>보낸 요청</h3><pre>{`GET ${result.path}\n인증 쿠키 전송 안 함 · 요청 본문 없음`}</pre><h3>받은 응답 {result.status && <span className={result.status === 200 ? styles.success : styles.denied}>{result.status}</span>}</h3><pre data-testid={`${mode}-response`}>{result.status ? `HTTP ${result.status} ${result.statusText}\ncontent-type: ${result.contentType}\ncache-control: ${result.cacheControl}\n\n${result.body}` : result.body}</pre><p>{result.status === 403 ? "접근 거부: B의 주문 내용은 응답에 포함되지 않습니다." : result.status === 200 ? "조회 성공: 응답의 ownerId와 현재 사용자 A를 비교해보세요." : "입력과 응답 메시지를 확인해주세요."}</p></> : <div className={styles.empty}>요청을 보내면 실제 HTTP 상태와 응답 본문이 여기에 표시됩니다.</div>}
          </article>;
        })}
      </section>
      <section className={styles.card}><span className={styles.eyebrow}>왜 이런 일이 생기나요?</span><h2>IDOR: 번호를 아는 것과 권한이 있는 것은 다릅니다</h2><p>IDOR(Insecure Direct Object Reference)은 주문 ID처럼 데이터를 가리키는 값을 바꿨을 때, 서버가 접근 권한을 확인하지 않아 다른 사람의 데이터가 노출되는 취약점입니다. A로 로그인했다는 사실만으로 B의 주문을 볼 권한이 생기지는 않습니다.</p>
        <div className={styles.grid}><div><h3>취약한 코드 · 조회만 수행</h3><pre>{`const order = orders[orderId];\nif (!order) return notFound();\nreturn json({ order }, 200);`}</pre></div><div><h3>수정된 코드 · 반환 전에 소유권 확인</h3><pre>{`const order = orders[orderId];\nif (!order) return notFound();\nif (order.ownerId !== currentUser.id) {\n  return forbidden(); // HTTP 403\n}\nreturn json({ order }, 200);`}</pre></div></div>
        <p>위 코드는 핵심 흐름을 줄여 보여줍니다. 실제 실습 API도 같은 소유권 조건으로 동작합니다. 화면에서 버튼을 숨기거나 ID를 어렵게 만드는 것만으로는 충분하지 않습니다. 서버에서 매 요청마다 소유권을 검사해야 합니다. 운영 서비스에서는 검증된 로그인 세션으로 현재 사용자를 식별해야 합니다.</p>
      </section>
      <aside className={styles.safety}><strong>이 실습의 안전한 경계</strong><p>모든 이름·상품·금액은 가상 데이터입니다. 요청 대상은 이 프로젝트의 두 고정 API뿐이며 외부 URL 입력, 프록시, 데이터 변경 기능은 없습니다. 읽기 전용 데이터이므로 다른 방문자의 실습 상태에 영향을 주지 않습니다.</p></aside>
    </main><footer className={styles.footer}>BreakProof · IDOR 한 가지를 직접 이해하는 작은 실험실</footer>
  </div>;
}
