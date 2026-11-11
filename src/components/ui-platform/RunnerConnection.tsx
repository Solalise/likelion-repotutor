"use client";

import { useEffect, useRef, useState } from "react";
import { Plug } from "lucide-react";
import { useLabSession } from "@/components/security/LabSession";
import { requestRunnerConnection, RunnerConnectionError, runnerTargetMatches } from "@/lib/security-lab/runnerConnection";
import { useRegistry } from "./ServiceRegistry";

export function RunnerConnection() {
  const { registry, ready } = useRegistry();
  const { data, update, disconnect } = useLabSession();
  const { session, runnerState: state, runnerPort } = data;
  const selected = registry.services.find(service => service.id === registry.selectedId);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [checkedAt, setCheckedAt] = useState<number>();
  const [failed, setFailed] = useState(false);
  const [origin, setOrigin] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setOrigin(window.location.origin), 0);
    return () => { window.clearTimeout(timer); pending.current?.abort(); };
  }, []);

  async function connect(kind: "pair" | "state") {
    if (pending.current || (kind === "state" && !session)) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true); setMessage("");
    try {
      const result = await requestRunnerConnection(kind === "pair"
        ? { kind, port: runnerPort, code }
        : { kind, session: session! }, controller.signal);
      if (controller.signal.aborted) return;
      update({ runnerState: result.state, ...(result.session ? { session: result.session } : {}) });
      setCheckedAt(Date.now()); setFailed(false); setCode("");
      setMessage(kind === "pair" ? "페어링이 완료되었습니다. 선택 서비스와 승인 대상의 일치 여부를 확인하세요." : "실행기 상태를 확인했습니다.");
    } catch (error) {
      if (controller.signal.aborted) return;
      update({ runnerState: undefined });
      setFailed(true); setCheckedAt(undefined); setCode("");
      if (error instanceof RunnerConnectionError) {
        if (error.invalidSession) disconnect();
        setMessage(error.message);
      } else {
        setMessage("로컬 실행기에 연결하지 못했습니다. 실행기 실행 여부, 정확한 Origin, 브라우저 로컬 네트워크 권한을 확인해주세요. 보안 설정을 낮추지 마세요.");
      }
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const verified = Boolean(session && state && !failed);
  const matches = Boolean(verified && selected && runnerTargetMatches(selected.port, state));
  return <>
    <div className="vl-status-line"><span className="vl-dot"/><strong>{busy ? "연결 확인 중…" : failed ? "연결 확인 실패" : verified ? "페어링 완료" : "연결 전 · 페어링 필요"}</strong><span className="vl-status">{verified ? "메모리 세션" : "미연결"}</span></div>
    <p className="vl-description">등록된 서비스 선택은 테스트 대상 지정용입니다. 대상 설정과 테스트 계정은 기존 Runner의 로컬 관리 화면에서만 변경합니다.</p>
    <div className="vl-info-row"><span>선택한 서비스</span><strong>{ready ? selected ? `${selected.name} · 127.0.0.1:${selected.port}` : "서비스를 등록하고 선택해주세요" : "불러오는 중…"}</strong></div>
    <div className="vl-info-row"><span>Runner 승인 대상</span><strong>{verified ? state?.target : "확인되지 않음"}</strong></div>
    <div className="vl-info-row"><span>포트 일치 여부</span><strong>{!selected ? "서비스 선택 필요" : !verified ? "페어링 및 상태 확인 필요" : matches ? "일치 · 등록한 서비스와 같은 대상" : "불일치 · 로컬 관리 화면에서 대상 재설정 필요"}</strong></div>
    {selected && selected.port < 1024 && <p className="vl-service-error">기존 Runner는 1024~65535 포트만 지원합니다. 지원 포트로 서비스를 등록해주세요.</p>}
    <details className="vl-runner-guide"><summary>기존 Runner 연결 방법</summary><ol>
      <li><code>node tools/security-lab-runner/server.mjs</code>로 실행합니다.</li>
      <li>터미널에 표시된 비밀값 포함 로컬 관리 URL을 이 PC에서 엽니다.</li>
      <li>테스트 대상 포트를 <strong>{selected?.port ?? "선택한 서비스 포트"}</strong>, 허용 Origin을 <code>{origin || "현재 페이지의 정확한 Origin"}</code>으로 설정합니다. 테스트 전용 확인과 기존 계정·응답 필드 설정을 완료합니다. A/B 테스트 토큰은 로컬 관리 화면에서만 입력합니다.</li>
      <li>관리 화면에서 생성한 일회용 코드로 아래에서 페어링합니다. 코드는 2분·1회, 세션은 10분 유효합니다.</li>
    </ol><p>대상 재설정은 기존 세션과 승인을 폐기합니다. 웹페이지에서 연결 해제 후 새 코드로 다시 페어링해주세요.</p></details>
    <form onSubmit={event => { event.preventDefault(); void connect("pair"); }}>
      <label className="vl-field"><span>Runner 통신 포트 (테스트 서버 포트 아님)</span><input inputMode="numeric" value={runnerPort} onChange={event => update({ runnerPort: event.target.value })} disabled={busy || Boolean(session)} required/></label>
      <label className="vl-field"><span>일회용 페어링 코드</span><input type="password" autoComplete="off" value={code} onChange={event => setCode(event.target.value)} disabled={busy || Boolean(session)} required/></label>
      <div className="vl-runner-actions"><button className="vl-button" type="submit" disabled={busy || Boolean(session) || !code || !selected || selected.port < 1024}><Plug size={16}/>실행기 페어링</button>
        {session && <><button className="vl-outline-button" type="button" disabled={busy} onClick={() => void connect("state")}>실행기 상태 확인</button><button className="vl-outline-button" type="button" disabled={busy} onClick={() => { disconnect(); setFailed(false); setCheckedAt(undefined); setCode(""); setMessage("이 화면의 메모리 세션을 삭제했습니다. Runner의 설정·토큰·세션 폐기는 로컬 관리 화면에서 진행해주세요."); }}>연결 해제</button></>}
      </div>
    </form>
    <p className="vl-small">{verified && checkedAt ? `마지막 확인: ${new Date(checkedAt).toLocaleTimeString("ko-KR")} · ${state?.running ? "Runner 작업 중" : "Runner 대기 중"}. 현재 상태는 상태 확인 버튼으로 갱신하세요.` : "연결 정보는 메모리에만 유지됩니다. 새로고침·화면 이탈·세션 만료 후에는 다시 페어링해야 합니다."}</p>
    <div className="vl-inline-note"><p>대상 포트 일치와 페어링은 공격 실행 승인이 아닙니다. 실행 계획별 로컬 승인은 별도 절차이며, 이 화면에는 공격 실행을 연결하지 않습니다.</p></div>
    <p className="vl-small" role="status">{message}</p>
  </>;
}
