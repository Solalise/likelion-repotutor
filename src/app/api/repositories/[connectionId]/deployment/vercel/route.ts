import { requireUserId } from "@/lib/auth/currentUser";
import { tokenEncryptionReady } from "@/lib/auth/tokenEncryption";
import { requireRepositoryAccess, repositoryAccessResponse, repositoryJson, RepositoryAccessError } from "@/lib/github/repositoryAccess";
import { checkedCursor, checkedTeam, connectVercelToken, disconnectVercel, selectVercelProject, vercelConnectionStatus, VercelConnectionError, vercelProjects, vercelTeams } from "@/lib/vercel/connection";
import { object, VercelMetadataError } from "@/lib/vercel/deploymentCommit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ connectionId: string }> };

async function body(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new VercelConnectionError("JSON 요청만 허용됩니다.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new VercelConnectionError("요청 내용이 없습니다.");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 8192) { await reader.cancel(); throw new VercelConnectionError("요청 크기 제한을 초과했습니다.", 413); }
      parts.push(part.value);
    }
    const value = object(JSON.parse(Buffer.concat(parts).toString("utf8")));
    if (!value) throw new VercelConnectionError("올바른 요청 내용을 입력해 주세요.");
    return value;
  } finally { reader.releaseLock(); }
}

async function handle(request: Request, context: Context) {
  let userId: string;
  try { userId = await requireUserId(); }
  catch { return repositoryJson({ message: "GitHub 로그인이 필요합니다." }, { status: 401 }); }
  if (request.method !== "GET" && request.headers.get("origin") !== new URL(request.url).origin) {
    return repositoryJson({ message: "동일한 사이트에서만 연결 정보를 변경할 수 있습니다." }, { status: 403 });
  }
  // Removing this user's credentials needs neither GitHub repository access nor decryption.
  // No account/user ID is taken from the path or request body.
  if (request.method === "DELETE") {
    try { return repositoryJson(await disconnectVercel(userId)); }
    catch { return repositoryJson({ message: "본인의 Vercel 연결 해제에 실패했습니다. 다시 시도해 주세요." }, { status: 503 }); }
  }
  // Configuration state contains no repository/account data; do not accept a PAT without a key.
  if (!tokenEncryptionReady()) return repositoryJson({ encryptionReady: false, message: "TOKEN_ENCRYPTION_KEY에 base64 32바이트 키 설정이 필요합니다. 토큰을 입력하거나 저장하지 마세요." }, { status: request.method === "GET" ? 200 : 503 });
  try {
    const { connectionId } = await context.params;
    const connection = await requireRepositoryAccess(userId, connectionId);
    if (request.method === "GET") {
      const params = new URL(request.url).searchParams;
      if (params.get("view") === "teams") return repositoryJson(await vercelTeams(userId, checkedCursor(params.get("cursor"))));
      if (params.get("view") === "projects") return repositoryJson(await vercelProjects(userId, connection, checkedTeam(params.get("teamId") ?? "personal"), checkedCursor(params.get("cursor"))));
      return repositoryJson(await vercelConnectionStatus(userId, connection));
    }
    const value = await body(request);
    if (request.method === "POST") {
      if (Object.keys(value).length !== 1 || !("token" in value)) throw new VercelConnectionError("토큰만 입력해 주세요.");
      return repositoryJson(await connectVercelToken(userId, value.token));
    }
    if (Object.keys(value).length !== 2 || !("projectId" in value) || !("teamId" in value)) throw new VercelConnectionError("팀과 프로젝트만 선택해 주세요.");
    return repositoryJson(await selectVercelProject(userId, connection, value.projectId, checkedTeam(value.teamId)));
  } catch (error) {
    if (error instanceof RepositoryAccessError) return repositoryAccessResponse(error);
    if (error instanceof VercelConnectionError) return repositoryJson({ message: error.message }, { status: error.status });
    if (error instanceof VercelMetadataError) return repositoryJson({ message: error.message }, { status: error.httpStatus === 401 || error.httpStatus === 403 ? error.httpStatus : error.kind === "UNAVAILABLE" ? 403 : 502 });
    // Never return an original error/body that might contain a submitted token.
    return repositoryJson({ message: "Vercel 연결 요청을 처리하지 못했습니다. 인증·권한·DB 적용 상태를 확인해 주세요." }, { status: 503 });
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
