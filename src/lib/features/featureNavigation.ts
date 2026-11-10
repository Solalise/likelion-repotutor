import type { RepositoryFeature } from "@/types/analysis";

/** Presentation only: retain the original features and graph scopes. */
export interface FeatureNavigationGroup {
  id: string;
  title: string;
  titleInferred: boolean;
  directory?: string;
  features: RepositoryFeature[];
}

const LABELS: Record<string, string> = {
  case: "사건 처리", documents: "서류", directions: "길 안내", confirmation: "확인 화면",
  "nearby-agencies": "주변 기관", guides: "가이드", "document-scan": "문서 스캔",
  login: "로그인", signup: "회원가입", settings: "설정", profile: "프로필",
  dashboard: "대시보드", users: "사용자", orders: "주문", products: "상품", auth: "인증",
};

export function featureNavigationLabel(feature: RepositoryFeature) {
  const route = feature.routePath;
  const api = feature.entryKind === "api";
  const leaf = route?.split("/").filter(Boolean).at(-1);
  const translated = route === "/" ? "홈" : leaf && LABELS[leaf];
  // Respect explicitly supplied titles; only shorten automatically generated route titles.
  const automatic = feature.titleInferred || feature.title === `${route} 페이지`
    || feature.title === `${feature.httpMethod} ${route} API`;
  const routeTitle = feature.title === `${route} 페이지` || feature.title === `${feature.httpMethod} ${route} API`;
  const fallbackTitle = routeTitle && leaf
    ? api ? `${feature.httpMethod ?? "API"} · ${leaf} API` : `${leaf} 페이지`
    : feature.title;
  return {
    title: automatic && translated ? `${api ? `${feature.httpMethod ?? "API"} · ` : ""}${translated}${api ? " API" : ""}` : fallbackTitle,
    titleInferred: automatic && translated ? true : Boolean(feature.titleInferred),
    path: route ? `${feature.httpMethod ? `${feature.httpMethod} ` : ""}${route}` : feature.entryFilePath,
    summary: api && feature.httpMethod ? `${feature.httpMethod} 요청 진입점` : undefined,
  };
}

function structuralGroup(feature: RepositoryFeature): Omit<FeatureNavigationGroup, "features"> | undefined {
  if (!feature.routePath || !["page", "api"].includes(feature.entryKind ?? "")) return undefined;
  const parts = feature.entryFilePath.replaceAll("\\", "/").split("/");
  const appIndex = parts.indexOf("app");
  if (appIndex < 0 || !/^(?:page|route|index)\.[jt]sx?$/.test(parts.at(-1) ?? "")) return undefined;
  const folders = parts.slice(appIndex + 1, -1);
  if (folders.length === 0) return undefined;
  // API namespaces stay separate from pages. /api alone is too broad.
  let offset = 0;
  while (/^\([^/]+\)$/.test(folders[offset] ?? "")) offset++;
  if (offset >= folders.length) return undefined;
  const anchorLength = feature.entryKind === "api" && folders[offset] === "api"
    ? Math.min(offset + 2, folders.length) : offset + 1;
  const directory = parts.slice(0, appIndex + 1 + anchorLength).join("/");
  const segment = folders[anchorLength - 1];
  return { id: JSON.stringify([feature.entryKind, directory]), directory,
    // A directory is a navigation aid, never evidence of a user-facing feature.
    title: `${segment} · ${feature.entryKind === "api" ? "폴더별 API" : "폴더별 페이지"}`,
    titleInferred: false };
}

export function buildFeatureNavigation(features: RepositoryFeature[]): FeatureNavigationGroup[] {
  const groups = new Map<string, FeatureNavigationGroup>();
  const seen = new Set<string>();
  for (const feature of features) {
    if (seen.has(feature.id)) continue;
    seen.add(feature.id);
    const candidate = structuralGroup(feature);
    const id = candidate?.id ?? "ungrouped";
    const group = groups.get(id) ?? { ...(candidate ?? { id, title: "기타 · 개별 진입점", titleInferred: false }), features: [] };
    group.features.push(feature);
    groups.set(id, group);
  }
  const standalone: RepositoryFeature[] = [];
  const result: FeatureNavigationGroup[] = [];
  for (const group of groups.values()) {
    if (group.id === "ungrouped" || group.features.length < 2) standalone.push(...group.features);
    else result.push(group);
  }
  if (standalone.length) result.push({ id: "ungrouped", title: "기타 · 개별 진입점", titleInferred: false, features: standalone });
  return result;
}

export function searchFeatureNavigation(groups: FeatureNavigationGroup[], query: string): FeatureNavigationGroup[] {
  const normalized = query.trim().toLocaleLowerCase("ko");
  if (!normalized) return groups;
  const matches = (values: string[]) => values.some((value) => value.toLocaleLowerCase("ko").includes(normalized));
  return groups.flatMap((group) => {
    if (matches([group.title, group.directory ?? ""])) return [group];
    const features = group.features.filter((feature) => matches([
      featureNavigationLabel(feature).title, feature.title, feature.technicalName,
      feature.entryFilePath, feature.routePath ?? "", feature.httpMethod ?? "", ...feature.filePaths,
    ]));
    return features.length ? [{ ...group, features }] : [];
  });
}
