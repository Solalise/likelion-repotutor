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
          <a href="#how-it-works">실습 방법</a>
          <Link href="/learn">취약점 학습</Link>
          {session?.user ? <><Link href="/dashboard">대시보드</Link><SignOutButton /></> : <SignInButton />}
        </> : <>
          <Link href="/practice">공격 실습</Link>
          <Link href="/learn">취약점 학습</Link>
          {session?.user ? <><Link href="/dashboard">대시보드</Link><SignOutButton /></> : <SignInButton />}
        </>}
      </nav>
    </header>
  );
}
