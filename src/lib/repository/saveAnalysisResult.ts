import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export const ANALYSIS_SAVE_TIMEOUT_MS = 30_000;

export function prismaErrorCode(error: unknown): string | undefined {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" && /^P\d{4}$/.test(code) ? code : undefined;
}

/** Inputs must already be validated and JSON serialized before opening the transaction. */
export async function saveAnalysisResult(input: {
  runId: string;
  connectionId: string;
  completedAt: Date;
  data: Prisma.AnalysisRunUpdateInput;
  metrics: { analysisResultBytes: number; statsBytes: number; preparationMs: number };
}) {
  const timings: { analysisRunMs?: number; userRepositoryMs?: number } = {};
  const started = performance.now();
  let committed = false;
  let errorCode: string | undefined;
  try {
    await db.$transaction(async tx => {
      let queryStarted = performance.now();
      try {
        // Avoid RETURNING the large JSON columns: the caller already has the result.
        await tx.analysisRun.update({ where: { id: input.runId }, data: input.data, select: { id: true } });
      } finally { timings.analysisRunMs = Math.round(performance.now() - queryStarted); }
      queryStarted = performance.now();
      try {
        await tx.userRepository.update({ where: { id: input.connectionId }, data: { lastAccessedAt: input.completedAt }, select: { id: true } });
      } finally { timings.userRepositoryMs = Math.round(performance.now() - queryStarted); }
    }, { maxWait: 5_000, timeout: ANALYSIS_SAVE_TIMEOUT_MS });
    committed = true;
  } catch (error) {
    errorCode = prismaErrorCode(error);
    throw error;
  } finally {
    // Server-only numeric diagnostics; never log SQL, JSON contents, tokens or raw exceptions.
    console.info("[repository-analysis.save]", {
      runId: input.runId, ...input.metrics, ...timings,
      transactionMs: Math.round(performance.now() - started), committed, errorCode,
    });
  }
}
