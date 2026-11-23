import { practiceMethods } from "@/lib/security-lab/practiceTarget";
import type { ConfirmedPracticeTarget } from "./securityPracticeTarget";
import type { ManualAccessComparison } from "@/lib/security-lab/manualAccess";

export type SecurityRecordKind = "SQL_INJECTION" | "XSS" | "IDOR" | "AUTHORIZATION";
export type ManualInspectionStatus = "NOT_RUN" | "INCONCLUSIVE" | "OBSERVED" | "NOT_OBSERVED";
export type RetestRecordStatus = "NOT_STARTED" | "PLANNED" | "RECORDED";
export type SecurityRecordDraft = {
  apiPath: string; method: string; status: ManualInspectionStatus;
  targetSnapshot?: ConfirmedPracticeTarget;
  inspectionMethod: string; beforeObservation: string; codeLocation: string; memo: string;
  changedFiles: string; changes: string;
  retestStatus: RetestRecordStatus; performedManually: boolean; performedAt: string;
  retestMethod: string; afterObservation: string; afterStatus: ManualInspectionStatus;
  view: "EDIT" | "COMPARE";
  accessComparison?: ManualAccessComparison;
};
export const securityRecordLabels: Record<SecurityRecordKind, string> = {
  SQL_INJECTION: "SQL Injection", XSS: "XSS", IDOR: "IDOR", AUTHORIZATION: "권한 검증",
};
export const manualStatusLabels: Record<ManualInspectionStatus, string> = {
  NOT_RUN: "미실행", INCONCLUSIVE: "판정 불가", OBSERVED: "취약 동작 확인", NOT_OBSERVED: "취약 동작 미관찰",
};
export const retestRecordLabels: Record<RetestRecordStatus, string> = { NOT_STARTED: "미진행", PLANNED: "진행 예정", RECORDED: "결과 기록 완료" };
export function emptySecurityRecord(initial: Partial<Pick<SecurityRecordDraft, "apiPath" | "method" | "codeLocation" | "targetSnapshot">> = {}): SecurityRecordDraft {
  return { apiPath: "", method: "GET", codeLocation: "", ...initial, status: "NOT_RUN", inspectionMethod: "", beforeObservation: "", memo: "",
    changedFiles: "", changes: "", retestStatus: "NOT_STARTED", performedManually: false, performedAt: "", retestMethod: "", afterObservation: "", afterStatus: "NOT_RUN", view: "EDIT" };
}
export type ManualRetestValidation = {
  valid: boolean;
  errors: Partial<Record<keyof SecurityRecordDraft, string>>;
  retestStatus: RetestRecordStatus;
};

export function validApiPath(path: string): boolean {
  if (!/^\/(?!\/)[^\s?#\\\u0000-\u001f\u007f]*$/.test(path) || path.includes("//")) return false;
  try {
    const decoded = decodeURIComponent(path);
    return !/[\s?#\\\u0000-\u001f\u007f]/.test(decoded) && !decoded.includes("//")
      && !decoded.split("/").some(segment => segment === "." || segment === "..");
  } catch { return false; }
}

/** Parse the datetime-local control's wall time in the user's runtime timezone.
 * Check every component: Date.parse alone normalizes invalid dates such as February 30.
 */
export function localDateTime(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!match) return null;
  const [, y, m, d, h, min, sec, fraction] = match;
  const [year, month, day, hour, minute, second] = [y, m, d, h, min, sec ?? "0"].map(Number);
  const millisecond = Number((fraction ?? "").padEnd(3, "0"));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) return null;
  const date = new Date(0);
  date.setFullYear(year, month - 1, day); date.setHours(hour, minute, second, millisecond);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hour
    || date.getMinutes() !== minute || date.getSeconds() !== second || date.getMilliseconds() !== millisecond) return null;
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

export function localDateTimeValue(iso: string): string {
  const date = new Date(iso); if (!Number.isFinite(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Pure completion validation with an injected clock. A manual declaration is never a server verdict. */
export function validateManualRetest(draft: SecurityRecordDraft, now: number): ManualRetestValidation {
  const errors: ManualRetestValidation["errors"] = {};
  if (!validApiPath(draft.apiPath)) errors.apiPath = "/로 시작하는 유효한 API 경로를 입력하세요 (URL·쿼리·공백 제외).";
  if (!practiceMethods.includes(draft.method as typeof practiceMethods[number])) errors.method = "지원하는 HTTP 메서드를 선택하세요.";
  const required = {
    inspectionMethod: "최초 검사 방법", beforeObservation: "수정 전 관찰 내용", changedFiles: "수정한 파일",
    changes: "수정 내용", retestMethod: "재검증 방법", afterObservation: "수정 후 관찰 내용",
  } as const;
  for (const [field, label] of Object.entries(required)) {
    if (!draft[field as keyof typeof required].trim()) errors[field as keyof typeof required] = `${label}을 입력하세요.`;
  }
  if (!draft.performedManually) errors.performedManually = "직접 재검증을 수행한 경우에만 수행 확인을 선택하세요.";
  const localPerformed = localDateTime(draft.performedAt);
  let performed = localPerformed;
  // Structured manual comparisons carry canonical UTC, unlike the legacy wall-time field.
  // Use that timestamp across browser/server timezones; the wall-time field is display only.
  const structuredTime = draft.accessComparison?.retest.performedAt;
  if (structuredTime) {
    try { const date = new Date(structuredTime); performed = date.toISOString() === structuredTime ? date.getTime() : null; } catch { performed = null; }
  }
  if (localPerformed === null || performed === null || !Number.isFinite(now)) errors.performedAt = "실제로 존재하는 재검증 수행 날짜와 시간을 입력하세요.";
  else if (performed > now) errors.performedAt = "재검증 수행 일시는 미래일 수 없습니다.";
  if (!["INCONCLUSIVE", "OBSERVED", "NOT_OBSERVED"].includes(draft.afterStatus)) errors.afterStatus = "수정 후 검사 상태를 미실행 이외의 값으로 선택하세요.";
  const valid = Object.keys(errors).length === 0;
  return { valid, errors, retestStatus: draft.retestStatus === "RECORDED" && !valid ? "PLANNED" : draft.retestStatus };
}

/** Backward-compatible predicate; callers can pass a fixed clock for deterministic checks. */
export function canRecordManualRetest(draft: SecurityRecordDraft, now = Date.now()): boolean {
  return validateManualRetest(draft, now).valid;
}

