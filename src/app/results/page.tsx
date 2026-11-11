import { PlatformShell } from "@/components/ui-platform/PlatformShell";
import { ResultsUI } from "@/components/ui-platform/PlatformViews";
export const metadata = { title: "검증 결과" };
export default function Page() { return <PlatformShell><ResultsUI /></PlatformShell>; }