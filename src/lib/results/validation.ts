import { emptySecurityRecord, securityRecordLabels, manualStatusLabels, validateManualRetest, type SecurityRecordDraft, type SecurityRecordKind } from "@/types/securityTestRecord";
import { practiceMethods } from "@/lib/security-lab/practiceTarget";
import { practiceTargetIdentity } from "@/types/securityPracticeTarget";
import { accessPlanFromTarget, parseAccessComparison, containsCredentialMaterial, accessRoundComplete } from "@/lib/security-lab/manualAccess";
export function parseRecord(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("INVALID_INPUT");
  const v = value as Record<string, unknown>;
  if (typeof v.repositoryFullName !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(v.repositoryFullName) || typeof v.commitSha !== "string" || !/^[a-f0-9]{40}$/i.test(v.commitSha)
    || typeof v.recordKey !== "string" || !v.recordKey || v.recordKey.length > 2000 || typeof v.kind !== "string" || !Object.hasOwn(securityRecordLabels, v.kind)) throw new Error("INVALID_INPUT");
  const raw = v.draft as Record<string, unknown>;
  if (!raw || typeof raw !== "object") throw new Error("INVALID_INPUT");
  const draft = emptySecurityRecord();
  for (const key of Object.keys(draft) as (keyof SecurityRecordDraft)[]) {
    if (key === "performedManually") { if (typeof raw[key] !== "boolean") throw new Error("INVALID_INPUT"); }
    else if (typeof raw[key] !== "string" || (raw[key] as string).length > (key === "apiPath" ? 512 : key === "codeLocation" ? 1000 : 4000)) throw new Error("INVALID_INPUT");
    Object.assign(draft, { [key]: raw[key] });
  }
  if (!Object.hasOwn(manualStatusLabels, draft.status) || !Object.hasOwn(manualStatusLabels, draft.afterStatus) || !["NOT_STARTED", "PLANNED", "RECORDED"].includes(draft.retestStatus) || !["EDIT", "COMPARE"].includes(draft.view) || !practiceMethods.includes(draft.method as typeof practiceMethods[number]) || !/^\/(?!\/)[^\s?#\\\u0000-\u001f]*$/.test(draft.apiPath)) throw new Error("INVALID_INPUT");
  const t = raw.targetSnapshot as Record<string, unknown>;
  if (!t || typeof t !== "object" || t.apiPath !== draft.apiPath || t.method !== draft.method) throw new Error("INVALID_TARGET");
  for (const key of ["apiPath", "method", "inputLocation", "parameter"]) if (typeof t[key] !== "string" || (t[key] as string).length > 2000) throw new Error("INVALID_TARGET");
  if (t.deploymentUrl !== undefined && (typeof t.deploymentUrl !== "string" || t.deploymentUrl.length > 2000 || !/^https?:$/.test(new URL(t.deploymentUrl).protocol))) throw new Error("INVALID_TARGET");
  if (t.details !== undefined && (!t.details || typeof t.details !== "object" || Array.isArray(t.details) || Object.keys(t.details).length > 30 || Object.entries(t.details).some(([k, x]) => k.length > 200 || typeof x !== "string" || x.length > 4000))) throw new Error("INVALID_TARGET");
  draft.targetSnapshot = { apiPath: draft.apiPath, method: draft.method, inputLocation: t.inputLocation as string, parameter: t.parameter as string, ...(t.deploymentUrl ? { deploymentUrl: t.deploymentUrl as string } : {}), ...(t.details ? { details: t.details as Record<string, string> } : {}) };
  const accessKind = v.kind === "IDOR" || v.kind === "AUTHORIZATION";
  if (accessKind && containsCredentialMaterial({ ...draft, accessComparison: raw.accessComparison })) throw new Error("CREDENTIAL_INPUT_FORBIDDEN");
  const plan = accessPlanFromTarget(draft.targetSnapshot, v.kind);
  if (raw.accessComparison !== undefined) {
    if (!accessKind || !plan) throw new Error("INVALID_ACCESS_PLAN");
    draft.accessComparison = parseAccessComparison(raw.accessComparison, draft.targetSnapshot, plan, v.commitSha);
  }
  if (plan && draft.retestStatus === "RECORDED" && (!accessRoundComplete(draft.accessComparison?.initial, Date.now()) || !accessRoundComplete(draft.accessComparison?.retest, Date.now()))) throw new Error("INCOMPLETE_ACCESS_COMPARISON");
  if (draft.retestStatus === "RECORDED" && !validateManualRetest(draft, Date.now()).valid) throw new Error("INVALID_RETEST");
  return { repositoryFullName: v.repositoryFullName, commitSha: v.commitSha, recordKey: v.recordKey, kind: v.kind as SecurityRecordKind, draft, targetIdentity: practiceTargetIdentity(draft.targetSnapshot) };
}
