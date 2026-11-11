"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Server, Crosshair, ClipboardCheck, BookOpen, Settings, ChevronRight } from "lucide-react";
import { site } from "@/lib/ui/site";
import { securityNavigation } from "@/lib/security-lab/navigation";
import type { ReactNode } from "react";

const icons = { home: LayoutDashboard, server: Server, target: Crosshair, results: ClipboardCheck, learn: BookOpen, settings: Settings };
export function PlatformBrand({ home = "/" }: { home?: string }) {
  return <Link className="vl-brand" href={home}><span>{site.mark}</span>{site.name}<small>SECURITY WORKSPACE</small></Link>;
}
export function PlatformFrame({ children, account }: { children: ReactNode; account?: { name: string } }) {
  const pathname = usePathname();
  const activePath = pathname === "/overview" || pathname === "/dashboard" ? "/" : pathname;
  const current = securityNavigation.find(item => item.href === activePath);
  return <div className="vl-shell"><a href="#main-content" className="vl-skip">본문으로 이동</a>
    <aside className="vl-sidebar"><PlatformBrand/><p className="vl-sidebar-caption">나의 서비스를 이해하는 실습 공간</p><span className="vl-nav-label">WORKSPACE</span>
      <nav aria-label="주 메뉴">{securityNavigation.map(item => { const Icon=icons[item.icon]; return <Link href={item.href} key={item.href} aria-current={activePath===item.href?"page":undefined}><Icon size={19}/><span>{item.label}</span>{activePath===item.href&&<ChevronRight size={14}/>}</Link>; })}</nav>
      <div className="vl-profile"><span>{account ? account.name.slice(0,1).toUpperCase() : "—"}</span><div><strong>{account?.name ?? "로그인하지 않음"}</strong><small>{account ? "로그인된 계정" : "대시보드와 학습은 자유롭게"}</small></div><Settings size={16}/></div>
    </aside>
    <div className="vl-content"><header className="vl-topbar"><div><span>{site.name}</span><ChevronRight size={13}/><strong>{current?.label??"워크스페이스"}</strong></div><div>{account ? <Link className="vl-account-link" href="/settings" aria-label="로그인된 계정 설정"><span className="vl-account-dot"/>계정 · {account.name}</Link> : <Link className="vl-login-link" href="/login">로그인</Link>}</div></header>{children}<footer className="vl-footer"><span>{site.name} · {site.tagline}</span><span>내가 통제하는 테스트 환경에서 배우는 웹 보안</span></footer></div>
  </div>;
}
