"use client";
import { useEffect, useRef, useState } from "react";
import type { RepositoryAnalysis } from "@/types/analysis";
import type { DeploymentConnectionSnapshot } from "@/lib/security-lab/findingPreparation";
import { reviewRecordKey } from "@/lib/security-lab/projectReview";
import { extensionObservation, extensionSession, extensionRecordDraft, extensionRecordProgress } from "@/lib/security-lab/extensionReview";
import type { SavedRecord } from "@/components/results/RecordPersistence";
import { requestSavedRecord } from "@/components/results/recordClient";
import styles from "./ServiceDetail.module.css";

type Port = { postMessage: (message: unknown) => void; disconnect: () => void; onMessage: { addListener: (listener: (message: Record<string, unknown>) => void) => void }; onDisconnect: { addListener: (listener: () => void) => void } };
type Runtime = { connect: (id: string, options: { name: string }) => Port; lastError?: { message?: string } };
export function ExtensionReviewConnection({ analysis, connectionId, environment }: { analysis: RepositoryAnalysis; connectionId: string; environment?: DeploymentConnectionSnapshot }) {
  const [extensionId, setExtensionId] = useState("");
  const [message, setMessage] = useState("");
  const [connected, setConnected] = useState(false);
  const portRef = useRef<Port | null>(null);
  const ready = environment?.connectionId === connectionId && environment.repository.fullName === analysis.repository && Boolean(analysis.collection?.commitSha);
  useEffect(() => () => { portRef.current?.disconnect(); portRef.current = null; }, [analysis, environment]);
  async function freshEnvironment() {
    const response = await fetch(`/api/repositories/${encodeURIComponent(connectionId)}/deployment`, { credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000) });
    const current = await response.json() as DeploymentConnectionSnapshot;
    if (!response.ok || !environment || current.connectionId !== connectionId
      || current.repository.fullName !== analysis.repository || current.deploymentVersion !== environment.deploymentVersion
      || current.deployment.vercelUrl !== environment.deployment.vercelUrl) throw new Error("연결 상태가 변경되었습니다. 페이지를 새로고침하고 테스트 환경을 다시 확인하세요.");
    return current;
  }
  async function connect() {
    const runtime = (globalThis as typeof globalThis & { chrome?: { runtime?: Runtime } }).chrome?.runtime;
    if (!runtime || !/^[a-p]{32}$/.test(extensionId)) { setMessage("확장을 설치하고 chrome://extensions의 확장 ID를 입력하세요. VulnLab 주소 허용 설정도 확인하세요."); return; }
    try {
      if (!ready) throw new Error("GitHub 저장소 분석 정보가 필요합니다.");
      const current = await freshEnvironment();
      const session = extensionSession(analysis, current);
      setMessage("프로젝트별 가이드를 준비하고 있습니다…");
      try {
        const response = await fetch(`/api/repositories/${encodeURIComponent(connectionId)}/review-guide`, { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(65000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commitSha: session.commit }) });
        const data = await response.json();
        if (response.status === 401 || response.status === 403) { setMessage("로그인 또는 저장소 접근 권한을 다시 확인하세요."); return; }
        if (!response.ok) throw new Error(typeof data.message === "string" ? data.message : "AI 가이드 요청 실패");
        if (data.commitSha !== session.commit || data.repository !== session.project || !Array.isArray(data.guides) || data.guides.length !== 4) throw new Error("AI 가이드의 분석 연결을 확인하지 못했습니다.");
        session.guideBundle = data;
      } catch (error) { session.guideBundle.reason = error instanceof Error && error.name === "TimeoutError" ? "AI 가이드 응답 시간 초과" : error instanceof Error ? error.message : "AI 가이드 연결 실패"; }
      // The panel uses grounded sources in guideBundle; do not duplicate the old large code payload.
      session.guides = session.guides.map(guide => ({ ...guide, snippets: [], points: [], limitations: [] }));
      try {
        const rows: SavedRecord[] = [], seen = new Set<string>(); let cursor: string | undefined;
        for (let page = 0; page < 10; page++) {
          const query = new URLSearchParams({ repository: analysis.repository, ...(cursor ? { cursor } : {}) });
          const response = await fetch(`/api/results?${query}`, { credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000) });
          const data = await response.json();
          if (!response.ok || !Array.isArray(data.records)) throw new Error("기존 기록 조회 실패");
          rows.push(...data.records);
          if (!data.nextCursor) break;
          if (typeof data.nextCursor !== "string" || seen.has(data.nextCursor)) throw new Error("기록 페이지 정보 오류");
          seen.add(data.nextCursor); cursor = data.nextCursor;
          if (page === 9) session.recordProgress.limited = true;
        }
        Object.assign(session.recordProgress, extensionRecordProgress(rows, analysis, current), { loaded: true });
      } catch { session.recordProgress.error = "기존 기록을 조회하지 못했습니다. DB 기록은 유지되며 저장된 결과 목록에서 확인할 수 있습니다."; }
      portRef.current?.disconnect();
      const port = runtime.connect(extensionId, { name: "vulnlab-review-v1" }); portRef.current = port;
      let busy = false;
      port.onDisconnect.addListener(() => { void runtime.lastError; if (portRef.current === port) { portRef.current = null; setConnected(false); setMessage("확장 연결이 종료되었습니다. 설치·허용 주소를 확인하고 다시 연결하세요. 저장하지 않은 패널 기록은 사라집니다."); } });
      port.onMessage.addListener(async data => {
        if (portRef.current !== port) return;
        if (data.type === "READY") { setConnected(true); setMessage("연결 완료 · Chrome 도구 모음에서 VulnLab 아이콘을 눌러 사이드 패널을 여세요. 이 탭은 열어 두세요."); return; }
        if (data.sessionId !== session.id || !["SAVE", "OPEN_SITE"].includes(String(data.type))) return;
        if (busy) { port.postMessage({ type: "ERROR", sessionId: session.id, message: "이전 요청 처리 중입니다. 완료 후 다시 시도하세요." }); return; }
        busy = true;
        try {
          const fresh = await freshEnvironment();
          if (portRef.current !== port) return;
          if (data.type === "OPEN_SITE") {
            if (!fresh.deployment.vercelUrl) throw new Error("일반 탐색으로 열 사이트 주소를 먼저 등록하세요.");
            port.postMessage({ type: "OPEN_CONFIRMED", sessionId: session.id }); return;
          }
          const { kind, review } = extensionObservation(data);
          const identity = { repositoryFullName: analysis.repository, commitSha: session.commit, recordKey: reviewRecordKey(connectionId, fresh.deploymentVersion, kind), kind };
          // Append a new manual record; preserve prior revisions and existing web records.
          const row = await requestSavedRecord("/api/results", { method: "POST", signal: AbortSignal.timeout(20000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...identity, draft: extensionRecordDraft(review, fresh) }) }, identity);
          if (portRef.current === port) port.postMessage({ type: "SAVED", sessionId: session.id, kind, id: row.id });
        } catch (error) { if (portRef.current === port) port.postMessage({ type: "ERROR", sessionId: session.id, message: error instanceof Error ? error.message : "저장을 확인하지 못했습니다." }); }
        finally { busy = false; }
      });
      port.postMessage({ type: "SESSION", session }); setMessage("확장 연결을 확인하고 있습니다…");
    } catch (error) { setMessage(error instanceof Error ? error.message : "확장 연결 실패"); }
  }
  return <section aria-label="확장 프로그램 연결">
    <div className={styles.step}><span className={styles.stepNumber}>2</span><div><div className={styles.stepHeading}><h4>Chrome 확장 프로그램 설치 및 연결</h4><span>{connected ? "연결됨" : "연결 필요"}</span></div><p className={styles.note}>설치된 VulnLab 확장 프로그램 ID를 입력하세요.</p>
    <details><summary>확장 프로그램 설치 안내</summary><ol><li>Chrome에서 chrome://extensions를 열고 개발자 모드를 켜세요.</li><li>압축해제된 확장 프로그램 로드에서 extensions/vulnlab 폴더를 선택하세요.</li><li>확장 ID를 아래에 입력하세요. 기본 허용 주소는 localhost:3000과 127.0.0.1:3000입니다. 다른 VulnLab 주소는 폴더의 README 안내를 따르세요.</li><li>연결 후 도구 모음의 VulnLab 아이콘을 눌러 패널을 여세요.</li></ol></details>
    <label>Chrome 확장 ID<input value={extensionId} maxLength={32} onChange={event => setExtensionId(event.target.value.trim())} placeholder="chrome://extensions에서 확인" /></label>
    </div></div><div className={styles.step}><span className={styles.stepNumber}>3</span><div><div className={styles.stepHeading}><h4>맞춤형 검토 가이드 시작</h4><span>{connected ? "사이드 패널 이용 가능" : "대기"}</span></div><p className={styles.note}>연결 후 Chrome 도구 모음의 VulnLab 아이콘을 눌러 네 가지 유형을 검토하세요. 후보가 없어도 이용할 수 있습니다.</p></div></div>
    <div className={styles.actions}><button className={styles.primary} type="button" disabled={!ready} onClick={() => void connect()}>검증 가이드 준비 및 확장 연결</button>
    <button className={styles.secondary} type="button" disabled={!connected || !ready || !environment?.deployment.vercelUrl} onClick={() => portRef.current?.postMessage({ type: "REQUEST_OPEN" })}>등록 사이트 열기 (일반 탐색)</button></div>
    <p className={styles.note}>확장 연결과 일반 탐색은 실행 승인이 아닙니다. 능동적인 검증은 승인된 격리 환경과 합성 데이터로만 진행하세요.</p>
    {!ready && <p>저장소 분석 정보를 불러와야 합니다. 소유권 확인이나 정적 후보 수는 가이드 이용 조건이 아닙니다.</p>}
    <p role="status">{message}</p>
  </section>;
}
