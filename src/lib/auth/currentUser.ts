import { auth } from "@/auth";

export async function currentUserId(): Promise<string | undefined> {
  const session = await auth();
  return session?.user?.id;
}

export async function requireUserId(): Promise<string> {
  const userId = await currentUserId();
  if (!userId) throw new Error("AUTH_REQUIRED");
  return userId;
}
