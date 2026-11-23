"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function removeService(form: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const id = form.get("connectionId");
  if (typeof id !== "string" || !id) throw new Error("서비스를 선택해 주세요.");
  const result = await db.userRepository.updateMany({
    where: { id, userId: session.user.id, removedAt: null },
    data: { removedAt: new Date() },
  });
  if (!result.count) throw new Error("삭제할 서비스를 찾을 수 없습니다.");
  revalidatePath("/services");
  redirect(`/services?removed=${encodeURIComponent(id)}`);
}

export async function restoreService(form: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const id = form.get("connectionId");
  if (typeof id !== "string" || !id) throw new Error("서비스를 선택해 주세요.");
  await db.userRepository.updateMany({ where: { id, userId: session.user.id }, data: { removedAt: null } });
  revalidatePath("/services");
  redirect("/services");
}
