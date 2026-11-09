import { traceDisplayGraph } from "@/lib/graph/dfs";
import type { CodeEdge, CodeNode, RepositoryAnalysis, RepositoryEntryPoint, RepositoryFeature, RepositoryFeatureDiscovery, TraversalResult } from "@/types/analysis";

const MAX_FEATURE_DEPTH = 5;
const ROUTE_LABELS: Record<string, string> = {
  login: "로그인", signup: "회원가입", settings: "설정", profile: "프로필", dashboard: "대시보드",
  users: "사용자", orders: "주문", products: "상품",
};
const METHOD_LABELS: Record<string, string> = { GET: "조회", POST: "생성", PUT: "수정", PATCH: "수정", DELETE: "삭제" };

export interface FeatureGroupMapping {
  entryNodeId: string;
  title?: string;
  description?: string;
  includeNodeIds?: string[];
}
export interface FeatureDiscoveryOptions { mappings?: FeatureGroupMapping[] }

function symbolEdges(analysis: RepositoryAnalysis): CodeEdge[] {
  const ids = new Set(analysis.nodes.filter((node) => node.type !== "file").map((node) => node.id));
  return analysis.edges.filter((edge) => edge.relation !== "import" && ids.has(edge.source) && ids.has(edge.target));
}

function routeTitle(entry: RepositoryEntryPoint): { title: string; inferred: boolean } {
  if (entry.kind === "page") {
    const label = entry.routePath === "/" ? "홈" : ROUTE_LABELS[entry.routePath.slice(1)];
    return { title: `${label ?? entry.routePath} 페이지`, inferred: Boolean(label) };
  }
  const noun = ROUTE_LABELS[entry.routePath.split("/").filter((part) => part && !part.startsWith("[")).at(-1) ?? ""];
  const action = METHOD_LABELS[entry.method ?? ""];
  return noun && action
    ? { title: `${entry.method} ${entry.routePath} · ${noun} ${action} API`, inferred: true }
    : { title: `${entry.method} ${entry.routePath} API`, inferred: false };
}

/** Only follow outgoing confirmed relationships. References remain references, not executions. */
function collectScope(entry: CodeNode, edges: CodeEdge[], nodes: Map<string, CodeNode>, entryIds: Set<string>) {
  const outgoing = new Map<string, CodeEdge[]>();
  for (const edge of edges) outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  const visited = new Set([entry.id]);
  const expandable = new Set<string>();
  const queue = [{ id: entry.id, depth: 0 }];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    if (current.depth >= MAX_FEATURE_DEPTH) continue;
    expandable.add(current.id);
    for (const edge of outgoing.get(current.id) ?? []) {
      if (edge.confidence !== "confirmed" || !nodes.has(edge.target)) continue;
      // A confirmed API request may show its endpoint, but the endpoint's implementation
      // is explored through its own feature. Other route entries do not join this feature.
      const boundary = edge.target !== entry.id && entryIds.has(edge.target);
      if (boundary && edge.relation !== "api") continue;
      if (visited.has(edge.target)) continue;
      visited.add(edge.target);
      if (!boundary) queue.push({ id: edge.target, depth: current.depth + 1 });
    }
  }
  return { ids: visited, expandable };
}

function makeFeature(
  analysis: RepositoryAnalysis, entry: CodeNode, edges: CodeEdge[], entryIds: Set<string>,
  metadata?: RepositoryEntryPoint, mapping?: FeatureGroupMapping, hidden = false,
): RepositoryFeature {
  const nodes = new Map(analysis.nodes.filter((node) => node.type !== "file").map((node) => [node.id, node]));
  const scope = hidden ? { ids: new Set([entry.id]), expandable: new Set<string>() } : collectScope(entry, edges, nodes, entryIds);
  for (const id of mapping?.includeNodeIds ?? []) {
    if (nodes.has(id) && (id === entry.id || !entryIds.has(id))) scope.ids.add(id);
  }
  const groupEdges = edges.filter((edge) => scope.expandable.has(edge.source) && scope.ids.has(edge.target)
    && (edge.target === entry.id || !entryIds.has(edge.target) || edge.relation === "api"));
  const label = metadata ? routeTitle(metadata) : { title: entry.name, inferred: false };
  const title = mapping?.title?.trim() || label.title;
  const titleInferred = Boolean(!mapping?.title?.trim() && label.inferred);
  const limited = !groupEdges.some((edge) => edge.confidence === "confirmed");
  const routeDescription = metadata
    ? `${metadata.kind === "page" ? "페이지" : "API"} 진입점 ${metadata.method ? `${metadata.method} ` : ""}${metadata.routePath} (${metadata.filePath}).`
    : hidden ? "독립 라우트로 확인되지 않은 내부 코드입니다." : "사용자가 지정한 코드 진입점입니다.";
  const notes = [
    mapping?.description?.trim() || routeDescription,
    titleInferred ? "표시 이름은 경로·메서드에 따른 추정이며 실제 업무 의미를 확정하지 않습니다." : undefined,
    hidden ? undefined : limited ? "확인된 하위 연결이 없습니다." : "진입점에서 나가는 정적 코드 관계를 표시합니다.",
    groupEdges.some((edge) => edge.relation === "reference") ? "참조·콜백 전달은 실행을 뜻하지 않으며, 콜백 본문의 연결도 실행 시점이나 실행 여부를 보장하지 않습니다." : undefined,
    groupEdges.some((edge) => edge.confidence === "inferred") ? "추정 관계는 따로 표시하며 기능 범위를 확장하는 근거로 사용하지 않습니다." : undefined,
    groupEdges.some((edge) => edge.relation === "api" && entryIds.has(edge.target) && edge.target !== entry.id) ? "API 진입점 이후 구현은 해당 API 기능에서 확인하세요." : undefined,
    analysis.collection?.partial ? "분석 파일 제한으로 일부 관계가 누락될 수 있습니다." : undefined,
  ].filter(Boolean);
  return {
    id: metadata ? `feature:${metadata.kind}:${metadata.filePath}${metadata.method ? `:${metadata.method}` : ""}` : `feature:${hidden ? "internal" : "manual"}:${entry.id}`,
    title, technicalName: entry.name, description: notes.join(" "),
    entryNodeId: entry.id, entryFilePath: metadata?.filePath ?? entry.filePath,
    nodeIds: [...scope.ids], edgeIds: groupEdges.map((edge) => edge.id),
    filePaths: [...new Set([metadata?.filePath ?? entry.filePath, ...[...scope.ids].map((id) => nodes.get(id)!.filePath)])],
    connectedNodeCount: scope.ids.size, connectionCount: groupEdges.length, limited, hidden,
    hiddenReason: hidden ? "파일 기반 페이지·API 진입점으로 확인되지 않은 코드" : undefined,
    score: (metadata?.kind === "page" ? 100 : metadata?.kind === "api" ? 50 : 0) + groupEdges.length * 10 + scope.ids.size * 2,
    entryKind: metadata?.kind ?? (hidden ? "internal" : "manual"), routePath: metadata?.routePath,
    httpMethod: metadata?.method, titleInferred,
  };
}

export function discoverRepositoryFeatures(analysis: RepositoryAnalysis, options: FeatureDiscoveryOptions = {}): RepositoryFeatureDiscovery {
  const nodes = new Map(analysis.nodes.filter((node) => node.type !== "file").map((node) => [node.id, node]));
  const edges = symbolEdges(analysis);
  const entries = (analysis.entryPoints ?? []).filter((entry) => nodes.has(entry.nodeId));
  const entryIds = new Set(entries.map((entry) => entry.nodeId));
  const mappings = new Map((options.mappings ?? []).map((mapping) => [mapping.entryNodeId, mapping]));
  const automatic = entries.map((metadata) => makeFeature(analysis, nodes.get(metadata.nodeId)!, edges, entryIds, metadata, mappings.get(metadata.nodeId)));
  for (const mapping of options.mappings ?? []) {
    if (entryIds.has(mapping.entryNodeId) || !nodes.has(mapping.entryNodeId)) continue;
    automatic.push(makeFeature(analysis, nodes.get(mapping.entryNodeId)!, edges, entryIds, undefined, mapping));
  }
  const sort = (a: RepositoryFeature, b: RepositoryFeature) => b.score - a.score || a.id.localeCompare(b.id);
  const owned = new Set(automatic.flatMap((feature) => feature.nodeIds));
  return {
    primary: automatic.filter((feature) => !feature.limited).sort(sort),
    limited: automatic.filter((feature) => feature.limited).sort(sort),
    hidden: [...nodes.values()].filter((node) => !owned.has(node.id)).map((node) => makeFeature(analysis, node, edges, entryIds, undefined, undefined, true)).sort(sort),
  };
}

/** Keep feature boundaries identical in developer, learning and AI projections. */
export function repositoryFeatureEdges(analysis: RepositoryAnalysis, feature: RepositoryFeature): CodeEdge[] {
  const nodes = new Set(feature.nodeIds);
  const ids = feature.edgeIds ? new Set(feature.edgeIds) : undefined;
  return analysis.edges.filter((edge) => edge.relation !== "import" && nodes.has(edge.source) && nodes.has(edge.target) && (!ids || ids.has(edge.id)));
}

export function traverseRepositoryFeature(analysis: RepositoryAnalysis, feature: RepositoryFeature, maxDepth: number, expandedNodeIds: Iterable<string> = [], selectedNodeId?: string): TraversalResult {
  const ids = new Set(feature.nodeIds);
  return traceDisplayGraph(feature.entryNodeId, analysis.nodes.filter((node) => ids.has(node.id)), repositoryFeatureEdges(analysis, feature), { maxDepth, expandedNodeIds, selectedNodeId });
}
