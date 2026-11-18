import { Suspense } from "react";
import ProjectLab from "./ProjectLab";
import { AppShell } from "@/components/layout/AppShell";
import { localPracticeAvailable } from "@/lib/security-lab/basicSiteConnection";
import { localPracticeUnavailableMessage } from "@/components/ui-platform/LocalPracticeLink";

export const metadata = { title: "IDOR 공격 실습" };
export default function Page() {
  if (!localPracticeAvailable()) return <AppShell><main id="main-content"><h1>로컬 실행기 · 개발 전용</h1><p>{localPracticeUnavailableMessage}</p></main></AppShell>;
  return <AppShell><Suspense fallback={<p role="status">실습 준비 화면을 불러오는 중입니다…</p>}><ProjectLab embedded /></Suspense></AppShell>;
}
