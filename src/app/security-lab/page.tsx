import SecurityLab from "./SecurityLab";
import { AppShell } from "@/components/layout/AppShell";
export const metadata = { title: "가상 IDOR 예제 실습" };
export default function Page() { return <AppShell><SecurityLab /></AppShell>; }
