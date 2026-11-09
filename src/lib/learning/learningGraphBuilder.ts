import type { CodeNode, RepositoryAnalysis } from "@/types/analysis";
import type { LearningEdge, LearningGraph, LearningNode, LearningStage } from "@/types/learning";
import { generateLearningLabel } from "./labelGenerator";
import { aggregateRelationEdges, depthFirstReachability, selectConnectedNodeIds, uniqueGraphNodes } from "@/lib/graph/dfs";

const DEMO_DETAILS: Record<string, Pick<LearningNode, "codeSnippet" | "nextStep" | "relatedFiles">> = {
  LoginPage: {
    codeSnippet: "export default function LoginPage() {\n  return <button onClick={handleLogin}>로그인</button>;\n}",
    nextStep: "사용자가 로그인 버튼을 누르면 handleLogin()이 실행됩니다.",
    relatedFiles: ["app/login/page.tsx"],
  },
  handleLogin: {
    codeSnippet: "const handleLogin = async () => {\n  await login({ email, password });\n};",
    nextStep: "login()이 입력 정보를 받아 API 요청을 준비합니다.",
    relatedFiles: ["services/auth.ts"],
  },
  login: {
    codeSnippet: "const response = await fetch(\"/api/auth/login\", {\n  method: \"POST\",\n  body: JSON.stringify(input),\n});",
    nextStep: "POST /api/auth/login으로 인증 요청을 보냅니다.",
    relatedFiles: ["app/api/auth/route.ts"],
  },
  POST: {
    codeSnippet: "export async function POST(request: Request) {\n  const input = await request.json();\n  const user = findUser(input.email);\n}",
    nextStep: "findUser()가 이메일과 일치하는 사용자를 조회합니다.",
    relatedFiles: ["repositories/userRepository.ts"],
  },
  findUser: {
    codeSnippet: "export function findUser(email: string) {\n  return users.find((user) => user.email === email);\n}",
    nextStep: "조회 결과에 따라 로그인 성공과 실패 흐름으로 나뉩니다.",
    relatedFiles: ["app/api/auth/route.ts"],
  },
};

function fromCodeNode(node: CodeNode, mode: "analysis" | "demo" = "analysis", context?: Parameters<typeof generateLearningLabel>[2]): LearningNode {
  const label = generateLearningLabel(node, mode, context);
  const details = mode === "demo" ? DEMO_DETAILS[node.name] ?? { relatedFiles: [] } : { relatedFiles: [] };
  return {
    id: node.id,
    technicalName: node.name,
    ...label,
    filePath: node.filePath,
    line: node.line,
    codeSnippet: details.codeSnippet ?? node.sourceCode,
    codeEndLine: node.endLine,
    nextStep: details.nextStep,
    relatedFiles: details.relatedFiles,
    connectionReason: mode === "demo" ? "로그인 데모를 설명하기 위한 학습 단계입니다." : "AST에서 다른 코드와의 관계를 확인했습니다.",
    incomingRelations: [],
    outgoingRelations: [],
    confidence: mode === "demo" ? "limited" : "confirmed",
    source: mode === "demo" ? "demo" : "ast",
  };
}

function findNode(analysis: RepositoryAnalysis, name: string): CodeNode | undefined {
  return analysis.nodes.find((node) => node.name === name && node.type !== "file");
}

function edge(source: string, target: string, relation: LearningEdge["relation"], label?: string): LearningEdge {
  return { id: `learning:${source}->${target}`, source, target, relation, label };
}

function buildDemoLoginGraph(analysis: RepositoryAnalysis): LearningGraph | undefined {
  const loginPage = findNode(analysis, "LoginPage");
  const handleLogin = findNode(analysis, "handleLogin");
  const login = findNode(analysis, "login");
  const api = findNode(analysis, "POST");
  const findUser = findNode(analysis, "findUser");
  if (!loginPage || !handleLogin || !login || !api || !findUser) return undefined;

  const start = fromCodeNode(loginPage, "demo");
  const conditionId = "learning:condition:user-exists";
  const failureId = "learning:end:login-failure";
  const successId = "learning:end:login-success";
  const nodes: LearningNode[] = [
    start,
    fromCodeNode(handleLogin, "demo"),
    fromCodeNode(login, "demo"),
    fromCodeNode(api, "demo"),
    fromCodeNode(findUser, "demo"),
    {
      id: conditionId,
      title: "사용자가 존재하는가?",
      description: "사용자 조회 결과가 있는지 확인해 이후 흐름을 결정합니다.",
      purpose: "조건에 따라 성공 응답과 오류 응답 중 하나만 실행되도록 분기합니다.",
      category: "condition",
      filePath: "app/api/auth/route.ts",
      codeSnippet: "if (!user) {\n  return Response.json({ ok: false }, { status: 401 });\n}",
      nextStep: "사용자가 없으면 로그인 실패, 있으면 로그인 성공으로 이동합니다.",
      relatedFiles: ["repositories/userRepository.ts"],
      connectionReason: "로그인 데모의 조건 분기를 설명하기 위한 보조 단계입니다.",
      incomingRelations: [], outgoingRelations: [],
      confidence: "limited",
      source: "demo",
    },
    {
      id: failureId,
      title: "로그인 실패",
      description: "사용자를 찾지 못해 401 오류 응답을 반환합니다.",
      purpose: "인증 실패 상태를 화면에 전달할 수 있도록 명확한 결과를 만듭니다.",
      category: "error",
      filePath: "app/api/auth/route.ts",
      codeSnippet: "return Response.json({ ok: false }, { status: 401 });",
      relatedFiles: [],
      connectionReason: "로그인 데모의 실패 결과를 설명하기 위한 보조 단계입니다.",
      incomingRelations: [], outgoingRelations: [],
      confidence: "limited",
      source: "demo",
    },
    {
      id: successId,
      title: "로그인 성공",
      description: "사용자를 찾아 성공 결과와 사용자 정보를 반환합니다.",
      purpose: "인증된 사용자가 다음 화면으로 이동할 수 있는 결과를 제공합니다.",
      category: "end",
      filePath: "app/api/auth/route.ts",
      codeSnippet: "return Response.json({ ok: true, user });",
      relatedFiles: [],
      connectionReason: "로그인 데모의 성공 결과를 설명하기 위한 보조 단계입니다.",
      incomingRelations: [], outgoingRelations: [],
      confidence: "limited",
      source: "demo",
    },
  ];
  const edges = [
    edge(start.id, handleLogin.id, "execute", "화면에서 실행"),
    edge(handleLogin.id, login.id, "execute", "실행"),
    edge(login.id, api.id, "request", "API 요청"),
    edge(api.id, findUser.id, "query", "데이터 조회"),
    edge(findUser.id, conditionId, "return", "조회 결과"),
    edge(conditionId, failureId, "branch", "아니요"),
    edge(conditionId, successId, "branch", "예"),
  ];
  return { nodes, edges };
}

export function buildLearningGraph(analysis: RepositoryAnalysis): LearningGraph {
  const demoGraph = analysis.source === "sample" ? buildDemoLoginGraph(analysis) : undefined;
  if (demoGraph) return demoGraph;

  return buildRepositoryLearningGraph(analysis);
}

function relationLabel(relation: LearningEdge["relation"]): string {
  if (relation === "component") return "컴포넌트 표시";
  if (relation === "reference") return "함수 참조·전달 (실행 미확정)";
  if (relation === "import") return "파일 불러오기";
  if (relation === "request") return "API 요청";
  return "함수 호출";
}

export function buildRepositoryLearningGraph(
  analysis: RepositoryAnalysis,
  selectedNodeIds?: Iterable<string>,
): LearningGraph {
  const allowed = selectedNodeIds ? new Set(selectedNodeIds) : undefined;
  const codeNodes = uniqueGraphNodes(analysis.nodes.filter((node) => node.type !== "file" && (!allowed || allowed.has(node.id))));
  const codeNodeMap = new Map(codeNodes.map((node) => [node.id, node]));
  const directEdges: LearningEdge[] = analysis.edges.flatMap((item) => {
    const source = codeNodeMap.get(item.source);
    const target = codeNodeMap.get(item.target);
    if (!source || !target || item.relation === "import") return [];
    const relation: LearningEdge["relation"] = item.relation === "api" ? "request"
      : item.relation === "component" ? "component"
        : item.relation === "reference" ? "reference" : "call";
    return [{ id: `learning:${item.id}`, source: item.source, target: item.target, relation,
      confidence: item.confidence, occurrences: item.occurrences ?? [{ edgeId: item.id, line: item.line, evidence: item.evidence, confidence: item.confidence }],
      label: `${relationLabel(relation)}${item.confidence === "inferred" ? " · 추정" : item.confidence === "confirmed" ? " · 정적 확인" : " · 근거 미표시"}` }];
  });

  // File dependencies remain in the developer graph; they are not function flow.
  const edges = aggregateRelationEdges(directEdges).map((edge) => ({ ...edge,
    label: `${relationLabel(edge.relation)}${edge.confidence === "inferred" ? " · 추정" : edge.confidence === "confirmed" ? " · 정적 확인" : " · 근거 미표시"}` }));
  const pageEntryIds = new Set((analysis.entryPoints ?? []).filter((entry) => entry.kind === "page").map((entry) => entry.nodeId));
  const baseById = new Map(codeNodes.map((node) => {
    const base = fromCodeNode(node, "analysis", { edges: analysis.edges.filter((edge) => codeNodeMap.has(edge.source) && codeNodeMap.has(edge.target)), entryPoints: analysis.entryPoints });
    return [node.id, pageEntryIds.has(node.id) ? {
      ...base, category: "start" as const, title: "페이지 진입점",
      description: "파일 기반 페이지의 default export로 연결된 함수입니다. 원본 코드와 정적 연결 관계를 확인해 주세요.",
      purpose: "이 경로의 페이지 코드를 살펴보는 출발점입니다.",
    } : base];
  }));
  const roleOf = (nodeId: string): string => {
    const node = baseById.get(nodeId);
    return `${node?.title ?? "함수"}${node?.roleConfidence === "inferred" ? " · 추정" : ""}`;
  };
  const relationPriority: Record<LearningEdge["relation"], number> = {
    request: 0, call: 1, reference: 2, component: 3, query: 4, import: 5, execute: 6, return: 7, branch: 8,
  };
  const nodes = codeNodes.map((node) => {
    const related = edges.filter((item) => item.source === node.id || item.target === node.id);
    const relatedNodeIds = new Set(related.flatMap((item) => [item.source, item.target]).filter((id) => id !== node.id));
    const relatedFiles = [...relatedNodeIds].flatMap((id) => codeNodeMap.has(id) ? [codeNodeMap.get(id)!.filePath] : []);
    const relationNames = [...new Set(related.map((item) => relationLabel(item.relation)))];
    const incomingRelations = [...new Set(edges.filter((item) => item.target === node.id).sort((a, b) => relationPriority[a.relation] - relationPriority[b.relation]).flatMap((item) => {
      const source = codeNodeMap.get(item.source);
      return source ? [`${source.name} (${roleOf(source.id)}) → ${node.name} (${roleOf(node.id)}) · ${item.label ?? relationLabel(item.relation)}`] : [];
    }))];
    const outgoingRelations = [...new Set(edges.filter((item) => item.source === node.id).sort((a, b) => relationPriority[a.relation] - relationPriority[b.relation]).flatMap((item) => {
      const target = codeNodeMap.get(item.target);
      return target ? [`${node.name} (${roleOf(node.id)}) → ${target.name} (${roleOf(target.id)}) · ${item.label ?? relationLabel(item.relation)}`] : [];
    }))];
    const base = baseById.get(node.id)!;
    const outgoingNames = edges.filter((item) => item.source === node.id).flatMap((item) => {
      const target = codeNodeMap.get(item.target);
      return target ? [target.name] : [];
    });
    const incomingNames = edges.filter((item) => item.target === node.id).flatMap((item) => {
      const source = codeNodeMap.get(item.source);
      return source ? [source.name] : [];
    });
    return {
      ...base,
      description: outgoingNames.length > 0
        ? `${base.description} AST에서는 ${[...new Set(outgoingNames)].slice(0, 3).join(", ")} 코드와 직접 연결됩니다.`
        : base.description,
      purpose: incomingNames.length > 0
        ? `정적 분석에서 ${[...new Set(incomingNames)].slice(0, 3).join(", ")} 코드로부터 연결된 관계가 있습니다. 아래 관계 종류와 원본 코드를 함께 확인해 주세요.`
        : base.purpose,
      relatedFiles: [...new Set(relatedFiles)],
      connectionReason: relationNames.length > 0
        ? [...incomingRelations, ...outgoingRelations].slice(0, 2).join(" ")
        : "정적 분석에서 이 코드와 직접 연결된 관계를 찾지 못했습니다.",
      incomingRelations,
      outgoingRelations,
      confidence: related.length > 0 && related.every((item) => item.confidence === "confirmed") ? "confirmed" as const : "limited" as const,
    };
  });
  return { nodes, edges };
}

export function summarizeLearningFeature(featureTitle: string, graph: LearningGraph): string {
  const screens = graph.nodes.filter((node) => node.category === "start" || node.category === "ui-action").slice(0, 2);
  const actions = graph.nodes.filter((node) => /^(?:handle|on)[A-Z]/.test(node.technicalName ?? "")).slice(0, 2);
  const services = graph.nodes.filter((node) => node.category === "service" || node.category === "api").slice(0, 2);
  const parts = [
    screens.length > 0 ? `${screens.map((node) => node.technicalName).join(", ")} 화면 코드` : undefined,
    actions.length > 0 ? `${actions.map((node) => node.technicalName).join(", ")} 이름 기반 동작 후보(추정)` : undefined,
    services.length > 0 ? `${services.map((node) => node.technicalName).join(", ")} 서비스·API 코드` : undefined,
  ].filter(Boolean);
  return parts.length > 0
    ? `${featureTitle} 기능에서 ${parts.join("와 ")}의 정적 관계를 살펴봅니다.`
    : `${featureTitle} 기능에서 정적 분석으로 확인된 코드 관계를 살펴봅니다.`;
}

function uniqueNodeIds(nodes: LearningNode[]): string[] {
  return [...new Set(nodes.map((node) => node.id))];
}

export function buildLearningStages(graph: LearningGraph, entryNodeId?: string): LearningStage[] {
  if (graph.nodes.length === 0) return [];
  const entry = graph.nodes.find((node) => node.id === entryNodeId) ?? graph.nodes[0];
  const used = new Set<string>([entry.id]);
  const stages: LearningStage[] = [{
    id: "overview", kind: "overview", title: "기능 개요",
    description: "이 기능을 대표하는 코드와 직접 연결된 관계부터 살펴봅니다.", nodeIds: [entry.id],
  }];
  const addStage = (id: string, kind: LearningStage["kind"], title: string, description: string, candidates: LearningNode[]): void => {
    const nodeIds = uniqueNodeIds(candidates.filter((node) => !used.has(node.id)));
    if (nodeIds.length === 0) return;
    nodeIds.forEach((nodeId) => used.add(nodeId));
    stages.push({ id, kind, title, description, nodeIds });
  };
  addStage("ui", "ui", "화면 구성", "페이지와 UI 컴포넌트가 어떻게 연결되는지 확인합니다.",
    graph.nodes.filter((node) => node.category === "start" || node.category === "ui-action"));
  const referenceTargets = new Set(graph.edges.filter((item) => item.relation === "reference").map((item) => item.target));
  const resultPattern = /(?:result|error|success|fail|complete|save|share|cancel|retry)/i;
  addStage("action", "action", "사용자 동작", "이름 기반 동작 후보와 함수 참조입니다. 참조는 실행을 보장하지 않습니다.",
    graph.nodes.filter((node) => !resultPattern.test(node.technicalName ?? "")
      && (referenceTargets.has(node.id) || /^(?:handle|on)[A-Z]/.test(node.technicalName ?? ""))));
  addStage("data", "data", "데이터 처리", "함수 호출, 서비스 및 API 관계를 확인합니다.",
    graph.nodes.filter((node) => !resultPattern.test(node.technicalName ?? "")
      && (node.category === "service" || node.category === "api" || node.category === "database" || node.category === "logic")));
  addStage("result", "result", "결과 및 오류 처리", "이름으로 추정한 결과·오류 관련 후보입니다. 실제 동작은 코드에서 확인하세요.",
    graph.nodes.filter((node) => resultPattern.test(node.technicalName ?? "")));
  return stages;
}

export function selectLearningStageGraph(graph: LearningGraph, stage: LearningStage, expanded = false, maxDepth = 2): LearningGraph {
  if (expanded) return traverseLearningGraph(graph, stage.nodeIds[0], maxDepth, 12);
  const nodes = uniqueGraphNodes(graph.nodes);
  const ids = new Set(nodes.map((node) => node.id));
  const edges = aggregateRelationEdges(graph.edges.filter((edge) => edge.relation !== "import" && ids.has(edge.source) && ids.has(edge.target)));
  const selected = new Set([...new Set(stage.nodeIds.filter((id) => ids.has(id)))].slice(0, 4));
  for (const item of edges) {
    if (selected.size >= 4) break;
    if (selected.has(item.source) && !selected.has(item.target)) selected.add(item.target);
    else if (selected.has(item.target) && !selected.has(item.source)) selected.add(item.source);
  }
  return {
    nodes: nodes.filter((node) => selected.has(node.id)),
    edges: edges.filter((item) => selected.has(item.source) && selected.has(item.target)),
  };
}

export function traverseLearningGraph(graph: LearningGraph, startId: string, maxDepth: number, maxNodes = Number.POSITIVE_INFINITY): LearningGraph {
  const nodes = uniqueGraphNodes(graph.nodes);
  // Stage inspection intentionally includes callers as well as callees within its input scope.
  const reachable = depthFirstReachability(startId, nodes.map((node) => node.id), graph.edges, maxDepth, true);
  const selected = selectConnectedNodeIds(startId, reachable, maxNodes);
  return {
    nodes: nodes.filter((node) => selected.has(node.id)),
    edges: aggregateRelationEdges(reachable.edges.filter((edge) => selected.has(edge.source) && selected.has(edge.target))),
  };
}
