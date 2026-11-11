"use client";
import Link from "next/link";
import { ArrowRight, Server, ShieldCheck, Crosshair, BookOpen, ClipboardCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useLabSession } from "./LabSession";
import RunnerLab, { ResultPanel } from "@/app/security-lab/project/RunnerLab";
import { verdictLabels } from "@/lib/security-lab/runnerTypes";

export function PageHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return <header className="bp-page-heading"><span className="bp-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{children}</p></header>;
}
export function ConnectionSummary() {
  const { data } = useLabSession();
  return <div className="bp-connection"><div className="bp-icon"><Server size={24} /></div><div><span className="bp-label">현재 탭의 로컬 실행기</span><h3>{data.session ? "페어링된 세션이 있어요" : "아직 연결을 확인하지 않았어요"}</h3><p>{data.session ? `${data.runnerState?.target ?? "대상 정보 확인 필요"} · 실시간 서버 상태는 실행기에서 다시 확인하세요.` : "실행기에서 테스트 서버를 등록하고 일회용 코드로 연결해주세요."}</p></div></div>;
}
export function DashboardView() {
  const { data } = useLabSession();
  return <main id="main-content" className="bp-main"><PageHeading eyebrow="YOUR SECURITY WORKSPACE" title="작게 공격하고, 확실히 이해하세요.">내가 통제하는 테스트 서비스에서 취약점을 확인하고, 원인을 이해하고, 수정 후 다시 검증합니다.</PageHeading>
    <div className="bp-hero-card"><div><span className="bp-tag">현재 지원 · IDOR</span><h2>내 서비스의 데이터,<br />다른 계정도 볼 수 있을까요?</h2><p>계정 A와 B의 정상 요청을 기준으로 교차 접근을 비교합니다.<br />GitHub 저장소 연결 없이 시작할 수 있어요.</p><Link className="bp-primary" href="/practice">새 보안 테스트 시작 <ArrowRight size={16} /></Link></div><div className="bp-hero-diagram" aria-label="IDOR 검증 순서 설명"><span>실행 흐름 · 설명용</span><div><strong>A</strong><code>내 리소스 101</code><small>정상 접근</small></div><div><strong>B</strong><code>내 리소스 102</code><small>소유권 확인</small></div><div><strong>A</strong><code>B의 리소스 102</code><small>접근권한 비교</small></div></div></div>
    <div className="bp-two-col"><section className="bp-card"><div className="bp-card-heading"><h2>내 웹서비스</h2><Link href="/services">연결 관리 →</Link></div><ConnectionSummary /><div className="bp-note">사용자가 로컬 관리 화면에서 승인한 127.0.0.1 테스트 서버에만 요청합니다.</div></section><section className="bp-card"><div className="bp-card-heading"><h2>현재 지원하는 실습</h2><Link href="/learn">원리 배우기 →</Link></div><div className="bp-method-row"><span className="bp-icon"><Crosshair size={22} /></span><div><h3>IDOR</h3><p>리소스 소유권과 객체별 접근권한</p></div><span className="bp-tag">실행 가능</span></div><p className="bp-muted">XSS · SQL Injection · 관리자 권한 검사</p><span className="bp-muted">준비 중 — 아직 실행할 수 없습니다.</span></section></div>
    <section className="bp-card"><div className="bp-card-heading"><h2>최근 검증 결과</h2><Link href="/results">현재 세션 결과 보기 →</Link></div><p className="bp-muted">이 탭에서 실제로 받은 결과만 표시합니다. 영구 저장되는 기록이 아닙니다.</p>{data.records.length ? <ul className="bp-records">{data.records.slice(0,3).map(record => <li key={record.id}><span className={`bp-verdict ${record.result.verdict}`}>{verdictLabels[record.result.verdict]}</span><div><strong>{record.target}</strong><code>GET {record.input.apiPath}</code></div><time>{new Date(record.observedAt).toLocaleTimeString("ko-KR")}</time><Link href="/results">근거 보기 →</Link></li>)}</ul> : <div className="bp-empty"><ClipboardCheck size={30} /><h3>아직 실제 검증 결과가 없어요</h3><p>승인된 테스트를 실행하면 요청·응답과 판정 근거가 이곳에 표시됩니다.</p><Link href="/practice">첫 실습 시작하기 →</Link></div>}</section>
    <div className="bp-bottom-note"><ShieldCheck size={18} /><p>한 번의 결과는 해당 계정·경로·리소스에 한정됩니다. 사이트 전체의 안전을 보장하지 않습니다.</p></div>
  </main>;
}
export function ServicesView() {
  const { data } = useLabSession();
  return <main id="main-content" className="bp-main"><PageHeading eyebrow="MY WEB SERVICES" title="내가 통제하는 환경부터 연결하세요.">별도의 서비스 목록 DB는 없습니다. 이 탭에서 로컬 실행기에 등록한 테스트 대상 하나를 사용합니다.</PageHeading><RunnerLab mode="connection" apiPath={data.apiPath} resourceA={data.resourceA} resourceB={data.resourceB}><></></RunnerLab>
    <section className="bp-card"><h2>테스트 대상과 승인 범위</h2><ConnectionSummary />{data.plan ? <><p>아래는 실행기에서 받은 최근 계획입니다. 실행 승인 여부와 만료는 실행기가 다시 확인합니다.</p><pre className="bp-code">{JSON.stringify({ target: data.plan.target, approved: data.plan.approved, used: data.plan.used, requests: data.plan.requests },null,2)}</pre></> : <div className="bp-note">아직 승인 범위를 가진 실행 계획이 없습니다. 공격 실습에서 계획을 만들고 로컬 관리 화면에서 승인해주세요.</div>}<Link className="bp-primary" href="/practice">공격 방식 선택으로 이동 <ArrowRight size={16} /></Link></section>
    <section className="bp-card"><span className="bp-eyebrow">OPTIONAL</span><h2>GitHub는 코드 확인을 돕는 보조 도구예요</h2><p>저장소 연결은 로컬 테스트에 필수가 아닙니다. 연결과 기존 코드 분석은 설정에서 관리할 수 있습니다.</p><Link href="/settings">선택적 GitHub 연결 관리 →</Link></section></main>;
}
export function ResultsView() {
  const { data, update } = useLabSession();
  const [selectedId, setSelectedId] = useState<string>();
  const selected = data.records.find(record => record.id === selectedId) ?? data.records[0];
  const previous = selected ? data.records[data.records.indexOf(selected) + 1] : undefined;
  return <main id="main-content" className="bp-main"><PageHeading eyebrow="SESSION RESULTS" title="판정 뒤의 근거를 확인하세요.">현재 탭에서 실제로 받은 최대 10개의 결과입니다. 새로고침·로그인·로그아웃·탭 종료 시 사라지며 서버에 영구 저장하지 않습니다.</PageHeading>
    {!selected ? <section className="bp-card bp-empty"><ClipboardCheck size={36} /><h2>아직 검증 결과가 없어요</h2><p>예제 화면이나 미리보기를 실제 서비스 검증 기록으로 표시하지 않습니다.</p><Link className="bp-primary" href="/practice">승인된 첫 검증 시작 <ArrowRight size={16} /></Link></section> : <>
      <section className="bp-card"><label className="bp-label" htmlFor="result-selection">현재 세션의 실제 실행 선택</label><select id="result-selection" className="bp-input" value={selected.id} onChange={event=>setSelectedId(event.target.value)}>{data.records.map(record=><option key={record.id} value={record.id}>{new Date(record.observedAt).toLocaleTimeString("ko-KR", {timeZone:"Asia/Seoul"})} · {verdictLabels[record.result.verdict]} · {record.target}</option>)}</select><p><strong>{selected.target}</strong> · GET <code>{selected.input.apiPath}</code></p><Link className="bp-primary" href="/practice" onClick={()=>update({apiPath:selected.input.apiPath,resourceA:selected.input.resourceA,resourceB:selected.input.resourceB,policy:selected.input.policy,previous:selected.result,plan:undefined})}>이 요청 조건으로 재검증 준비 <ArrowRight size={16}/></Link><p className="bp-muted">조건을 복원할 뿐 요청을 보내지 않습니다. 실행기의 계정·필드 설정을 확인하고 새 계획을 승인해야 합니다.</p></section>
      <section className="bp-card"><ResultPanel result={selected.result} previous={previous?.result} /></section>
    </>}
  </main>;
}
export function LearningView() {
  return <main id="main-content" className="bp-main"><PageHeading eyebrow="LEARN BY BREAKING" title="공격의 원리를 알면, 방어가 보입니다.">먼저 작은 가상 예제에서 원리를 익히고, 자신의 테스트 환경에서 같은 조건을 비교해보세요.</PageHeading>
    <section className="bp-card"><span className="bp-tag">01 · IDOR</span><h2>번호를 아는 것과 권한이 있는 것은 달라요.</h2><p>IDOR은 리소스 ID를 바꿨을 때 서버가 객체별 접근권한을 확인하지 않아 다른 사용자의 데이터가 노출되는 취약점입니다. 로그인했다는 사실만으로 모든 주문을 조회할 권한이 생기지는 않습니다.</p><div className="bp-two-col"><div><h3>취약한 코드</h3><pre className="bp-code">{`const order = await findOrder(id);\nreturn json(order);`}</pre></div><div><h3>수정 방향</h3><pre className="bp-code">{`const order = await findOrder(id);\nif (!order || order.ownerId !== user.id) {\n  return forbidden();\n}\nreturn json(order);`}</pre></div></div><p className="bp-muted">설명용 코드입니다. 실제 프로젝트에서는 검증된 로그인 신원과 소유권·공유 정책을 서버에서 함께 확인해야 합니다.</p><div className="bp-actions"><Link className="bp-primary" href="/security-lab">가상 IDOR 예제 직접 실습 <ArrowRight size={16}/></Link><Link className="bp-secondary" href="/practice">내 서비스에서 검증하기</Link></div></section>
    <section className="bp-card"><h2>결과를 읽는 네 가지 기준</h2><div className="bp-learning-grid">{Object.entries(verdictLabels).map(([key,label])=><article key={key}><BookOpen size={20}/><h3>{label}</h3><p>{key==="confirmed"?"다른 계정의 신원으로 같은 비공개 리소스와 보호 데이터가 반환됐습니다.":key==="blocked"?"정상 요청은 성공했고 교차 접근은 차단됐으며 설정한 보호 필드가 없습니다.":key==="suspected"?"일부 응답이 의심스럽지만 데이터 노출을 확정할 근거가 부족합니다.":"신원·인증·소유권·정책 또는 응답 근거를 확인하지 못했습니다."}</p></article>)}</div><p className="bp-note">HTTP 200만으로 취약점을 확정하거나, HTTP 403만으로 안전하다고 판단하지 않습니다.</p></section>
    <section className="bp-card"><h2>다음 학습 주제</h2><div className="bp-upcoming"><span>XSS <small>준비 중</small></span><span>SQL Injection <small>준비 중</small></span><span>관리자 권한 검사 <small>준비 중</small></span></div></section>
  </main>;
}
export function SessionSettings() {
  const { data, reset } = useLabSession();
  return <section className="bp-card"><h2>로컬 실행기와 세션</h2><ConnectionSummary/><p>실행기의 대상 등록과 토큰 입력은 터미널에 표시된 로컬 관리 URL에서만 진행합니다. 웹페이지에서는 테스트 계정 토큰을 입력받지 않습니다.</p><pre className="bp-code">node tools/security-lab-runner/server.mjs</pre><p className="bp-muted">이 탭에는 실제 결과 {data.records.length}개가 메모리에 있습니다. 아래 버튼은 브라우저 메모리만 비웁니다. 실행기의 테스트 토큰까지 폐기하려면 로컬 관리 화면에서 별도로 폐기하세요.</p><div className="bp-actions"><Link className="bp-secondary" href="/services">연결 안내 보기</Link><button className="bp-secondary" disabled={data.busy} onClick={reset}>이 탭의 연결·결과 비우기</button></div></section>;
}
