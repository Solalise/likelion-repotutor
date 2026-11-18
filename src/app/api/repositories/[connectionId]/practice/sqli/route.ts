import { requireUserId } from "@/lib/auth/currentUser";
import { repositoryJson, RepositoryAccessError } from "@/lib/github/repositoryAccess";
import { parseSqliDraft, SqliExecutionError } from "@/lib/security-lab/sqliPolicy";
import { sqliExecutionStatus, executeSqliPair } from "@/lib/security-lab/sqliExecution";
import { VercelMetadataError } from "@/lib/vercel/deploymentCommit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function body(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json" || !request.body) throw new SqliExecutionError("JSON 요청이 필요합니다.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0, expired = false;
  const timer = setTimeout(() => { expired = true; void reader.cancel(); }, 5000);
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 8192) { await reader.cancel(); throw new SqliExecutionError("요청 본문은 8KB 이하여야 합니다.", 413); }
      chunks.push(part.value);
    }
    if (expired) throw new SqliExecutionError("요청 본문 수신 시간이 초과되었습니다.", 408);
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch (error) { if (error instanceof SqliExecutionError) throw error; throw new SqliExecutionError("JSON 요청 형식이 올바르지 않습니다.", 400); }
  finally { clearTimeout(timer); reader.releaseLock(); }
}

export async function POST(request: Request, context: { params: Promise<{ connectionId: string }> }) {
  let userId: string;
  try { userId = await requireUserId(); }
  catch { return repositoryJson({ allowed: false, reason: "GitHub 로그인이 필요합니다." }, { status: 401 }); }
  if (request.headers.get("origin") !== new URL(request.url).origin) return repositoryJson({ allowed: false, reason: "동일 사이트의 요청만 허용합니다." }, { status: 403 });
  try {
    const payload = await body(request);
    if (Object.keys(payload).some(key => !["action", "draft", "confirmed"].includes(key)) || !["status", "execute"].includes(String(payload.action))) throw new SqliExecutionError("상태 확인 또는 명시적 실행 요청만 지원합니다.", 400);
    const draft = parseSqliDraft(payload.draft), { connectionId } = await context.params;
    if (draft.connectionId !== connectionId) throw new SqliExecutionError("요청 저장소 연결이 일치하지 않습니다.");
    if (payload.action === "status") return repositoryJson(await sqliExecutionStatus(userId, draft));
    if (payload.confirmed !== true) throw new SqliExecutionError("대상과 두 요청 내용을 먼저 확인해야 합니다.", 400);
    return repositoryJson({ result: await executeSqliPair(userId, draft) });
  } catch (error) {
    const known = error instanceof SqliExecutionError || error instanceof RepositoryAccessError || error instanceof VercelMetadataError;
    return repositoryJson({ allowed: false, reason: known ? error.message : "서버 검증·DB 요청 예산 확인에 실패해 실행을 차단했습니다. 이미 예약된 요청 예산은 자동 복구하지 않습니다." },
      { status: error instanceof SqliExecutionError || error instanceof RepositoryAccessError ? error.status : 503 });
  }
}
