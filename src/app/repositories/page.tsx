import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Github, LockKeyhole, RefreshCw } from "lucide-react";
import { auth } from "@/auth";
import { AppHeader } from "@/components/layout/AppHeader";
import { db } from "@/lib/db";
import { syncAllUserInstallations } from "@/lib/github/installations";

async function refreshRepositories() {
  "use server";
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  await syncAllUserInstallations(session.user.id);
  revalidatePath("/repositories");
}

export default async function RepositoriesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const connections = await db.userRepository.findMany({
    where: { userId: session.user.id, active: true },
    include: { repository: true, installation: true },
    orderBy: { repository: { fullName: "asc" } },
  });
  return (
    <div className="app-page">
      <AppHeader />
      <main className="repositories-main">
        <div className="dashboard-heading">
          <div><span className="eyebrow">GITHUB APP</span><h1>연결된 저장소</h1><p>GitHub App 설치에서 접근을 허용한 저장소만 표시합니다.</p></div>
          <div className="repository-actions">
            <form action={refreshRepositories}><button className="sample-button" type="submit"><RefreshCw size={15} /> 목록 동기화</button></form>
            <Link className="primary-action" href="/api/github/installations/start"><Github size={16} /> GitHub App 설치</Link>
          </div>
        </div>
        {connections.length === 0 ? (
          <section className="repository-empty"><LockKeyhole size={28} /><h2>연결된 저장소가 없습니다</h2><p>GitHub App을 설치하고 분석할 저장소만 선택해 주세요.</p></section>
        ) : (
          <section className="connected-repository-grid">
            {connections.map((connection) => <article key={connection.id}>
              <div><span>{connection.repository.visibility}</span><small>{connection.installation.accountLogin}</small></div>
              <h2>{connection.repository.fullName}</h2>
              <p>기본 브랜치 {connection.repository.defaultBranch} · 권한 {connection.permission}</p>
              <Link href={`/repository?connected=${encodeURIComponent(connection.id)}`}>이 저장소 분석</Link>
            </article>)}
          </section>
        )}
      </main>
    </div>
  );
}
