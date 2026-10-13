import { describe, expect, it } from "vitest";
import type { RepositoryAnalysis } from "@/types/analysis";
import { buildLearningGraph, buildLearningStages, buildRepositoryLearningGraph, selectLearningStageGraph, traverseLearningGraph } from "./learningGraphBuilder";
import { generateLearningLabel } from "./labelGenerator";

const codeNode = (name: string, type: "component" | "function" | "api", filePath: string) => ({
  id: `symbol:${filePath}#${name}`,
  type,
  name,
  filePath,
  line: 1,
} as const);

const analysis: RepositoryAnalysis = {
  repository: "sample-repository",
  files: [],
  nodes: [
    codeNode("LoginPage", "component", "app/login/page.tsx"),
    codeNode("handleLogin", "function", "app/login/page.tsx"),
    codeNode("login", "function", "services/auth.ts"),
    codeNode("POST", "api", "app/api/auth/route.ts"),
    codeNode("findUser", "function", "repositories/userRepository.ts"),
  ],
  edges: [],
  stats: { files: 4, functions: 5, relations: 5 },
};

describe("buildLearningGraph", () => {
  it("keeps AST-backed steps separate from demo learning steps", () => {
    const graph = buildLearningGraph(analysis);
    expect(graph.nodes).toHaveLength(8);
    expect(graph.nodes.find((node) => node.technicalName === "handleLogin")?.title).toBe("로그인 버튼 클릭");
    expect(graph.nodes.find((node) => node.title === "사용자가 존재하는가?")?.source).toBe("demo");
    expect(graph.edges.find((edge) => edge.label === "API 요청")?.relation).toBe("request");
  });

  it("applies depth-limited traversal to the learning graph", () => {
    const graph = buildLearningGraph(analysis);
    const focused = traverseLearningGraph(graph, graph.nodes[0].id, 2);
    expect(focused.nodes.map((node) => node.title)).toEqual(["로그인 시작", "로그인 버튼 클릭", "로그인 요청 처리"]);
  });

  it("builds a Korean learning graph from confirmed GitHub AST relations", () => {
    const route = codeNode("DocumentScanRoute", "component", "apps/mobile/app/case/document-scan/index.tsx");
    const screen = codeNode("DocumentScanScreen", "component", "apps/mobile/src/features/document-scan/screens/DocumentScanScreen.tsx");
    const handler = codeNode("handleStartScan", "function", screen.filePath);
    const service = codeNode("startDocumentScan", "function", "apps/mobile/src/features/document-scan/services/documentScan.ts");
    const police = codeNode("PoliceReportScreen", "component", "apps/mobile/src/features/police-report/screens/PoliceReportScreen.tsx");
    const githubAnalysis: RepositoryAnalysis = {
      repository: "team-mallang/likelion-hackathon",
      source: "github",
      files: [],
      nodes: [route, screen, handler, service, police],
      edges: [
        { id: "route-screen", source: route.id, target: screen.id, relation: "component" },
        { id: "screen-handler", source: screen.id, target: handler.id, relation: "call" },
        { id: `import:${screen.filePath}->${service.filePath}`, source: `file:${screen.filePath}`, target: `file:${service.filePath}`, relation: "import" },
      ],
      stats: { files: 4, functions: 5, relations: 3 },
    };
    const graph = buildRepositoryLearningGraph(githubAnalysis, [route.id, screen.id, handler.id, service.id]);
    expect(graph.nodes.find((node) => node.technicalName === "DocumentScanScreen")).toMatchObject({
      title: "문서 스캔 화면",
      confidence: "confirmed",
    });
    expect(graph.nodes.some((node) => node.technicalName === "PoliceReportScreen")).toBe(false);
    expect(graph.edges.map((item) => item.relation)).toEqual(expect.arrayContaining(["component", "call", "import"]));
    expect(graph.edges).toHaveLength(3);
  });

  it("limits the initial GitHub learning graph and expands with depth", () => {
    const nodes = Array.from({ length: 9 }, (_, index) => codeNode(`step${index}`, "function", `src/step${index}.ts`));
    const graph = {
      nodes: nodes.map((node) => ({
        id: node.id, technicalName: node.name, title: node.name, description: "", purpose: "", category: "logic" as const,
        filePath: node.filePath, relatedFiles: [], connectionReason: "AST 함수 호출", incomingRelations: [], outgoingRelations: [], confidence: "confirmed" as const, source: "ast" as const,
      })),
      edges: nodes.slice(1).map((node, index) => ({
        id: `edge-${index}`, source: nodes[index].id, target: node.id, relation: "call" as const, label: "함수 호출",
      })),
    };
    expect(traverseLearningGraph(graph, nodes[0].id, 8, 5).nodes).toHaveLength(5);
    expect(traverseLearningGraph(graph, nodes[0].id, 8, 8).nodes).toHaveLength(8);
  });

  it("creates distinct general Korean labels from handler identifiers", () => {
    const handler = (name: string) => generateLearningLabel(codeNode(name, "function", "src/features/report/ReportScreen.tsx"));
    expect(handler("handleRequestRegenerate").title).toBe("다시 생성 요청");
    expect(handler("handleEditValueChange").title).toBe("수정한 내용 반영");
    expect(handler("handleCancelEdit").title).toBe("수정 취소");
    expect(handler("handleSaveEdit").title).toBe("수정 내용 저장");
    expect(handler("handleSaveOrShare").title).toBe("저장 또는 공유 처리");
    expect(handler("handleUnrecognizedDomainAction").title).toContain("handleUnrecognizedDomainAction");
  });

  it("creates only stages supported by nodes and keeps the focused graph small", () => {
    const route = codeNode("ReportRoute", "component", "app/report/index.tsx");
    const screen = codeNode("PoliceReportScreen", "component", "src/features/police-report/screens/PoliceReportScreen.tsx");
    const action = codeNode("handleSubmit", "function", screen.filePath);
    const service = codeNode("submitReport", "function", "src/features/police-report/services/report.ts");
    const graph = buildRepositoryLearningGraph({
      repository: "test", source: "github", files: [], nodes: [route, screen, action, service],
      edges: [
        { id: "component", source: route.id, target: screen.id, relation: "component" },
        { id: "reference", source: screen.id, target: action.id, relation: "reference" },
        { id: "call", source: action.id, target: service.id, relation: "call" },
      ],
      stats: { files: 3, functions: 4, relations: 3 },
    });
    const stages = buildLearningStages(graph, route.id);
    expect(stages.map((stage) => stage.title)).toEqual(["기능 개요", "화면 구성", "사용자 동작", "데이터 처리"]);
    expect(selectLearningStageGraph(graph, stages[1]).nodes.length).toBeLessThanOrEqual(4);
  });
});
