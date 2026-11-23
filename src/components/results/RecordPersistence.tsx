"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { SecurityRecordDraft, SecurityRecordKind } from "@/types/securityTestRecord";
import { requestSavedRecord } from "./recordClient";
export type SavedRecord = { id: string; repositoryFullName: string; commitSha: string; recordKey: string; kind: SecurityRecordKind; draft: SecurityRecordDraft; revision: number; updatedAt: string };
export function RecordPersistence({ context, recordKey, kind, draft, saved, onLoad }: { context: { repositoryFullName: string; commitSha: string }; recordKey: string; kind: SecurityRecordKind; draft: SecurityRecordDraft; saved?: SavedRecord; onLoad: (draft: SecurityRecordDraft) => void }) {
  const [record, setRecord] = useState(saved); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  const identity = { repositoryFullName: context.repositoryFullName, commitSha: context.commitSha, recordKey, kind };
  async function perform(load = false) {
    if (active.current || load && !record) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setMessage("");
    try {
      const data = await requestSavedRecord(record ? `/api/results/${record.id}` : "/api/results", {
        method: load ? "GET" : record ? "PATCH" : "POST", signal: controller.signal,
        ...(!load ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...identity, draft, revision: record?.revision }) } : {}),
      }, identity);
      if (active.current !== controller || controller.signal.aborted) return;
      setRecord(data); if (load) onLoad(data.draft); setMessage(load ? "저장 기록 조회 완료" : "DB 저장 완료");
    } catch (e) {
      if (active.current === controller && !controller.signal.aborted) setMessage(e instanceof Error ? e.message : "저장 완료를 확인하지 못했습니다.");
    } finally { if (active.current === controller) { active.current = null; setBusy(false); } }
  }
  return <aside><p>수동 기록 · 서버 미검증. 저장 후 대상과 분석 SHA를 변경할 수 없습니다.</p>
    <p>DB 테이블 준비 전에는 저장할 수 없습니다. 저장 실패 시 초안은 현재 화면에만 남습니다. DB 저장 완료가 표시되기 전에는 영구 저장되지 않았습니다.</p>
    <button type="button" disabled={busy} onClick={() => void perform()}>DB {record ? "수정 저장" : "저장"}</button>
    {record && <><button type="button" disabled={busy} onClick={() => void perform(true)}>저장 기록 다시 조회</button><Link href={`/results/${record.id}`}>저장 결과 상세</Link></>}
    <Link href="/results">저장된 검사 결과 목록</Link><p role="status">{message}</p></aside>;
}
