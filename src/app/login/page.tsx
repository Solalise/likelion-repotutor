import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SignInButton } from "@/components/auth/AuthButtons";
import { PlatformFrame } from "@/components/ui-platform/PlatformFrame";
import Link from "next/link";
import { site } from "@/lib/ui/site";
import styles from "./login.module.css";

export default async function LoginPage() {
  if (await auth()) redirect("/dashboard");
  return (
    <PlatformFrame>
      <main id="main-content" className={`vl-main ${styles.content}`}>
        <section className={`vl-card ${styles.card}`} aria-labelledby="login-heading">
          <header className="vl-page-heading"><div>
            <span className="vl-eyebrow">GITHUB ACCOUNT</span>
            <h1 id="login-heading">{site.name}에 로그인</h1>
            <p>GitHub 계정으로 로그인하고 내 저장소의 코드를 살펴보세요.</p>
          </div></header>
          <p className="vl-description">로그인은 사용자 확인만 수행합니다. 저장소 접근은 로그인 후 별도의 GitHub App 설치 과정에서 선택합니다.</p>
          <SignInButton />
          <p className="vl-small">기초 학습과 로컬 실습은 GitHub 로그인 없이 시작할 수 있습니다.</p>
          <div className="vl-actions"><Link className="vl-text-link" href="/learn">취약점 학습 둘러보기 →</Link><Link className="vl-text-link" href="/practice">로그인 없이 실습 시작 →</Link></div>
        </section>
      </main>
    </PlatformFrame>
  );
}
