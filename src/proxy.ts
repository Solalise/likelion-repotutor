import { NextResponse } from "next/server";
import { auth } from "@/auth";

export default auth((request) => {
  if (request.auth) return NextResponse.next();
  const loginUrl = new URL("/login", request.nextUrl);
  loginUrl.searchParams.set("callbackUrl", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
});

export const config = {
  matcher: ["/dashboard/:path*", "/repositories/:path*"],
};
