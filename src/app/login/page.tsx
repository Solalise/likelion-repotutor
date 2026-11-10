import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SignInButton } from "@/components/auth/AuthButtons";
import { AppHeader } from "@/components/layout/AppHeader";

export default async function LoginPage() {
  if (await auth()) redirect("/dashboard");
  return (
    <div className="app-page">
      <AppHeader />
      <main className="auth-page">
        <section className="auth-card">
          <span className="eyebrow">REPOTUTOR ACCOUNT</span>
          <h1>GitHub 계정으로 시작하기</h1>
          <p>로그인은 사용자 확인만 수행합니다. 저장소 접근은 로그인 후 별도의 GitHub App 설치 과정에서 선택합니다.</p>
          <SignInButton />
          <small>공개 저장소 URL 분석은 로그인 없이 계속 사용할 수 있습니다.</small>
        </section>
      </main>
    </div>
  );
}
