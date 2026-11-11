import { auth } from "@/auth";
import { PlatformFrame } from "./PlatformFrame";
import type { ReactNode } from "react";
export { PlatformBrand } from "./PlatformFrame";

export async function PlatformShell({ children }: { children: ReactNode }) {
  const session = await auth();
  const account = session?.user ? { name: session.user.name ?? "GitHub 사용자" } : undefined;
  return <PlatformFrame account={account}>{children}</PlatformFrame>;
}
