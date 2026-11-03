import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter, AdapterAccount } from "next-auth/adapters";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { db } from "@/lib/db";
import { encryptToken } from "@/lib/auth/tokenEncryption";

const prismaAdapter = PrismaAdapter(db);
const encryptedPrismaAdapter: Adapter = {
  ...prismaAdapter,
  async linkAccount(account: AdapterAccount): Promise<void> {
    if (!prismaAdapter.linkAccount) throw new Error("Auth.js Prisma adapter에 linkAccount가 없습니다.");
    await prismaAdapter.linkAccount({
      ...account,
      access_token: encryptToken(account.access_token as string | undefined) ?? undefined,
      refresh_token: encryptToken(account.refresh_token as string | undefined) ?? undefined,
    });
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: encryptedPrismaAdapter,
  session: { strategy: "database" },
  pages: { signIn: "/login" },
  providers: [
    GitHub({
      account(tokens) {
        const refreshExpiresIn = Number(tokens.refresh_token_expires_in);
        return {
          access_token: tokens.access_token,
          expires_at: tokens.expires_at,
          refresh_token: tokens.refresh_token,
          refresh_token_expires_at: Number.isFinite(refreshExpiresIn)
            ? Math.floor(Date.now() / 1000) + refreshExpiresIn
            : undefined,
          scope: tokens.scope,
          token_type: tokens.token_type,
        };
      },
    }),
  ],
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
  events: {
    async signIn({ user, profile }) {
      const githubId = profile?.id;
      const login = "login" in (profile ?? {}) ? profile?.login : undefined;
      if (!user.id || (typeof githubId !== "number" && typeof githubId !== "string")) return;
      await db.user.update({
        where: { id: user.id },
        data: {
          githubUserId: String(githubId),
          githubLogin: typeof login === "string" ? login : undefined,
        },
      });
    },
  },
});
