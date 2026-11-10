"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, FolderGit2, Network, MessageSquare, ListChecks, Presentation, History } from "lucide-react";

const items = [
  { label: "홈", href: "/dashboard", icon: Home },
  { label: "내 저장소", href: "/repositories", icon: FolderGit2 },
  { label: "코드 탐색", href: "/repository", icon: Network },
  { label: "코드 피드백", icon: MessageSquare },
  { label: "문제 풀이", icon: ListChecks },
  { label: "Teach-back", icon: Presentation },
  { label: "학습 기록", icon: History },
];

export function Sidebar({ name, login, children }: { name: string; login?: string; children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <aside className="app-sidebar">
      <Link className="sidebar-brand" href="/dashboard"><span>R</span>RepoTutor</Link>
      <p className="sidebar-caption">코드를 이해하는 나의 공간</p>
      <nav aria-label="주 메뉴">
        {items.map(({ label, href, icon: Icon }) => href ? (
          <Link key={label} href={href} aria-current={pathname === href ? "page" : undefined}><Icon size={18} />{label}</Link>
        ) : (
          <div className="sidebar-disabled" key={label} aria-disabled="true"><Icon size={18} />{label}<small>준비 중</small></div>
        ))}
      </nav>
      <div className="sidebar-account">
        <span className="profile-initial" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
        <div><small>GitHub 계정</small><strong>{name}</strong>{login && <a href={`https://github.com/${encodeURIComponent(login)}`} target="_blank" rel="noreferrer">@{login} ↗</a>}</div>
        {children}
      </div>
    </aside>
  );
}
