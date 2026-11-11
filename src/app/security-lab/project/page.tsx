import { Suspense } from "react";
import ProjectLab from "./ProjectLab";
import { AppShell } from "@/components/layout/AppShell";

export const metadata = { title: "IDOR 공격 실습" };
export default function Page() {
  return <AppShell><Suspense fallback={<p role="status">실습 준비 화면을 불러오는 중입니다…</p>}><ProjectLab embedded /></Suspense></AppShell>;
}
