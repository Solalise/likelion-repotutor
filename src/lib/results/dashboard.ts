import { db } from "@/lib/db";
import { requireRepositoryAccess } from "@/lib/github/repositoryAccess";
import { summarizeManualRecords, summaryProgress } from "./reviewSummary";
import type { SavedRecord } from "@/components/results/RecordPersistence";
import type { ReviewOutcome } from "@/lib/security-lab/projectReview";
import type { SecurityRecordKind } from "@/types/securityTestRecord";

export type DashboardData = {
  signedIn: boolean; failed: boolean; partial: boolean; recordCount: number;
  services: { id: string; repository: string; status: string; recorded: number | null; percent: number | null }[];
  recent: { id: string; connectionId: string; repository: string; kind: SecurityRecordKind; outcome: ReviewOutcome; updatedAt: string; commit: string; current: boolean }[];
};
export async function loadDashboard(userId?: string): Promise<DashboardData> {
  const data: DashboardData = { signedIn: Boolean(userId), failed: false, partial: false, recordCount: 0, services: [], recent: [] };
  if (!userId) return data;
  try {
    const connections = await db.userRepository.findMany({ where: { userId, active: true, removedAt: null }, select: { id: true }, orderBy: { connectedAt: "desc" } });
    const results = await Promise.all(connections.map(async ({ id }) => {
      let connection;
      try { connection = await requireRepositoryAccess(userId, id); } catch { return null; }
      const service: DashboardData["services"][number] = { id, repository: connection.repository.fullName, status: "조회 실패", recorded: null, percent: null };
      try {
        const [analysis, rows, completed] = await Promise.all([
          db.analysisRun.findFirst({ where: { requestedByUserId: userId, repositoryId: connection.repositoryId, source: "CONNECTED_REPOSITORY" }, orderBy: [{ startedAt: "desc" }, { id: "desc" }], select: { status: true } }),
          db.securityTestRecord.findMany({ where: { userId, repositoryFullName: connection.repository.fullName, source: "MANUAL", analysisRun: { requestedByUserId: userId, repositoryId: connection.repositoryId } }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }] }),
          // Use the same completed analysis scope as /results, even while a new run is pending.
          db.analysisRun.findFirst({ where: { requestedByUserId: userId, repositoryId: connection.repositoryId, source: "CONNECTED_REPOSITORY", status: "COMPLETED", commitSha: { not: null } }, orderBy: [{ completedAt: "desc" }, { id: "desc" }], select: { commitSha: true } }),
        ]);
        const summary = summarizeManualRecords(JSON.parse(JSON.stringify(rows)) as SavedRecord[], { connectionId: id, repository: connection.repository.fullName, environmentVersion: connection.deploymentVersion, site: connection.vercelUrl });
        return { service, summary, rows, status: analysis?.status ?? "NONE", commit: completed?.commitSha };
      } catch { return { service, error: true as const }; }
    }));
    for (const result of results) {
      if (!result) { data.partial = true; continue; }
      data.services.push(result.service);
      if ("error" in result) { data.partial = true; continue; }
      data.recordCount += result.rows.length;
      result.service.status = result.status;
      const current = result.summary.records.filter(record => record.row.commitSha === result.commit && record.currentEnvironment);
      const progress = summaryProgress(current);
      Object.assign(result.service, { recorded: progress.recorded, percent: progress.percent });
      data.recent.push(...result.summary.records.map(record => ({ id: record.row.id, connectionId: result.service.id, repository: result.service.repository, kind: record.row.kind, outcome: record.outcome, updatedAt: record.row.updatedAt, commit: record.row.commitSha, current: record.row.commitSha === result.commit && record.currentEnvironment })));
      if (result.summary.excluded) data.partial = true;
    }
    data.recent.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
    data.recent = data.recent.slice(0, 5);
  } catch { data.failed = true; }
  return data;
}
