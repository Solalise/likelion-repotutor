import Link from "next/link";
import { auth } from "@/auth";
import { SignInButton, SignOutButton } from "@/components/auth/AuthButtons";
import { Brand } from "./Brand";

export async function AppHeader() {
  const session = await auth();
  return (
    <header className="app-header">
      <Brand />
      <nav className="header-nav" aria-label="주 메뉴">
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/repository">Code map</Link>
        {session?.user ? <><Link href="/repositories">Repositories</Link><SignOutButton /></> : <SignInButton />}
      </nav>
    </header>
  );
}
