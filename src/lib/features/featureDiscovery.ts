import { traverseGraphAround } from "@/lib/graph/dfs";
import type {
  CodeEdge,
  CodeNode,
  RepositoryAnalysis,
  RepositoryFeature,
  RepositoryFeatureDiscovery,
  TraversalResult,
} from "@/types/analysis";

const GENERIC_UI_NAMES = new Set([
  "Button", "IconButton", "Input", "TextInput", "Modal", "Dialog", "Card", "Header", "Footer",
  "Layout", "Container", "Spacer", "Divider", "Loader", "Spinner", "ErrorState", "EmptyState",
]);
const TOOLING_PATH = /(?:^|\/)(?:plugins?|scripts?|config|configs|tooling|buildSrc|gradle|\.github)(?:\/|$)|(?:^|\/)(?:babel|metro|webpack|vite|jest|eslint|prettier)\.config\./i;
const COMMON_COMPONENT_PATH = /(?:^|\/)components\/(?:common|ui|layout|feedback)(?:\/|$)/i;
const BUSINESS_PATH = /(?:^|\/)(?:app|features?|screens?|routes?|api|domain|services?)(?:\/|$)/i;
const ENTRY_NAME = /(?:Route|Screen|Page|View|Controller|Handler|Service)$/;

function isTooling(node: CodeNode): boolean {
  return TOOLING_PATH.test(node.filePath)
    || /(?:Gradle|Webpack|Babel|Metro|ConfigPlugin)/i.test(node.name);
}

function isGenericUi(node: CodeNode): boolean {
  return GENERIC_UI_NAMES.has(node.name)
    || COMMON_COMPONENT_PATH.test(node.filePath);
}

function hiddenReason(node: CodeNode): string | undefined {
  if (isTooling(node)) return "빌드·개발 환경 코드";
  if (isGenericUi(node)) return "공통 UI 컴포넌트";
  return undefined;
}

function isBusinessEntry(node: CodeNode): boolean {
  return BUSINESS_PATH.test(node.filePath)
    && (node.type === "api" || node.type === "component" || ENTRY_NAME.test(node.name));
}

function actualEdges(analysis: RepositoryAnalysis): CodeEdge[] {
  const symbolIds = new Set(analysis.nodes.filter((node) => node.type !== "file").map((node) => node.id));
  return analysis.edges.filter((edge) => edge.relation !== "import" && symbolIds.has(edge.source) && symbolIds.has(edge.target));
}

function entryScore(node: CodeNode, edges: CodeEdge[]): number {
  const outgoing = edges.filter((edge) => edge.source === node.id).length;
  const incoming = edges.filter((edge) => edge.target === node.id).length;
  const roleScore = /Route$/.test(node.name) ? 55
    : /Page$/.test(node.name) ? 48
      : /Screen$/.test(node.name) ? 42
        : ENTRY_NAME.test(node.name) ? 30
          : 0;
  return (node.type === "api" ? 120 : node.type === "component" ? 80 : 20)
    + roleScore
    + (BUSINESS_PATH.test(node.filePath) ? 25 : 0)
    + outgoing * 8
    + incoming * 3
    - (hiddenReason(node) ? 250 : 0);
}

function koreanTitle(name: string): string | undefined {
  if (/DocumentScan/i.test(name)) return "문서 스캔";
  if (/PreviousCaseLookup/i.test(name)) return "이전 사건 조회";
  if (/NearbyAgenc(?:y|ies)/i.test(name)) return "주변 기관 검색";
  if (/(?:Case|Incident)Report|Report(?:Case|Incident)/i.test(name)) return "사건 신고 및 접수";
  if (/(?:Report|Case)Form|Form(?:Report|Case)/i.test(name)) return "신고서 작성";
  if (/VoiceInput/i.test(name)) return "음성 입력";
  if (/DocumentExport/i.test(name)) return "문서 내보내기";
  return undefined;
}

function featureFromNodes(
  coreNodes: CodeNode[],
  boundaryNodes: CodeNode[],
  edges: CodeEdge[],
  hidden = false,
): RepositoryFeature {
  const allNodes = [...coreNodes, ...boundaryNodes.filter((node) => !coreNodes.some((item) => item.id === node.id))];
  const allIds = new Set(allNodes.map((node) => node.id));
  const groupEdges = edges.filter((edge) => allIds.has(edge.source) && allIds.has(edge.target));
  const entry = [...coreNodes].sort((a, b) => entryScore(b, edges) - entryScore(a, edges) || a.name.localeCompare(b.name))[0];
  const filePaths = [...new Set(allNodes.map((node) => node.filePath))];
  const title = koreanTitle(entry.name) ?? entry.name;
  const limited = groupEdges.length === 0;
  return {
    id: `feature:${entry.id}`,
    title,
    technicalName: entry.name,
    description: limited
      ? `${entry.filePath}에서 확인된 항목이며 정적 분석으로 연결 관계를 찾지 못했습니다.`
      : `${entry.filePath}에서 시작하며 AST에서 ${groupEdges.length}개의 실제 연결을 확인했습니다.`,
    entryNodeId: entry.id,
    entryFilePath: entry.filePath,
    nodeIds: allNodes.map((node) => node.id),
    filePaths,
    connectedNodeCount: allNodes.length,
    connectionCount: groupEdges.length,
    limited,
    hidden,
    hiddenReason: hidden ? hiddenReason(entry) ?? "내부 헬퍼 또는 독립 함수" : undefined,
    score: entryScore(entry, edges) + groupEdges.length * 10 + allNodes.length * 2,
  };
}

function connectedComponents(nodes: CodeNode[], edges: CodeEdge[]): CodeNode[][] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) continue;
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
    adjacency.set(edge.target, [...(adjacency.get(edge.target) ?? []), edge.source]);
  }

  const visited = new Set<string>();
  const groups: CodeNode[][] = [];
  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    const group: CodeNode[] = [];
    const stack = [node.id];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const item = nodeMap.get(current);
      if (item) group.push(item);
      for (const next of adjacency.get(current) ?? []) if (!visited.has(next)) stack.push(next);
    }
    groups.push(group);
  }
  return groups;
}

export function discoverRepositoryFeatures(analysis: RepositoryAnalysis): RepositoryFeatureDiscovery {
  const nodes = analysis.nodes.filter((node) => node.type !== "file");
  const edges = actualEdges(analysis);
  const connectedIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  const shouldHide = (node: CodeNode) => Boolean(hiddenReason(node))
    || !connectedIds.has(node.id) && !isBusinessEntry(node);
  const hiddenNodes = nodes.filter(shouldHide);
  const visibleNodes = nodes.filter((node) => !shouldHide(node));
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  const hiddenMap = new Map(hiddenNodes.map((node) => [node.id, node]));

  const features = connectedComponents(visibleNodes, visibleEdges).map((group) => {
    const groupIds = new Set(group.map((node) => node.id));
    const boundaryIds = new Set<string>();
    for (const edge of edges) {
      if (groupIds.has(edge.source) && hiddenMap.has(edge.target)) boundaryIds.add(edge.target);
      if (groupIds.has(edge.target) && hiddenMap.has(edge.source)) boundaryIds.add(edge.source);
    }
    return featureFromNodes(group, [...boundaryIds].flatMap((id) => hiddenMap.has(id) ? [hiddenMap.get(id)!] : []), edges);
  });

  const hidden = hiddenNodes.map((node) => {
    const neighborIds = new Set<string>();
    for (const edge of edges) {
      if (edge.source === node.id) neighborIds.add(edge.target);
      if (edge.target === node.id) neighborIds.add(edge.source);
    }
    const neighbors = [...neighborIds].flatMap((id) => {
      const match = nodes.find((item) => item.id === id);
      return match ? [match] : [];
    });
    return featureFromNodes([node], neighbors, edges, true);
  }).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

  const primary = features
    .filter((feature) => !feature.limited)
    .sort((a, b) => b.score - a.score || b.connectionCount - a.connectionCount || a.title.localeCompare(b.title));
  const limited = features
    .filter((feature) => feature.limited)
    .sort((a, b) => {
      const aBusiness = BUSINESS_PATH.test(a.entryFilePath) ? 1 : 0;
      const bBusiness = BUSINESS_PATH.test(b.entryFilePath) ? 1 : 0;
      return bBusiness - aBusiness || b.score - a.score || a.title.localeCompare(b.title);
    });
  return { primary, limited, hidden };
}

export function traverseRepositoryFeature(
  analysis: RepositoryAnalysis,
  feature: RepositoryFeature,
  maxDepth: number,
): TraversalResult {
  const allowed = new Set(feature.nodeIds);
  const nodes = analysis.nodes.filter((node) => allowed.has(node.id));
  const edges = analysis.edges.filter((edge) => allowed.has(edge.source) && allowed.has(edge.target) && edge.relation !== "import");
  return traverseGraphAround(feature.entryNodeId, nodes, edges, maxDepth);
}
