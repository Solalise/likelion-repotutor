import { PlatformShell } from "@/components/ui-platform/PlatformShell";
import { ServicesUI } from "@/components/ui-platform/PlatformViews";
export const metadata = { title: "내 웹서비스" };
export default function Page() { return <PlatformShell><ServicesUI /></PlatformShell>; }