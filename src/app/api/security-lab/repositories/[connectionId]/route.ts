import { requireUserId } from "@/lib/auth/currentUser";
import { requireRepositoryAccess, repositoryAccessResponse, repositoryJson } from "@/lib/github/repositoryAccess";
import { validConnectionId } from "@/lib/security-lab/projectPlan";

export const dynamic = "force-dynamic";

/** Authorization and metadata only: never downloads source or executes target requests. */
export async function GET(request: Request, context: { params: Promise<{ connectionId: string }> }) {
  let userId: string;
  try { userId = await requireUserId(); }
  catch { return repositoryJson({ message: "GitHub 로그인 후 연결 저장소를 선택해주세요." }, { status: 401 }); }
  const { connectionId } = await context.params;
  if (!validConnectionId(connectionId) || new URL(request.url).search) {
    return repositoryJson({ message: "올바른 저장소 연결 ID만 사용할 수 있습니다." }, { status: 400 });
  }
  try {
    const connection = await requireRepositoryAccess(userId, connectionId);
    return repositoryJson({ id: connection.id, repository: {
      fullName: connection.repository.fullName,
      defaultBranch: connection.repository.defaultBranch,
    } });
  } catch (error) { return repositoryAccessResponse(error); }
}
