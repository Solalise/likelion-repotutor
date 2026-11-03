import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/auth/currentUser";
import { findAccessibleInstallation, saveAndSyncInstallation } from "@/lib/github/installations";

function validState(expected: string | undefined, actual: string | null): boolean {
  if (!expected || !actual) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.redirect(new URL("/login", request.url));
  const url = new URL(request.url);
  const installationId = url.searchParams.get("installation_id");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("repotutor_install_state")?.value;
  if (!installationId || !/^\d+$/.test(installationId) || !validState(expectedState, state)) {
    return NextResponse.json({ message: "GitHub App 설치 요청을 검증하지 못했습니다." }, { status: 400 });
  }
  try {
    const { installation, token } = await findAccessibleInstallation(userId, installationId);
    await saveAndSyncInstallation(userId, installation, token);
    const response = NextResponse.redirect(new URL("/repositories?installed=1", request.url));
    response.cookies.delete("repotutor_install_state");
    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "GitHub App 설치 정보를 저장하지 못했습니다.";
    return NextResponse.json({ message }, { status: 403 });
  }
}
