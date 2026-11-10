import { auth } from "@/auth";
import { SignInButton, SignOutButton } from "@/components/auth/AuthButtons";
import { Sidebar } from "./Sidebar";
import { db } from "@/lib/db";

export async function AppShell({ children, workspace = false }: { children: React.ReactNode; workspace?: boolean }) {
  const session = await auth();
  const profile = session?.user?.id ? await db.user.findUnique({
    where: { id: session.user.id }, select: { githubLogin: true },
  }) : null;
  return (
    <div className={`tutor-shell${workspace ? " tutor-workspace" : ""}`}>
      <Sidebar name={session?.user?.name ?? "게스트"} login={profile?.githubLogin ?? undefined}>
        {session?.user ? <SignOutButton /> : <SignInButton />}
      </Sidebar>
      <div className="tutor-content"><a className="skip-content" href="#main-content">본문으로 이동</a>{children}</div>
    </div>
  );
}
