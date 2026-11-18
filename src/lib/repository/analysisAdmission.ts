import "server-only";
import { db } from "@/lib/db";

const WINDOW_MS = 10 * 60_000;
const MAX_REQUESTS = 10;
export class AnalysisAdmissionError extends Error {
  constructor(message: string, public readonly status: 429 | 503, public readonly retryAfterSeconds?: number) { super(message); }
}

/** Durable admission, not a cache: serialize each user's count + reservation on the existing User row. */
export async function reserveAnalysisRun(input: {
  userId: string; repositoryFullName: string; repositoryId?: string; source: "PUBLIC_URL" | "CONNECTED_REPOSITORY";
}) {
  try {
    return await db.$transaction(async tx => {
      const users = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "users" WHERE "id" = ${input.userId} FOR UPDATE`;
      if (users.length !== 1) throw new AnalysisAdmissionError("분석 사용자 정보를 확인할 수 없습니다.", 503);
      // Use the database clock after acquiring the lock, including across application instances.
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`;
      if (!(clock?.now instanceof Date) || !Number.isFinite(clock.now.getTime())) throw new AnalysisAdmissionError("분석 요청 시간을 확인할 수 없습니다.", 503);
      const count = await tx.analysisRun.count({ where: { requestedByUserId: input.userId,
        startedAt: { gte: new Date(clock.now.getTime() - WINDOW_MS) } } });
      if (count >= MAX_REQUESTS) throw new AnalysisAdmissionError("분석은 사용자별 10분에 10회까지 요청할 수 있습니다. 잠시 후 다시 시도해 주세요.", 429, 600);
      // Failed requests and cache hits count too; repository changes cannot reset the budget.
      return tx.analysisRun.create({ data: {
        requestedByUserId: input.userId, repositoryId: input.repositoryId,
        repositoryFullName: input.repositoryFullName, source: input.source,
        status: "RUNNING", startedAt: clock.now,
      } });
    }, { maxWait: 5000, timeout: 10000 });
  } catch (error) {
    if (error instanceof AnalysisAdmissionError) throw error;
    throw new AnalysisAdmissionError("DB 기반 분석 요청 제한을 확인할 수 없어 분석을 시작하지 않았습니다.", 503);
  }
}
