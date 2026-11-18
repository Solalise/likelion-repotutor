import { PlatformShell } from "@/components/ui-platform/PlatformShell";
import Link from "next/link";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { SignInButton, SignOutButton } from "@/components/auth/AuthButtons";
import styles from "../services/services.module.css";
export const metadata = { title: "설정" };
export default async function Page() {
  const session = await auth();
  const userId = session?.user?.id;
  // Explicitly select existing authentication fields; deployment schema is separate.
  const profile = userId ? await db.user.findUnique({
    where: { id: userId },
    select: {
      githubLogin: true,
      accounts: { where: { provider: "github" }, select: { id: true } },
      _count: { select: { installations: true } },
    },
  }) : null;
  const account = userId ? {
    name: session.user.name ?? "GitHub 사용자",
    githubLogin: profile?.githubLogin,
    githubConnected: Boolean(profile?.accounts.length),
    installationCount: profile?._count.installations ?? 0,
  } : undefined;
  return <PlatformShell><main id="main-content" className={`vl-main ${styles.workspace}`}>
    <header className="vl-page-heading"><div><span className="vl-eyebrow">PREFERENCES</span><h1>설정</h1><p>계정과 GitHub 연결 상태를 관리합니다.</p></div></header>
    <section className="vl-card"><h2>계정 및 로그인</h2>{account ? <p className="vl-description">로그인됨 · {account.name}{account.githubLogin && <> (@{account.githubLogin})</>}</p> : <p className="vl-description">로그인하지 않았습니다.</p>}{userId ? <SignOutButton /> : <SignInButton redirectTo="/settings" />}</section>
    <section className="vl-card"><h2>GitHub 연결 상태</h2><p className="vl-description">{!account ? "GitHub 로그인 후 내 웹서비스에서 저장소를 연결하세요." : !account.githubConnected ? "GitHub 계정 연결 기록을 찾지 못했습니다. 로그아웃 후 다시 로그인해 주세요." : `GitHub 계정 연결 기록 있음 · 저장된 App 설치 ${account.installationCount}개`}</p><p className="vl-small">현재 접근 권한은 내 웹서비스에서 다시 확인합니다. Vercel 계정·프로젝트·배포 URL은 선택한 서비스에서 별도로 관리합니다.</p><div className="vl-actions"><Link className="vl-outline-button" href="/services">내 웹서비스 · GitHub 및 Vercel 연결</Link></div></section>
  </main></PlatformShell>;
}
