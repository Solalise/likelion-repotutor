import { requireUserId } from "@/lib/auth/currentUser";
import { db } from "@/lib/db";
import { requireRepositoryAccess, repositoryAccessResponse, repositoryJson } from "@/lib/github/repositoryAccess";
import { normalizeVercelUrl, repositoryDeployment } from "@/lib/repository/deployment";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ connectionId: string }> };

export async function GET(_request: Request, context: Context) {
  let userId: string;
  try { userId = await requireUserId(); }
  catch { return repositoryJson({ message: "로그인이 필요합니다." }, { status: 401 }); }
  try {
    const { connectionId } = await context.params;
    const connection = await requireRepositoryAccess(userId, connectionId);
    return repositoryJson({
      connectionId: connection.id,
      deploymentVersion: connection.deploymentVersion,
      repository: { fullName: connection.repository.fullName, htmlUrl: connection.repository.htmlUrl },
      deployment: repositoryDeployment(connection),
    });
  } catch (error) { return repositoryAccessResponse(error); }
}

export async function PATCH(request: Request, context: Context) {
  let userId: string;
  try { userId = await requireUserId(); }
  catch { return repositoryJson({ message: "로그인이 필요합니다." }, { status: 401 }); }
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return repositoryJson({ message: "동일한 사이트에서만 변경할 수 있습니다." }, { status: 403 });
  }
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return repositoryJson({ message: "JSON 형식으로 요청해 주세요." }, { status: 415 });
  }
  let vercelUrl: string;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).length !== 1 || !("vercelUrl" in body)) {
      throw new Error("배포 URL만 전달해 주세요.");
    }
    vercelUrl = normalizeVercelUrl(body.vercelUrl);
  } catch (error) {
    return repositoryJson({ message: error instanceof Error ? error.message : "올바른 URL을 입력해 주세요." }, { status: 400 });
  }
  try {
    const { connectionId } = await context.params;
    const connection = await requireRepositoryAccess(userId, connectionId);
    // The client cannot submit verification status. Every registration/change resets it.
    const updated = await db.userRepository.updateMany({
      where: { id: connection.id, userId, active: true },
      data: {
        vercelUrl, deploymentOwnershipStatus: "UNVERIFIED", deploymentVerifiedAt: null,
        deploymentVersion: { increment: 1 }, deploymentTokenHash: null, deploymentTokenExpiresAt: null,
        deploymentVerificationAttempts: 0, deploymentNextVerificationAt: null,
        // Keep the issuance timestamp: changing URL must not bypass the issuance cooldown.
      },
    });
    if (updated.count !== 1) return repositoryJson({ message: "활성 저장소 연결을 찾을 수 없습니다." }, { status: 404 });
    return repositoryJson({
      connectionId: connection.id,
      repository: { fullName: connection.repository.fullName, htmlUrl: connection.repository.htmlUrl },
      deployment: repositoryDeployment({ vercelUrl, deploymentOwnershipStatus: "UNVERIFIED", deploymentVerifiedAt: null }),
    });
  } catch (error) { return repositoryAccessResponse(error); }
}
