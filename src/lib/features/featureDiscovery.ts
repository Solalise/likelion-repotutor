import { traceDisplayGraph } from "@/lib/graph/dfs";
import type { CodeEdge, CodeNode, RepositoryAnalysis, RepositoryFeature, RepositoryFeatureDiscovery, TraversalResult } from "@/types/analysis";

const GENERIC_UI_NAMES = new Set([
  "Button", "IconButton", "Input", "TextInput", "Modal", "Dialog", "Card", "Header", "Footer",
  "Layout", "Container", "Spacer", "Divider", "Loader", "Spinner", "ErrorState", "EmptyState",
]);
const TOOLING_PATH = /(?:^|\/)(?:plugins?|scripts?|config|configs|tooling|buildSrc|gradle|\.github)(?:\/|$)|(?:^|\/)(?:babel|metro|webpack|vite|jest|eslint|prettier)\.config\./i;
const TEST_PATH = /(?:^|\/)(?:__tests__|tests?|fixtures?)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/i;
const COMMON_COMPONENT_PATH = /(?:^|\/)components\/(?:common|ui|layout|feedback)(?:\/|$)/i;
const USER_ENTRY_PATH = /(?:^|\/)(?:app|pages?|screens?|routes?)(?:\/|$)/i;
const USER_ENTRY_NAME = /(?:Route|Screen|Page)$/;
const INTERNAL_NAME = /^(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$|(?:Provider|Context|Layout|Hook)$/i;
const TRAVERSAL_BOUNDARY = /(?:Provider|Context|Layout|View|ViewShared)$|^use[A-Z]|Mock|\.mock$|(?:BottomNavigation|NavigationItem|AppScreen|FlowHeader|ProgressBar)$/;
const MAX_FEATURE_DEPTH = 5;

export interface FeatureGroupMapping {
  entryNodeId: string;
  title?: string;
  description?: string;
  includeNodeIds?: string[];
}

export interface FeatureDiscoveryOptions {
  mappings?: FeatureGroupMapping[];
}

function isTooling(node: CodeNode): boolean {
  return TOOLING_PATH.test(node.filePath) || TEST_PATH.test(node.filePath)
    || /(?:Gradle|Webpack|Babel|Metro|ConfigPlugin)/i.test(node.name);
}

function isGenericUi(node: CodeNode): boolean {
  return GENERIC_UI_NAMES.has(node.name) || COMMON_COMPONENT_PATH.test(node.filePath);
}

function hiddenReason(node: CodeNode): string | undefined {
  if (isTooling(node)) return "개발·테스트 도구 코드";
  if (isGenericUi(node)) return "공통 UI 컴포넌트";
  if (INTERNAL_NAME.test(node.name)) return "HTTP 핸들러 또는 내부 인프라";
  if (TRAVERSAL_BOUNDARY.test(node.name)) return "Provider·Hook·Mock 등 내부 코드";
  return undefined;
}

function isUserFeatureEntry(node: CodeNode): boolean {
  return node.type === "component" && USER_ENTRY_NAME.test(node.name) && USER_ENTRY_PATH.test(node.filePath)
    && !isTooling(node) && !isGenericUi(node) && !INTERNAL_NAME.test(node.name);
}

function actualEdges(analysis: RepositoryAnalysis): CodeEdge[] {
  const symbolIds = new Set(analysis.nodes.filter((node) => node.type !== "file").map((node) => node.id));
  return analysis.edges.filter((edge) => edge.relation !== "import" && symbolIds.has(edge.source) && symbolIds.has(edge.target));
}

function entryScore(node: CodeNode, edges: CodeEdge[]): number {
  const outgoing = edges.filter((edge) => edge.source === node.id).length;
  const incoming = edges.filter((edge) => edge.target === node.id).length;
  const roleScore = /Route$/.test(node.name) ? 80 : /Page$/.test(node.name) ? 65 : /Screen$/.test(node.name) ? 55 : 0;
  return roleScore + outgoing * 8 + incoming * 3 - (hiddenReason(node) ? 250 : 0);
}

function featureStem(node: CodeNode): string {
  return node.name.replace(/(?:Route|Screen|Page)$/, "").toLocaleLowerCase("en");
}

function applicationScope(node: CodeNode): string {
  return node.filePath.split("/").slice(0, 2).join("/").toLocaleLowerCase("en");
}

function selectFeatureEntries(nodes: CodeNode[], edges: CodeEdge[]): CodeNode[] {
  const byFeature = new Map<string, CodeNode>();
  for (const node of nodes.filter(isUserFeatureEntry)) {
    const key = `${applicationScope(node)}:${featureStem(node)}`;
    const current = byFeature.get(key);
    if (!current || entryScore(node, edges) > entryScore(current, edges)) byFeature.set(key, node);
  }
  return [...byFeature.values()];
}

const TOKEN_LABELS: Record<string, string> = {
  access: "접근", agencies: "기관", agency: "기관", card: "카드", case: "사건", complete: "완료",
  confirmation: "확인", create: "생성", directions: "길 안내", document: "문서", documents: "문서",
  guide: "가이드", guides: "가이드", home: "홈", insurance: "보험", lookup: "조회", nearby: "주변",
  new: "새로운", police: "경찰", previous: "이전", product: "상품", products: "상품", report: "신고서",
  scan: "스캔", summary: "요약", conversation: "대화",
};

function identifierWords(name: string): string[] {
  return name.replace(/(?:Route|Screen|Page)$/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ").trim().split(/\s+/).filter(Boolean);
}

function userFeatureTitle(name: string): string {
  return identifierWords(name).map((word) => TOKEN_LABELS[word.toLocaleLowerCase("en")] ?? word).join(" ");
}

function adjacencyFor(nodes: CodeNode[], edges: CodeEdge[]): Map<string, string[]> {
  const ids = new Set(nodes.map((node) => node.id));
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
    adjacency.set(edge.target, [...(adjacency.get(edge.target) ?? []), edge.source]);
  }
  return adjacency;
}

function collectFeatureNodes(entry: CodeNode, nodes: CodeNode[], adjacency: Map<string, string[]>, entryIds: Set<string>): CodeNode[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: entry.id, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.id)) continue;
    const node = nodeMap.get(current.id);
    if (!node) continue;
    if (current.id !== entry.id && entryIds.has(current.id)) continue;
    visited.add(current.id);
    if (current.depth >= MAX_FEATURE_DEPTH) continue;
    if (current.id !== entry.id && (isGenericUi(node) || isTooling(node) || TRAVERSAL_BOUNDARY.test(node.name))) continue;
    for (const next of adjacency.get(current.id) ?? []) if (!visited.has(next)) queue.push({ id: next, depth: current.depth + 1 });
  }
  return [...visited].flatMap((id) => nodeMap.has(id) ? [nodeMap.get(id)!] : []);
}

function featureFromNodes(
  entry: CodeNode,
  featureNodes: CodeNode[],
  edges: CodeEdge[],
  partial: boolean,
  mapping?: FeatureGroupMapping,
  hidden = false,
): RepositoryFeature {
  const uniqueNodes = [...new Map(featureNodes.map((node) => [node.id, node])).values()];
  const allIds = new Set(uniqueNodes.map((node) => node.id));
  const groupEdges = edges.filter((edge) => allIds.has(edge.source) && allIds.has(edge.target));
  const title = mapping?.title?.trim() || userFeatureTitle(entry.name);
  const limited = groupEdges.length === 0;
  const baseDescription = mapping?.description?.trim() || (limited
    ? `${title} 진입점은 확인했지만 연결된 내부 코드는 정적 분석에서 확인되지 않았습니다.`
    : `${title} 화면에서 시작해 정적으로 연결이 확인된 코드 흐름입니다.`);
  return {
    id: `feature:${entry.id}`,
    title,
    technicalName: entry.name,
    description: partial ? `${baseDescription} 분석 파일 제한으로 일부 단계가 누락될 수 있습니다.` : baseDescription,
    entryNodeId: entry.id,
    entryFilePath: entry.filePath,
    nodeIds: uniqueNodes.map((node) => node.id),
    filePaths: [...new Set(uniqueNodes.map((node) => node.filePath))],
    connectedNodeCount: uniqueNodes.length,
    connectionCount: groupEdges.length,
    limited,
    hidden,
    hiddenReason: hidden ? hiddenReason(entry) ?? "독립적인 사용자 기능으로 확인되지 않은 내부 코드" : undefined,
    score: entryScore(entry, edges) + groupEdges.length * 10 + uniqueNodes.length * 2,
  };
}

export function discoverRepositoryFeatures(analysis: RepositoryAnalysis, options: FeatureDiscoveryOptions = {}): RepositoryFeatureDiscovery {
  const nodes = analysis.nodes.filter((node) => node.type !== "file");
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edges = actualEdges(analysis);
  const entries = selectFeatureEntries(nodes, edges);
  const entryIds = new Set(entries.map((node) => node.id));
  const adjacency = adjacencyFor(nodes, edges);
  const mappingByEntry = new Map((options.mappings ?? []).map((mapping) => [mapping.entryNodeId, mapping]));
  const automatic = entries.map((entry) => {
    const mapping = mappingByEntry.get(entry.id);
    const collected = collectFeatureNodes(entry, nodes, adjacency, entryIds);
    for (const nodeId of mapping?.includeNodeIds ?? []) {
      const node = nodeMap.get(nodeId);
      if (node && !collected.some((item) => item.id === node.id)) collected.push(node);
    }
    return featureFromNodes(entry, collected, edges, Boolean(analysis.collection?.partial), mapping);
  });
  for (const mapping of options.mappings ?? []) {
    if (automatic.some((feature) => feature.entryNodeId === mapping.entryNodeId)) continue;
    const entry = nodeMap.get(mapping.entryNodeId);
    if (!entry) continue;
    const mappedNodes = [entry, ...(mapping.includeNodeIds ?? []).flatMap((id) => nodeMap.has(id) ? [nodeMap.get(id)!] : [])];
    automatic.push(featureFromNodes(entry, mappedNodes, edges, Boolean(analysis.collection?.partial), mapping));
  }
  const primary = automatic.filter((feature) => !feature.limited).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  const limited = automatic.filter((feature) => feature.limited).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  const ownedIds = new Set(automatic.flatMap((feature) => feature.nodeIds));
  const hidden = nodes.filter((node) => !ownedIds.has(node.id) || Boolean(hiddenReason(node)))
    .map((node) => featureFromNodes(node, [node], edges, Boolean(analysis.collection?.partial), undefined, true))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return { primary, limited, hidden };
}

export function traverseRepositoryFeature(
  analysis: RepositoryAnalysis,
  feature: RepositoryFeature,
  maxDepth: number,
  expandedNodeIds: Iterable<string> = [],
): TraversalResult {
  const allowed = new Set(feature.nodeIds);
  const nodes = analysis.nodes.filter((node) => allowed.has(node.id));
  const edges = analysis.edges.filter((edge) => allowed.has(edge.source) && allowed.has(edge.target) && edge.relation !== "import");
  return traceDisplayGraph(feature.entryNodeId, nodes, edges, { maxDepth, expandedNodeIds });
}
