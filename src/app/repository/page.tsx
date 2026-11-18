import { redirect } from "next/navigation";
export default async function Page({ searchParams }: { searchParams: Promise<{ connected?: string }> }) {
  const { connected } = await searchParams;
  redirect(typeof connected === "string" && connected ? `/services?connected=${encodeURIComponent(connected)}` : "/services");
}
