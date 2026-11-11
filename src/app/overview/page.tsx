import { PlatformShell } from "@/components/ui-platform/PlatformShell";
import { DashboardUI } from "@/components/ui-platform/PlatformViews";
export const metadata = { title: "대시보드" };
export default function Page() { return <PlatformShell><DashboardUI /></PlatformShell>; }
