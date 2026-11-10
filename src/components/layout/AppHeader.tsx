import Link from "next/link";
import { auth } from "@/auth";
import { SignInButton, SignOutButton } from "@/components/auth/AuthButtons";
import { Brand } from "./Brand";

export async function AppHeader({ landing = false }: { landing?: boolean } = {}) {
  const session = await auth();
  return (
    <header className="app-header">
      <Brand />
      <nav className="header-nav" aria-label="주 메뉴">
        {landing ? <>
          <a href="#learning-process">학습 방법</a>
          <Link href="/repository">데모 체험</Link>
          {session?.user ? <><Link href="/dashboard">학습 홈</Link><SignOutButton /></> : <SignInButton />}
        </> : <>
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/repository">Code map</Link>
          {session?.user ? <><Link href="/repositories">Repositories</Link><SignOutButton /></> : <SignInButton />}
        </>}
      </nav>
    </header>
  );
}
