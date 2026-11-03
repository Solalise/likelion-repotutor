import { AppHeader } from "@/components/layout/AppHeader";
import { RepositoryWorkspace } from "@/components/repository/RepositoryWorkspace";

export default async function RepositoryPage({ searchParams }: { searchParams: Promise<{ connected?: string }> }) {
  const { connected } = await searchParams;
  return <div className="app-page repository-page"><AppHeader /><RepositoryWorkspace initialConnectedRepositoryId={connected} /></div>;
}
