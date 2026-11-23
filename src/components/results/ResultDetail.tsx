"use client";
import type { SavedRecord } from "./RecordPersistence";
import { RecordPersistence } from "./RecordPersistence";
import { SecurityTestRecord } from "@/components/repository/SecurityTestRecord";
import { useState } from "react";
export function ResultDetail({ record }: { record: SavedRecord }) {
 const [draft, setDraft] = useState(record.draft);
 return <section><h1>검사 결과 상세 · 수동 기록</h1><p>{record.repositoryFullName} · 분석 SHA: {record.commitSha}</p><p>확정 대상 버전: {record.recordKey}</p><SecurityTestRecord source="MANUAL" recordKey={record.recordKey} kind={record.kind} initialDraft={draft} onDraftChange={setDraft} confirmedTarget={draft.targetSnapshot} recordContext={{ repositoryFullName: record.repositoryFullName, commitSha: record.commitSha }} /><RecordPersistence context={record} recordKey={record.recordKey} kind={record.kind} draft={draft} saved={record} onLoad={setDraft} /></section>;
}
