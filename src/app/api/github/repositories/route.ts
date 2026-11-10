import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/currentUser";
import { db } from "@/lib/db";
import { syncAllUserInstallations } from "@/lib/github/installations";
import { repositoryAccessResponse, repositoryJson } from "@/lib/github/repositoryAccess";

async function authenticatedUserId(): Promise<string | NextResponse> {
  try { return await requireUserId(); }
  catch { return repositoryJson({ message: "로그인이 필요합니다." }, { status: 401 }); }
}

export async function GET() {
  const userId = await authenticatedUserId();
  if (userId instanceof NextResponse) return userId;
  try { await syncAllUserInstallations(userId); }
  catch (error) { return repositoryAccessResponse(error); }
  const connections = await db.userRepository.findMany({
    where: { userId, active: true },
    include: { repository: true, installation: { select: { accountLogin: true, accountType: true } } },
    orderBy: { repository: { fullName: "asc" } },
  });
  return repositoryJson(connections.map((connection) => ({
    id: connection.id,
    permission: connection.permission,
    repository: {
      fullName: connection.repository.fullName,
      htmlUrl: connection.repository.htmlUrl,
      defaultBranch: connection.repository.defaultBranch,
      visibility: connection.repository.visibility,
      archived: connection.repository.isArchived,
    },
    installation: connection.installation,
  })));
}

export async function POST() {
  const userId = await authenticatedUserId();
  if (userId instanceof NextResponse) return userId;
  try {
    const synchronized = await syncAllUserInstallations(userId);
    return repositoryJson({ synchronized });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "저장소 목록을 동기화하지 못했습니다.";
    return repositoryJson({ message }, { status: 502 });
  }
}
