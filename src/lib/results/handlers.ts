import { currentUserId } from "@/lib/auth/currentUser";
import { db } from "@/lib/db";
import { parseRecord } from "./validation";
import { Prisma } from "@prisma/client";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
export async function handleResults(request: Request, id?: string): Promise<Response> {
  try {
    const userId = await currentUserId();
    if (!userId) return json({ message: "로그인이 필요합니다." }, 401);
    if (request.method === "GET") {
      if (id) { const record = await db.securityTestRecord.findFirst({ where: { id, userId } }); return record ? json(record) : json({ message: "기록을 찾을 수 없습니다." }, 404); }
      const q = new URL(request.url).searchParams;
      const records = await db.securityTestRecord.findMany({ where: { userId, ...(q.get("repository") ? { repositoryFullName: q.get("repository")! } : {}), ...(q.get("kind") ? { kind: q.get("kind")! } : {}), ...(q.get("status") ? { status: q.get("status")! } : {}) }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 100, ...(q.get("cursor") ? { cursor: { id: q.get("cursor")! }, skip: 1 } : {}) });
      return json({ records, nextCursor: records.length === 100 ? records.at(-1)!.id : null });
    }
    if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("content-type")?.split(";")[0] !== "application/json") return json({ message: "동일 사이트 JSON 요청만 허용합니다." }, 403);
    const text = await request.text(); if (text.length > 80000) return json({ message: "입력이 너무 큽니다." }, 413);
    let body; let parsed;
    try { body = JSON.parse(text); parsed = parseRecord(body); } catch { return json({ message: "검사 기록 입력값과 확정 대상을 확인하세요." }, 400); }
    if (id) {
      const existing = await db.securityTestRecord.findFirst({ where: { id, userId } });
      if (!existing) return json({ message: "기록을 찾을 수 없습니다." }, 404);
      if (existing.repositoryFullName !== parsed.repositoryFullName || existing.commitSha !== parsed.commitSha || existing.recordKey !== parsed.recordKey || existing.kind !== parsed.kind || existing.targetIdentity !== parsed.targetIdentity) return json({ message: "저장된 대상과 버전은 변경할 수 없습니다. 새 기록을 만드세요." }, 409);
      if (!Number.isInteger(body.revision)) return json({ message: "기록 버전이 필요합니다." }, 400);
      const updated = await db.securityTestRecord.updateMany({ where: { id, userId, revision: body.revision }, data: { draft: parsed.draft, status: parsed.draft.status, revision: { increment: 1 } } });
      return updated.count ? json(await db.securityTestRecord.findFirst({ where: { id, userId } })) : json({ message: "다른 화면에서 변경되었습니다. 다시 조회하세요." }, 409);
    }
    const analysis = await db.analysisRun.findFirst({ where: { requestedByUserId: userId, repositoryFullName: parsed.repositoryFullName, commitSha: parsed.commitSha, status: "COMPLETED" }, orderBy: { completedAt: "desc" } });
    if (!analysis) return json({ message: "본인이 완료한 저장소 분석과 SHA가 필요합니다." }, 403);
    return json(await db.securityTestRecord.create({ data: { userId, analysisRunId: analysis.id, ...parsed, status: parsed.draft.status, source: "MANUAL" } }), 201);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2021", "P2022"].includes(error.code)) {
      return json({ code: "RESULTS_SCHEMA_UNAVAILABLE", message: "검사 결과 DB 테이블·컬럼이 준비되지 않았습니다. 마이그레이션 적용은 보류 중이며 이번 요청은 저장되지 않았습니다. 초안을 유지하고 DB 준비 후 다시 저장하세요." }, 503);
    }
    return json({ code: "RESULTS_UNAVAILABLE", message: "DB 연결 또는 기록 처리에 실패했습니다. 저장 완료를 확인하지 못했습니다. 초안을 유지하고 연결·인증서 상태를 확인한 뒤 다시 조회하세요." }, 503);
  }
}
