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
          <header className={styles.heading}>
            <h1 id="login-heading">{site.name}에 로그인</h1>
            <p>GitHub 계정으로 간편하게 시작하세요.</p>
          </header>
          <SignInButton />
          <p className={styles.note}>저장소 접근 권한은 로그인 후 선택할 수 있어요.</p>
          <div className={styles.guest}>
            <span>로그인 없이도 이용할 수 있어요</span>
            <div><Link href="/learn">기초 학습</Link><span aria-hidden="true">·</span><Link href="/practice">공격 실습</Link></div>
          </div>
        </section>
      </main>
    </PlatformFrame>
  );
}
