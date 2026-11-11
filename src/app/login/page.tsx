import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SignInButton } from "@/components/auth/AuthButtons";
import { AppHeader } from "@/components/layout/AppHeader";
import Link from "next/link";
import { site } from "@/lib/ui/site";

export default async function LoginPage() {
  if (await auth()) redirect("/dashboard");
  return (
    <div className="app-page">
      <AppHeader />
      <main className="auth-page">
        <section className="auth-card">
          <span className="eyebrow">ACCOUNT</span>
          <h1>{site.name}에 로그인</h1>
          <p>로그인은 사용자 확인만 수행합니다. 저장소 접근은 로그인 후 별도의 GitHub App 설치 과정에서 선택합니다.</p>
          <SignInButton />
          <small>로컬 웹서비스 보안 실습은 GitHub 로그인 없이 시작할 수 있습니다.</small><p><Link href="/services">로그인 없이 로컬 실습 시작 →</Link></p>
        </section>
      </main>
    </div>
  );
}
