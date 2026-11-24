import type { SavedRecord } from "@/components/results/RecordPersistence";
import { parseRecord } from "./validation";
import { reviewFromRecord, reviewKinds, type ReviewOutcome, type ProjectReview } from "@/lib/security-lab/projectReview";
import { containsCredentialMaterial } from "@/lib/security-lab/manualAccess";

export const summaryLabels: Record<ReviewOutcome, string> = { UNSET: "미기록", OBSERVED: "문제 관찰", NOT_OBSERVED: "기대 동작 일치", INCONCLUSIVE: "판정 불가", NOT_APPLICABLE: "해당 없음" };
export type SummaryRecord = { row: SavedRecord; outcome: ReviewOutcome; review: ProjectReview | null; environmentVersion: number | null; site: string | null; currentEnvironment: boolean };
export function summarizeManualRecords(rows: SavedRecord[], context: { connectionId: string; repository: string; environmentVersion: number; site: string | null }) {
  const records: SummaryRecord[] = []; let excluded = 0;
  for (const row of rows) {
    if (row.repositoryFullName !== context.repository || !reviewKinds.includes(row.kind)) continue;
    try {
      const parsed = parseRecord(row);
      if (containsCredentialMaterial(parsed.draft)) { excluded++; continue; }
      let environmentVersion: number | null = null;
      let key: unknown; try { key = JSON.parse(row.recordKey); } catch { /* Legacy individual record. */ }
      if (Array.isArray(key) && key[0] === "project-review-v1") {
        if (key[1] !== context.connectionId) continue;
        if (key.length !== 4 || key[3] !== row.kind || !Number.isSafeInteger(key[2]) || key[2] < 0 || parsed.draft.targetSnapshot?.details?.environmentVersion !== String(key[2]) || parsed.draft.targetSnapshot.inputLocation !== "manual-project-review" || parsed.draft.targetSnapshot.details.workflow !== "project-review-v1") { excluded++; continue; }
        environmentVersion = key[2];
      }
      const review = reviewFromRecord(parsed.draft);
      const outcome: ReviewOutcome = review?.outcome ?? (parsed.draft.status === "NOT_RUN" ? "UNSET" : parsed.draft.status);
      const site = parsed.draft.targetSnapshot?.deploymentUrl ?? null;
      records.push({ row: { ...row, draft: parsed.draft }, review, outcome, site, environmentVersion,
        currentEnvironment: environmentVersion === context.environmentVersion && site === context.site });
    } catch { excluded++; }
  }
  records.sort((a, b) => b.row.updatedAt.localeCompare(a.row.updatedAt) || b.row.id.localeCompare(a.row.id));
  return { records, excluded };
}
export function summaryProgress(records: SummaryRecord[]) {
  const latest = Object.fromEntries(reviewKinds.map(kind => [kind, records.find(record => record.row.kind === kind)]));
  const recorded = reviewKinds.filter(kind => latest[kind] && latest[kind]!.outcome !== "UNSET").length;
  return { latest, recorded, percent: recorded * 25 };
}
