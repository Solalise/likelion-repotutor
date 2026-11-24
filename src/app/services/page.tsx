import { restoreService } from "./actions";
import { PlatformShell } from "@/components/ui-platform/PlatformShell";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { SignInButton } from "@/components/auth/AuthButtons";
import { ServiceConnections, type ServiceConnection } from "@/components/services/ServiceConnections";
import { ServiceAnalysis } from "@/components/services/ServiceAnalysis";
import { syncAllUserInstallations } from "@/lib/github/installations";
import { requireRepositoryAccess } from "@/lib/github/repositoryAccess";
import styles from "./services.module.css";
export const metadata = { title: "내 웹서비스" };

async function refreshRepositories() {
  "use server";
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  try { await syncAllUserInstallations(session.user.id); }
  catch { redirect("/services?sync=failed"); }
  revalidatePath("/services");
  redirect("/services?sync=success");
}

export default async function Page({ searchParams }: { searchParams: Promise<{ connected?: string; sync?: string; removed?: string }> }) {
  const session = await auth();
  const { connected, sync, removed } = await searchParams;
  let services: ServiceConnection[] = [], error = "", selectedId: string | undefined;
  if (session?.user?.id) {
    try {
      await syncAllUserInstallations(session.user.id);
      const connections = await db.userRepository.findMany({
        where: { userId: session.user.id, active: true, removedAt: null },
        include: { installation: { select: { suspendedAt: true } }, repository: { select: {
          fullName: true, defaultBranch: true, analysisRuns: {
            where: { requestedByUserId: session.user.id, source: "CONNECTED_REPOSITORY" },
            orderBy: { startedAt: "desc" }, take: 1, select: { status: true },
          },
        } } }, orderBy: { repository: { fullName: "asc" } },
      });
      services = connections.map(connection => ({
        id: connection.id, fullName: connection.repository.fullName, branch: connection.repository.defaultBranch,
        suspended: Boolean(connection.installation.suspendedAt), vercelUrl: connection.vercelUrl,
        verified: connection.deploymentOwnershipStatus === "VERIFIED" && Boolean(connection.deploymentVerifiedAt),
        analysisStatus: connection.repository.analysisRuns[0]?.status ?? "NONE",
      }));
      if (connected) {
        await requireRepositoryAccess(session.user.id, connected);
        if (services.some(service => service.id === connected)) selectedId = connected;
      }
    } catch (reason) {
      services = []; selectedId = undefined;
      error = reason && typeof reason === "object" && "code" in reason && reason.code === "P2022"
        ? "DB에 필요한 연결 컬럼이 없습니다. 대상 DB와 백업을 확인한 뒤 준비된 마이그레이션을 적용해야 합니다."
        : "연결 정보를 확인하지 못했습니다. GitHub 로그인·App 권한·DB 적용 상태를 확인해 주세요.";
    }
  }
  const selected = services.find(service => service.id === selectedId);
  return <PlatformShell><main id="main-content" className={`vl-main ${styles.workspace}`}>
    <header className="vl-page-heading"><div><span className="vl-eyebrow">MY WEB SERVICES</span><h1>내 웹서비스</h1><p>GitHub 저장소 연결 → 소스코드 분석 → 테스트 환경 확인 → 프로젝트별 보안 검증 가이드 → 유형별 검토·결과 기록</p></div></header>
    {!session?.user?.id ? <section className="vl-card"><h2>GitHub 로그인으로 시작하세요.</h2><p className="vl-description">기존 GitHub 계정과 App 연결을 사용합니다. 기초 학습과 예제 실습은 별도로 이용할 수 있습니다.</p><SignInButton redirectTo="/services" /></section> : <>
      <section className="vl-card"><h2>GitHub 저장소 연결</h2><p className="vl-description">App에서 허용하고 현재 계정으로 접근할 수 있는 저장소를 선택해 분석하세요.</p><div className="vl-actions"><Link className="vl-button" href="/api/github/installations/start">GitHub App 설치 · 저장소 선택</Link><form action={refreshRepositories}><button type="submit" className="vl-outline-button">저장소 권한 동기화</button></form></div></section>
      {(error || sync === "failed") && <p role="alert">{error || "권한 동기화에 실패했습니다. 로그인과 App 권한을 확인하세요."}</p>}
      {sync === "success" && !error && <p role="status">저장소 권한을 동기화했습니다.</p>}
      {removed && <div role="status" className={`vl-card ${styles.removalNotice}`}><span>서비스를 삭제했습니다. GitHub 저장소는 유지됩니다.</span><form action={restoreService}><input type="hidden" name="connectionId" value={removed}/><button type="submit" className="vl-outline-button">삭제 취소</button></form></div>}
      {!error && <div id="service-connections"><ServiceConnections services={services} selectedId={selectedId} /></div>}
      {selected && <section aria-label="선택한 서비스 연결"><ServiceAnalysis key={selected.id} connectionId={selected.id} status={selected.analysisStatus} repository={selected.fullName} /></section>}
    </>}
  </main></PlatformShell>;
}
