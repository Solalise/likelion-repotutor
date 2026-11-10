import { AppShell } from "@/components/layout/AppShell";
import { RepositoryWorkspace } from "@/components/repository/RepositoryWorkspace";
export default async function RepositoryPage({ searchParams }: { searchParams: Promise<{ connected?: string; selection?: string; selectionType?: string }> }) {
  const { connected, selection, selectionType } = await searchParams;
  return <AppShell workspace><div id="main-content"><RepositoryWorkspace initialConnectedRepositoryId={connected} initialSelectionId={selection} initialSelectionType={selectionType} /></div></AppShell>;
}
