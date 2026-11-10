import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/layout/AppShell";
import { RepositoryList } from "@/components/repositories/RepositoryList";
import { GitHubConnectionStatus } from "@/components/repositories/GitHubConnectionStatus";
import { db } from "@/lib/db";
import { syncAllUserInstallations } from "@/lib/github/installations";

async function refreshRepositories() {
  "use server";
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  try { await syncAllUserInstallations(session.user.id); }
  catch { redirect("/repositories?sync=failed"); }
  revalidatePath("/repositories");
  redirect("/repositories?sync=success");
}

export default async function RepositoriesPage({ searchParams }: { searchParams: Promise<{ sync?: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { sync } = await searchParams;
  // Reconcile authorization before reading stored repository/analysis metadata.
  await syncAllUserInstallations(session.user.id);
  const [connections, installations] = await Promise.all([
    db.userRepository.findMany({
      where: { userId: session.user.id, active: true },
      include: {
        repository: { include: { analysisRuns: {
          where: { requestedByUserId: session.user.id, source: "CONNECTED_REPOSITORY" },
          orderBy: { startedAt: "desc" }, take: 1,
        } } }, installation: true,
      },
      orderBy: { repository: { fullName: "asc" } },
    }),
    db.gitHubInstallation.findMany({
      where: { userId: session.user.id },
      select: { id: true, accountLogin: true, suspendedAt: true, lastSyncedAt: true },
    }),
  ]);
  const rows = connections.map(({ id, repository, installation }) => {
    const run = repository.analysisRuns[0];
    return {
      id, name: repository.name, owner: repository.owner, visibility: repository.visibility,
      branch: repository.defaultBranch, suspended: Boolean(installation.suspendedAt),
      status: run?.status ?? "NONE", analyzedAt: run?.completedAt?.toISOString() ?? null,
      startedAt: run?.startedAt.toISOString() ?? null,
    };
  });
  return (
    <AppShell>
      <main id="main-content" className="tutor-main">
        <header className="page-heading heading-actions">
          <div><span className="eyebrow">MY REPOSITORIES</span><h1>내 저장소</h1><p>연결한 코드를 살펴보고, 학습할 저장소를 선택하세요.</p></div>
          <Link className="primary-action" href="/api/github/installations/start">＋ 저장소 연결</Link>
        </header>
        <GitHubConnectionStatus installations={installations} repositoryCount={connections.length} refreshAction={refreshRepositories} />
        {sync === "failed" && <p className="notice-error" role="alert">동기화에 실패했습니다. GitHub 로그인과 App 권한을 확인한 뒤 다시 동기화해 주세요.</p>}
        {sync === "success" && <p role="status">저장소 목록과 권한을 동기화했습니다.</p>}
        <RepositoryList repositories={rows} />
      </main>
    </AppShell>
  );
}
