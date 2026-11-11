export const securityNavigation = [
  { label: "대시보드", href: "/", icon: "home" },
  { label: "내 웹서비스", href: "/services", icon: "server" },
  { label: "취약점 학습", href: "/learn", icon: "learn" },
  { label: "공격 실습", href: "/practice", icon: "target" },
  { label: "검증 결과", href: "/results", icon: "results" },
  { label: "설정", href: "/settings", icon: "settings" },
] as const;
export function activeSecurityPath(path: string) {
  if (path === "/overview" || path === "/dashboard") return "/";
  if (path === "/security-lab/project") return "/practice";
  if (path === "/security-lab") return "/learn";
  if (path === "/repositories" || path === "/repository" || path === "/legacy/learning") return "/settings";
  return securityNavigation.find(item => path === item.href || path.startsWith(item.href + "/"))?.href;
}
