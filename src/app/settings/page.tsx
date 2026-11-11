import { PlatformShell } from "@/components/ui-platform/PlatformShell";
import { SettingsUI } from "@/components/ui-platform/PlatformViews";
export const metadata = { title: "설정" };
export default function Page() { return <PlatformShell><SettingsUI /></PlatformShell>; }