import type { CodeNode, RepositoryAnalysis } from "@/types/analysis";
import type { LearningEdge, LearningGraph, LearningNode, LearningStage } from "@/types/learning";
import { generateLearningLabel } from "./labelGenerator";

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

function fromCodeNode(node: CodeNode): LearningNode {
  const label = generateLearningLabel(node);
  const details = DEMO_DETAILS[node.name] ?? { relatedFiles: [] };
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
    connectionReason: "AST에서 다른 코드와의 관계를 확인했습니다.",
    incomingRelations: [],
    outgoingRelations: [],
    confidence: "confirmed",
    source: "ast",
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

  const start = fromCodeNode(loginPage);
  const conditionId = "learning:condition:user-exists";
  const failureId = "learning:end:login-failure";
  const successId = "learning:end:login-success";
  const nodes: LearningNode[] = [
    start,
    fromCodeNode(handleLogin),
    fromCodeNode(login),
    fromCodeNode(api),
    fromCodeNode(findUser),
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
  const demoGraph = analysis.source !== "github" ? buildDemoLoginGraph(analysis) : undefined;
  if (demoGraph) return demoGraph;

  return buildRepositoryLearningGraph(analysis);
}

function relationLabel(relation: LearningEdge["relation"]): string {
  if (relation === "component") return "컴포넌트 표시";
  if (relation === "reference") return "콜백 연결";
  if (relation === "import") return "파일 불러오기";
  if (relation === "request") return "API 요청";
  return "함수 호출";
}

export function buildRepositoryLearningGraph(
  analysis: RepositoryAnalysis,
  selectedNodeIds?: Iterable<string>,
): LearningGraph {
  const allowed = selectedNodeIds ? new Set(selectedNodeIds) : undefined;
  const codeNodes = analysis.nodes.filter((node) => node.type !== "file" && (!allowed || allowed.has(node.id)));
  const codeNodeMap = new Map(codeNodes.map((node) => [node.id, node]));
  const directEdges: LearningEdge[] = analysis.edges.flatMap((item) => {
    const source = codeNodeMap.get(item.source);
    const target = codeNodeMap.get(item.target);
    if (!source || !target || item.relation === "import") return [];
    const relation: LearningEdge["relation"] = item.relation === "api" ? "request"
      : item.relation === "component" ? "component"
        : item.relation === "reference" ? "reference" : "call";
    return [{ id: `learning:${item.id}`, source: item.source, target: item.target, relation, label: relationLabel(relation) }];
  });

  const representativeByFile = new Map<string, CodeNode>();
  for (const node of [...codeNodes].sort((a, b) => Number(b.type === "component") - Number(a.type === "component") || a.line! - b.line!)) {
    if (!representativeByFile.has(node.filePath)) representativeByFile.set(node.filePath, node);
  }
  const directPairs = new Set(directEdges.map((item) => `${item.source}->${item.target}`));
  const importEdges: LearningEdge[] = analysis.edges.flatMap((item) => {
    if (item.relation !== "import" || !item.source.startsWith("file:") || !item.target.startsWith("file:")) return [];
    const source = representativeByFile.get(item.source.slice(5));
    const target = representativeByFile.get(item.target.slice(5));
    if (!source || !target || source.id === target.id || directPairs.has(`${source.id}->${target.id}`)) return [];
    return [{
      id: `learning:${item.id}:${source.id}->${target.id}`,
      source: source.id,
      target: target.id,
      relation: "import" as const,
      label: relationLabel("import"),
    }];
  });
  const edges = [...directEdges, ...importEdges];
  const nodes = codeNodes.map((node) => {
    const related = edges.filter((item) => item.source === node.id || item.target === node.id);
    const relatedNodeIds = new Set(related.flatMap((item) => [item.source, item.target]).filter((id) => id !== node.id));
    const relatedFiles = [...relatedNodeIds].flatMap((id) => codeNodeMap.has(id) ? [codeNodeMap.get(id)!.filePath] : []);
    const relationNames = [...new Set(related.map((item) => relationLabel(item.relation)))];
    const incomingRelations = edges.filter((item) => item.target === node.id).flatMap((item) => {
      const source = codeNodeMap.get(item.source);
      return source ? [`${source.name}에서 ${relationLabel(item.relation)} 관계로 이 코드에 연결됩니다.`] : [];
    });
    const outgoingRelations = edges.filter((item) => item.source === node.id).flatMap((item) => {
      const target = codeNodeMap.get(item.target);
      return target ? [`이 코드가 ${target.name}에 ${relationLabel(item.relation)} 관계로 연결됩니다.`] : [];
    });
    const base = fromCodeNode(node);
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
        ? `${[...new Set(incomingNames)].slice(0, 3).join(", ")} 코드가 이 코드를 참조하거나 호출하므로 현재 기능의 연결 지점으로 필요합니다.`
        : base.purpose,
      relatedFiles: [...new Set(relatedFiles)],
      connectionReason: relationNames.length > 0
        ? [...incomingRelations, ...outgoingRelations].slice(0, 3).join(" ")
        : "정적 분석에서 이 코드와 직접 연결된 관계를 찾지 못했습니다.",
      incomingRelations,
      outgoingRelations,
      confidence: relationNames.length > 0 ? "confirmed" as const : "limited" as const,
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
    actions.length > 0 ? `${actions.map((node) => node.technicalName).join(", ")} 사용자 동작 코드` : undefined,
    services.length > 0 ? `${services.map((node) => node.technicalName).join(", ")} 서비스·API 코드` : undefined,
  ].filter(Boolean);
  return parts.length > 0
    ? `${featureTitle} 기능에서 AST로 확인된 ${parts.join("와 ")}를 단계별로 살펴봅니다.`
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
  addStage("action", "action", "사용자 동작", "이벤트 핸들러와 콜백으로 확인된 사용자 동작을 살펴봅니다.",
    graph.nodes.filter((node) => !resultPattern.test(node.technicalName ?? "")
      && (referenceTargets.has(node.id) || /^(?:handle|on)[A-Z]/.test(node.technicalName ?? ""))));
  addStage("data", "data", "데이터 처리", "함수 호출, 서비스, API 및 파일 의존 관계를 확인합니다.",
    graph.nodes.filter((node) => !resultPattern.test(node.technicalName ?? "")
      && (node.category === "service" || node.category === "api" || node.category === "database" || node.category === "logic")));
  addStage("result", "result", "결과 및 오류 처리", "이름과 AST 관계로 확인 가능한 결과·완료·오류 처리 코드를 살펴봅니다.",
    graph.nodes.filter((node) => resultPattern.test(node.technicalName ?? "")));
  return stages;
}

export function selectLearningStageGraph(graph: LearningGraph, stage: LearningStage, expanded = false, maxDepth = 2): LearningGraph {
  if (expanded) return traverseLearningGraph(graph, stage.nodeIds[0], maxDepth, 12);
  const selected = new Set(stage.nodeIds.slice(0, 4));
  for (const item of graph.edges) {
    if (selected.size >= 4) break;
    if (selected.has(item.source) && !selected.has(item.target)) selected.add(item.target);
    else if (selected.has(item.target) && !selected.has(item.source)) selected.add(item.source);
  }
  return {
    nodes: graph.nodes.filter((node) => selected.has(node.id)),
    edges: graph.edges.filter((item) => selected.has(item.source) && selected.has(item.target)),
  };
}

export function traverseLearningGraph(graph: LearningGraph, startId: string, maxDepth: number, maxNodes = Number.POSITIVE_INFINITY): LearningGraph {
  if (maxDepth < 0 || !graph.nodes.some((node) => node.id === startId)) return { nodes: [], edges: [] };
  const visited = new Set<string>();
  const selectedEdges = new Map<string, LearningEdge>();
  const adjacency = new Map<string, LearningEdge[]>();
  for (const item of graph.edges) {
    adjacency.set(item.source, [...(adjacency.get(item.source) ?? []), item]);
    adjacency.set(item.target, [...(adjacency.get(item.target) ?? []), item]);
  }

  function dfs(nodeId: string, depth: number): void {
    if (visited.has(nodeId) || depth > maxDepth || visited.size >= maxNodes) return;
    visited.add(nodeId);
    if (depth === maxDepth) return;
    for (const item of adjacency.get(nodeId) ?? []) {
      const nextId = item.source === nodeId ? item.target : item.source;
      if (!graph.nodes.some((node) => node.id === nextId)) continue;
      if (!visited.has(nextId) && visited.size < maxNodes) {
        selectedEdges.set(item.id, item);
        dfs(nextId, depth + 1);
      }
    }
  }
  dfs(startId, 0);
  return {
    nodes: graph.nodes.filter((node) => visited.has(node.id)),
    edges: [...selectedEdges.values()].filter((item) => visited.has(item.source) && visited.has(item.target)),
  };
}
