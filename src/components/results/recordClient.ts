import type { SavedRecord } from "./RecordPersistence";

type Identity = Pick<SavedRecord, "repositoryFullName" | "commitSha" | "recordKey" | "kind">;

export async function requestSavedRecord(url: string, init: RequestInit, expected: Identity, fetcher: typeof fetch = fetch): Promise<SavedRecord> {
  const response = await fetcher(url, { ...init, credentials: "same-origin", cache: "no-store", redirect: "error" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.message === "string" ? data.message : "DB 요청에 실패했습니다. 저장 완료를 확인하지 못했습니다.");
  if (!data || typeof data.id !== "string" || !data.id || !Number.isSafeInteger(data.revision) || data.revision < 1
    || !data.draft || typeof data.draft !== "object" || Object.entries(expected).some(([key, value]) => data[key] !== value)) {
    throw new Error("일치하는 저장 기록을 확인하지 못했습니다. 성공으로 처리하지 않습니다. 결과 목록에서 다시 확인하세요.");
  }
  return data as SavedRecord;
}
