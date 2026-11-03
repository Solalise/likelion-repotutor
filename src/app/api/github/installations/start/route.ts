import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/auth/currentUser";

export async function GET(request: Request) {
  if (!await currentUserId()) return NextResponse.redirect(new URL("/login", request.url));
  const slug = process.env.GITHUB_APP_SLUG?.trim();
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json({ message: "GITHUB_APP_SLUG 설정이 필요합니다." }, { status: 503 });
  }
  const state = randomBytes(32).toString("base64url");
  const target = new URL(`https://github.com/apps/${slug}/installations/new`);
  target.searchParams.set("state", state);
  const response = NextResponse.redirect(target);
  response.cookies.set("repotutor_install_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/github/installations/callback",
    maxAge: 10 * 60,
  });
  return response;
}
