import { describe, expect, it } from "vitest";
import type { RepositoryAnalysis } from "@/types/analysis";
import { buildRepositoryOverview, findOverviewFeature } from "./repositoryOverview";

const searchFile = "src/features/search/SearchScreen.tsx";
const serviceFile = "src/features/search/services/search.ts";
const buttonFile = "src/components/Button.tsx";
const analysis: RepositoryAnalysis = {
  repository: "acme/project",
  source: "github",
  files: [searchFile, serviceFile, buttonFile].map((filePath) => ({
    path: filePath, name: filePath.split("/").at(-1)!, sourceCode: `// ${filePath}`, imports: [], functions: [],
  })),
  nodes: [
    { id: `file:${searchFile}`, type: "file", name: "SearchScreen.tsx", filePath: searchFile, sourceCode: "screen" },
    { id: `file:${serviceFile}`, type: "file", name: "search.ts", filePath: serviceFile, sourceCode: "service" },
    { id: `file:${buttonFile}`, type: "file", name: "Button.tsx", filePath: buttonFile, sourceCode: "button" },
    { id: `symbol:${searchFile}#SearchScreen`, type: "component", name: "SearchScreen", filePath: searchFile, line: 1, sourceCode: "function SearchScreen() {}" },
    { id: `symbol:${serviceFile}#search`, type: "function", name: "search", filePath: serviceFile, line: 1, sourceCode: "function search() {}" },
    { id: `symbol:${buttonFile}#Button`, type: "component", name: "Button", filePath: buttonFile, line: 1, sourceCode: "function Button() {}" },
  ],
  edges: [
    { id: "screen-search", source: `symbol:${searchFile}#SearchScreen`, target: `symbol:${serviceFile}#search`, relation: "call" },
    { id: "screen-button", source: `symbol:${searchFile}#SearchScreen`, target: `symbol:${buttonFile}#Button`, relation: "component" },
    { id: "import-button", source: `file:${searchFile}`, target: `file:${buttonFile}`, relation: "import" },
  ],
  stats: { files: 3, functions: 3, relations: 3 },
};

describe("buildRepositoryOverview", () => {
  it("starts with project and module summaries instead of every file and function", () => {
    const graph = buildRepositoryOverview(analysis);
    expect(graph.nodes.filter((node) => node.type === "project")).toHaveLength(1);
    expect(graph.nodes.filter((node) => node.type === "module")).toHaveLength(2);
    expect(graph.nodes.some((node) => node.type === "file" || node.type === "symbol")).toBe(false);
    expect(graph.edges.some((edge) => edge.relation === "contains")).toBe(true);
    expect(graph.edges.some((edge) => edge.relation === "component" || edge.relation === "import")).toBe(true);
  });

  it("expands module to files and file to its real symbols", () => {
    const moduleId = "overview:module:src/features/search";
    const fileId = `overview:file:${searchFile}`;
    const graph = buildRepositoryOverview(analysis, new Set([moduleId, fileId]));
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: fileId, type: "file", codeNodeId: `file:${searchFile}` }),
      expect.objectContaining({ type: "symbol", codeNodeId: `symbol:${searchFile}#SearchScreen` }),
    ]));
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: moduleId, target: fileId, relation: "contains" }),
      expect.objectContaining({ source: fileId, relation: "contains" }),
    ]));
  });

  it("opens a feature only when the overview selection maps unambiguously", () => {
    const moduleNode = buildRepositoryOverview(analysis).nodes.find((node) => node.id === "overview:module:src/features/search")!;
    const feature = {
      id: "feature:search", title: "검색", technicalName: "SearchScreen", description: "", entryNodeId: `symbol:${searchFile}#SearchScreen`,
      entryFilePath: searchFile, nodeIds: [], filePaths: [searchFile, serviceFile], connectedNodeCount: 2, connectionCount: 1,
      limited: false, hidden: false, score: 10,
    };
    expect(findOverviewFeature(moduleNode, [feature])).toBe(feature);
    expect(findOverviewFeature(moduleNode, [feature, { ...feature, id: "feature:duplicate" }])).toBeUndefined();
  });

  it("keeps large overview rendering bounded", () => {
    const files = Array.from({ length: 40 }, (_, index) => ({
      path: `packages/package-${index}/src/index.ts`, name: "index.ts", sourceCode: "export const value = 1;", imports: [], functions: [],
    }));
    const large: RepositoryAnalysis = {
      repository: "large/repository", source: "github", files,
      nodes: files.flatMap((file, fileIndex) => [
        { id: `file:${file.path}`, type: "file" as const, name: file.name, filePath: file.path, sourceCode: file.sourceCode },
        ...Array.from({ length: 30 }, (_, symbolIndex) => ({
          id: `symbol:${file.path}#fn${symbolIndex}`, type: "function" as const, name: `fn${symbolIndex}`, filePath: file.path,
          line: symbolIndex + 1, sourceCode: `function fn${symbolIndex}() { return ${fileIndex}; }`,
        })),
      ]),
      edges: [], stats: { files: 40, functions: 1200, relations: 0 },
    };
    const initial = buildRepositoryOverview(large);
    expect(initial.nodes.length).toBeLessThanOrEqual(25);
    const firstModule = initial.nodes.find((node) => node.type === "module")!;
    const expandedModule = buildRepositoryOverview(large, new Set([firstModule.id]));
    const firstFile = expandedModule.nodes.find((node) => node.type === "file")!;
    const expandedFile = buildRepositoryOverview(large, new Set([firstModule.id, firstFile.id]));
    expect(expandedFile.nodes.length).toBeLessThanOrEqual(61);
    expect(expandedFile.edges.length).toBeLessThanOrEqual(120);
  });
});
