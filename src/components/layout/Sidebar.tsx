"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Server, Crosshair, ClipboardCheck, BookOpen, Settings } from "lucide-react";
import { activeSecurityPath, securityNavigation } from "@/lib/security-lab/navigation";
import { site } from "@/lib/ui/site";

const icons = { home: Home, server: Server, target: Crosshair, results: ClipboardCheck, learn: BookOpen, settings: Settings };

export function Sidebar({ name, login, children }: { name: string; login?: string; children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <aside className="app-sidebar">
      <Link className="sidebar-brand" href="/overview"><span>{site.mark}</span>{site.name}</Link>
      <p className="sidebar-caption">직접 검증하며 배우는 웹 보안</p>
      <nav aria-label="주 메뉴">
        {securityNavigation.map(({ label, href, icon }) => { const Icon = icons[icon]; return <Link key={href} href={href} aria-current={activeSecurityPath(pathname) === href ? "page" : undefined}><Icon size={18} />{label}</Link>; })}
      </nav>
      <div className="sidebar-account">
        <span className="profile-initial" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
        <div><small>{name === "게스트" ? "로그인 없이 로컬 실습 가능" : "GitHub 로그인 계정"}</small><strong>{name}</strong>{login && <a href={`https://github.com/${encodeURIComponent(login)}`} target="_blank" rel="noreferrer">@{login} ↗</a>}</div>
        {children}
      </div>
    </aside>
  );
}
