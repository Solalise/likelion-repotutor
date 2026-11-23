import { currentUserId } from "@/lib/auth/currentUser";
import { db } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import { PlatformShell } from "@/components/ui-platform/PlatformShell";
import { ResultDetail } from "@/components/results/ResultDetail";
import type { SavedRecord } from "@/components/results/RecordPersistence";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
 const userId = await currentUserId(); if (!userId) redirect("/login");
 const record = await db.securityTestRecord.findFirst({ where: { id: (await params).id, userId } }); if (!record) notFound();
 return <PlatformShell><ResultDetail record={JSON.parse(JSON.stringify(record)) as SavedRecord} /></PlatformShell>;
}
