/** User confirmation only. This type grants no execution approval. */
export type ConfirmedPracticeTarget = {
  apiPath: string;
  method: string;
  inputLocation: string;
  parameter: string;
  deploymentUrl?: string;
  details?: Record<string, string>;
};
export type PracticeTargetVersion = { id: number; target: ConfirmedPracticeTarget };
export type PracticeTargetHistory = { activeId: number | null; versions: PracticeTargetVersion[] };
export const emptyTargetHistory: PracticeTargetHistory = { activeId: null, versions: [] };
export function practiceTargetIdentity(target: ConfirmedPracticeTarget): string {
  return JSON.stringify([target.deploymentUrl ?? "", target.apiPath, target.method, target.inputLocation, target.parameter,
    Object.entries(target.details ?? {}).sort(([a], [b]) => a.localeCompare(b))]);
}
export function confirmPracticeTarget(history: PracticeTargetHistory, target: ConfirmedPracticeTarget): PracticeTargetHistory {
  const active = history.versions.find(item => item.id === history.activeId);
  if (active && practiceTargetIdentity(active.target) === practiceTargetIdentity(target)) return history;
  const version = { id: (history.versions.at(-1)?.id ?? 0) + 1, target };
  return { activeId: version.id, versions: [...history.versions, version] };
}
export function practiceRecordKey(scope: string, version: number): string { return JSON.stringify([scope, "confirmed-target", version]); }
