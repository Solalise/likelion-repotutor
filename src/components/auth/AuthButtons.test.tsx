import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({signIn:vi.fn(),signOut:vi.fn(),redirect:vi.fn()}));
vi.mock("@/auth",()=>({signIn:mocks.signIn,signOut:mocks.signOut}));
vi.mock("next/navigation",()=>({redirect:mocks.redirect}));
import { SignInButton,SignOutButton } from "./AuthButtons";
function formAction(element:ReactElement){return (element.props as {action:()=>Promise<void>}).action;}
beforeEach(()=>vi.resetAllMocks());
describe("preserved GitHub account actions",()=>{
  it("uses the original GitHub sign-in and redirect flow",async()=>{
    mocks.signIn.mockResolvedValue("https://github.com/login/oauth/authorize?client_id=test&scope=repo");
    await formAction(SignInButton({}))();
    expect(mocks.signIn).toHaveBeenCalledWith("github",{redirect:false,redirectTo:"/dashboard"});
    expect(mocks.redirect).toHaveBeenCalledWith("https://github.com/login/oauth/authorize?client_id=test");
  });
  it("uses the original sign-out form action and redirect",async()=>{
    const element=SignOutButton();expect(element.type).toBe("form");
    await formAction(element)();expect(mocks.signOut).toHaveBeenCalledWith({redirectTo:"/"});
  });
});
