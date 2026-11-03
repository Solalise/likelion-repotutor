import { Github, LogOut } from "lucide-react";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";

export function SignInButton({ redirectTo = "/repositories" }: { redirectTo?: string }) {
  return (
    <form action={async () => {
      "use server";
      const authorizationUrl = new URL(await signIn("github", { redirect: false, redirectTo }));
      authorizationUrl.searchParams.delete("scope");
      redirect(authorizationUrl.toString());
    }}>
      <button className="github-button" type="submit"><Github size={16} /> GitHub로 로그인</button>
    </form>
  );
}

export function SignOutButton() {
  return (
    <form action={async () => {
      "use server";
      await signOut({ redirectTo: "/" });
    }}>
      <button className="github-button" type="submit"><LogOut size={16} /> 로그아웃</button>
    </form>
  );
}
