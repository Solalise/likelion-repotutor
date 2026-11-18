import { requireUserId } from "@/lib/auth/currentUser";
import { requireRepositoryAccess, repositoryAccessResponse, repositoryJson } from "@/lib/github/repositoryAccess";
import { DeploymentVerificationError, issueDeploymentChallenge, verifyDeploymentChallenge } from "@/lib/repository/deploymentVerification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ connectionId: string }> };

export async function POST(request: Request, context: Context) {
  let userId: string;
  try { userId = await requireUserId(); }
  catch { return repositoryJson({ message: "로그인이 필요합니다." }, { status: 401 }); }
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return repositoryJson({ message: "동일한 사이트에서만 요청할 수 있습니다." }, { status: 403 });
  }
  const action = new URL(request.url).searchParams.get("action");
  if (action !== "issue" && action !== "verify") {
    return repositoryJson({ message: "지원하지 않는 검증 작업입니다." }, { status: 400 });
  }
  // Target URL, file path, token and verification status never come from this request.
  try {
    const { connectionId } = await context.params;
    const connection = await requireRepositoryAccess(userId, connectionId);
    if (action === "issue") return repositoryJson(await issueDeploymentChallenge(userId, connection));
    return repositoryJson({ deployment: await verifyDeploymentChallenge(userId, connection), message: "배포 사이트 소유권을 확인했습니다. 실제 테스트 요청은 계속 비활성화되어 있습니다." });
  } catch (error) {
    if (error instanceof DeploymentVerificationError) return repositoryJson({ message: error.message }, { status: error.status });
    return repositoryAccessResponse(error);
  }
}
