import { PlatformShell } from "@/components/ui-platform/PlatformShell";
import { DashboardUI } from "@/components/ui-platform/PlatformViews";
import { currentUserId } from "@/lib/auth/currentUser";
import { loadDashboard } from "@/lib/results/dashboard";
export const metadata = { title: "대시보드" };
export const dynamic = "force-dynamic";
export default async function Page() { const data = await loadDashboard(await currentUserId()); return <PlatformShell><DashboardUI data={data} /></PlatformShell>; }
