"use client";
import { usePathname } from "next/navigation";
import { activeSecurityPath, securityNavigation } from "@/lib/security-lab/navigation";
import Link from "next/link";
export function LabTopbar() {
  const path = activeSecurityPath(usePathname());
  return <header className="bp-topbar"><div><span>WORKSPACE</span><strong>{securityNavigation.find(item => item.href === path)?.label ?? "보조 도구"}</strong></div><div><span className="bp-tag">로컬 테스트 환경 전용</span><Link href="/learn">실습 안내 ↗</Link></div></header>;
}
