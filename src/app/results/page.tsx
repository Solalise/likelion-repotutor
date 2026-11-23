import { PlatformShell } from "@/components/ui-platform/PlatformShell";
import { ResultsList } from "@/components/results/ResultsList";
export const metadata = { title: "검사 결과" };
export default function Page() { return <PlatformShell><ResultsList /></PlatformShell>; }
