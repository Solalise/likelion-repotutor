import { describe, expect, it } from "vitest";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import type { RepositoryAnalysis, RepositoryFeature, SourceInput } from "@/types/analysis";
import { discoverRepositoryFeatures, repositoryFeatureEdges, traverseRepositoryFeature } from "./featureDiscovery";
import { buildRepositoryLearningGraph } from "@/lib/learning/learningGraphBuilder";
import { buildLearningContext } from "@/lib/ai/learningContext";
import { buildLearningPrompt } from "@/lib/ai/learningExplanation";

const features = (analysis: RepositoryAnalysis) => {
  const result = discoverRepositoryFeatures(analysis);
  return [...result.primary, ...result.limited];
};
const page = (path: string, content = "export default function Page() { return <div/>; }"): SourceInput => ({ path, content });
function find(analysis: RepositoryAnalysis, path: string, method?: string): RepositoryFeature {
  const matches = features(analysis).filter((feature) => feature.routePath === path && feature.httpMethod === method);
  expect(matches).toHaveLength(1);
  return matches[0];
}

describe("file-route entry discovery", () => {
  it("keeps same-name Page functions at login/signup/settings as independent features", () => {
    const analysis = analyzeSourceFiles([page("app/login/page.tsx"), page("app/signup/page.tsx"), page("app/settings/page.tsx")]);
    const found = features(analysis);
    expect(found).toHaveLength(3);
    expect(new Set(found.map((feature) => feature.id)).size).toBe(3);
    expect(new Set(found.map((feature) => feature.entryNodeId)).size).toBe(3);
    expect(found.map((feature) => feature.title).sort()).toEqual(["로그인 페이지", "설정 페이지", "회원가입 페이지"]);
    expect(found.every((feature) => feature.titleInferred && feature.description.includes("추정"))).toBe(true);
  });

  it.each([
    ["Settings", "export default function Settings() { return <div/>; }"],
    ["default", "export default function () { return <div/>; }"],
    ["arrow", "export default () => <div/>;"],
    ["expression", "export default function named() { return <div/>; }"],
  ])("finds a page regardless of its %s function name", (_name, content) => {
    const analysis = analyzeSourceFiles([page("src/app/settings/page.tsx", content)]);
    const feature = find(analysis, "/settings");
    expect(feature.entryKind).toBe("page");
    const node = analysis.nodes.find((item) => item.id === feature.entryNodeId)!;
    expect(node.sourceCode).toContain("<div/>");
    const graph = buildRepositoryLearningGraph({ ...analysis, edges: repositoryFeatureEdges(analysis, feature) }, feature.nodeIds);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].codeSnippet).toBe(node.sourceCode);
    if (node.type !== "component") expect(graph.nodes[0].category).toBe("start");
  });

  it("preserves nested, dynamic and catch-all route paths", () => {
    const paths = ["app/users/page.tsx", "app/users/[id]/page.tsx", "app/users/[id]/settings/page.tsx", "app/docs/[...slug]/page.tsx", "app/help/[[...slug]]/page.tsx"];
    const analysis = analyzeSourceFiles(paths.map((path) => page(path)));
    expect(features(analysis).map((feature) => feature.routePath).sort()).toEqual(["/docs/[...slug]", "/help/[[...slug]]", "/users", "/users/[id]", "/users/[id]/settings"]);
  });

  it("keeps GET and POST at one route file separate without guessing private handlers", () => {
    const analysis = analyzeSourceFiles([{ path: "src/app/api/users/route.ts", content: "export function GET() {} export function POST() {} function DELETE() {}" }]);
    const get = find(analysis, "/api/users", "GET"), post = find(analysis, "/api/users", "POST");
    expect(get.id).not.toBe(post.id);
    expect(get.entryNodeId).not.toBe(post.entryNodeId);
    expect(features(analysis)).toHaveLength(2);
    expect(post.title).toContain("사용자 생성 API");
    expect(post.titleInferred).toBe(true);
    expect(post.description).toContain("실제 업무 의미를 확정하지 않습니다");
    expect(buildLearningContext(analysis, { type: "feature", feature: post }).selection.name).toContain("추정 이름");
  });

  it("separates routes and methods even when they re-export the exact same function", () => {
    const analysis = analyzeSourceFiles([
      { path: "app/login/page.tsx", content: "export { Shared as default } from '../../shared';" },
      { path: "app/signup/page.tsx", content: "export { Shared as default } from '../../shared';" },
      { path: "app/api/users/route.ts", content: "export { handle as GET, handle as POST } from '../../../shared';" },
      { path: "shared.tsx", content: "export function Shared() { return <div/>; } export function handle() { return true; }" },
    ]);
    const found = features(analysis);
    expect(found).toHaveLength(4);
    expect(new Set(found.map((feature) => feature.id)).size).toBe(4);
    expect(find(analysis, "/login").entryNodeId).toBe(find(analysis, "/signup").entryNodeId);
    expect(find(analysis, "/api/users", "GET").entryNodeId).toBe(find(analysis, "/api/users", "POST").entryNodeId);
  });

  it("uses app and route file identity instead of grouping identical paths across applications", () => {
    const analysis = analyzeSourceFiles([page("apps/admin/app/settings/page.tsx"), page("apps/store/src/app/settings/page.tsx")]);
    expect(features(analysis)).toHaveLength(2);
    expect(new Set(features(analysis).map((feature) => feature.id)).size).toBe(2);
  });

  it("does not promote non-routes, named-only page exports or reserved app files", () => {
    const analysis = analyzeSourceFiles([
      page("src/components/Page.tsx"), page("src/screens/SettingsScreen.tsx"),
      page("app/settings/layout.tsx"), page("app/settings/loading.tsx"),
      page("app/_private/page.tsx"), page("app/@modal/page.tsx"), page("app/(.)settings/page.tsx"),
      page("app/settings/page.tsx", "export function Settings() { return <div/>; }"),
      page("src/utils/index.tsx"),
    ]);
    expect(features(analysis)).toEqual([]);
  });

  it("does not treat type-only re-exports as route entrypoints", () => {
    const analysis = analyzeSourceFiles([
      { path: "app/settings/page.tsx", content: "export type { Shared as default } from '../../shared';" },
      { path: "app/api/users/route.ts", content: "export type { handle as GET } from '../../../shared';" },
      { path: "shared.tsx", content: "export function Shared() { return <div/>; } export function handle() {}" },
    ]);
    expect(features(analysis)).toEqual([]);
  });

  it("omits route groups from paths without merging distinct file candidates", () => {
    const analysis = analyzeSourceFiles([page("app/(public)/login/page.tsx"), page("app/(private)/login/page.tsx")]);
    expect(features(analysis)).toHaveLength(2);
    expect(features(analysis).map((feature) => feature.routePath)).toEqual(["/login", "/login"]);
    expect(new Set(features(analysis).map((feature) => feature.id)).size).toBe(2);
  });

  it("uses root app before src/app and does not turn Next app/index helpers into pages", () => {
    const analysis = analyzeSourceFiles([page("app/settings/page.tsx"), page("src/app/settings/page.tsx"), page("app/utils/index.tsx")]);
    expect(features(analysis)).toHaveLength(1);
    expect(features(analysis)[0].entryFilePath).toBe("app/settings/page.tsx");
  });

  it("keeps route feature IDs stable when declarations move within the same file", () => {
    const before = analyzeSourceFiles([page("app/settings/page.tsx")]);
    const after = analyzeSourceFiles([page("app/settings/page.tsx", "\n\nexport default function Renamed() { return <div/>; }")]);
    expect(features(before)[0].id).toBe(features(after)[0].id);
    expect(features(before)[0].entryNodeId).not.toBe(features(after)[0].entryNodeId);
  });
});

describe("directional feature boundaries", () => {
  const sharedInputs: SourceInput[] = [
    page("app/login/page.tsx", "import { shared } from '../../lib/shared'; export default function Page() { shared(); return <div/>; }"),
    page("app/signup/page.tsx", "import { shared } from '../../lib/shared'; export default function Page() { shared(); return <div/>; }"),
    { path: "lib/shared.ts", content: "export function shared() { return helper(); } function helper() { return true; }" },
  ];

  it("includes a shared utility in both features without following its incoming callers", () => {
    const analysis = analyzeSourceFiles(sharedInputs);
    const login = find(analysis, "/login"), signup = find(analysis, "/signup");
    expect(login.nodeIds).not.toContain(signup.entryNodeId);
    expect(signup.nodeIds).not.toContain(login.entryNodeId);
    expect(login.nodeIds.filter((id) => signup.nodeIds.includes(id))).toHaveLength(2);
    expect(traverseRepositoryFeature(analysis, login, 5).nodes.map((node) => node.name)).toEqual(["Page", "shared", "helper"]);
  });

  it("stops at other page entrypoints even if imported as a component", () => {
    const analysis = analyzeSourceFiles([
      page("app/login/page.tsx", "import Signup from '../signup/page'; export default function Login() { return <Signup/>; }"),
      page("app/signup/page.tsx", "export default function Signup() { return <div/>; }"),
    ]);
    expect(find(analysis, "/login").nodeIds).toEqual([find(analysis, "/login").entryNodeId]);
  });

  it("retains callback references and their conditional code without inventing a direct execution edge", () => {
    const analysis = analyzeSourceFiles([
      page("app/settings/page.tsx", "export default function Settings() { external(() => work()); return <div/>; } function work() {}"),
    ]);
    const feature = find(analysis, "/settings");
    const root = feature.entryNodeId;
    const work = analysis.nodes.find((node) => node.name === "work")!;
    const edges = repositoryFeatureEdges(analysis, feature);
    expect(edges.map((edge) => edge.relation)).toEqual(["reference", "call"]);
    expect(edges.some((edge) => edge.source === root && edge.target === work.id)).toBe(false);
    expect(feature.description).toContain("실행을 뜻하지 않으며");
    expect(edges.every((edge) => edge.confidence === "confirmed")).toBe(true);
  });

  it("does not expand imports or unresolved calls into a feature", () => {
    const analysis = analyzeSourceFiles([
      page("app/settings/page.tsx", "import { unused } from '../../lib/shared'; export default function Settings() { unknown(); return <div/>; }"),
      { path: "lib/shared.ts", content: "export function unused() {}" },
    ]);
    expect(find(analysis, "/settings").nodeIds).toEqual([find(analysis, "/settings").entryNodeId]);
    expect(repositoryFeatureEdges(analysis, find(analysis, "/settings"))).toEqual([]);
  });

  it("does not use inferred relations to expand membership, or upgrade their confidence", () => {
    const analysis = analyzeSourceFiles(sharedInputs);
    const loginRoot = analysis.nodes.find((node) => node.filePath === "app/login/page.tsx" && node.name === "Page")!;
    const call = analysis.edges.find((edge) => edge.source === loginRoot.id && edge.relation === "call")!;
    call.confidence = "inferred";
    expect(find(analysis, "/login").nodeIds).toEqual([loginRoot.id]);
    expect(call.confidence).toBe("inferred");
  });

  it("preserves inferred edges between independently confirmed members in every projection", () => {
    const analysis = analyzeSourceFiles([page("app/settings/page.tsx", "export default function Settings() { a(); b(); return <div/>; }\nfunction a() { b(); }\nfunction b() {}")]);
    const a = analysis.nodes.find((node) => node.name === "a")!, b = analysis.nodes.find((node) => node.name === "b")!;
    const relation = analysis.edges.find((edge) => edge.source === a.id && edge.target === b.id)!;
    relation.confidence = "inferred";
    const feature = find(analysis, "/settings");
    expect(repositoryFeatureEdges(analysis, feature)).toContain(relation);
    expect(traverseRepositoryFeature(analysis, feature, 5).edges).toContainEqual(expect.objectContaining({ source: a.id, target: b.id, confidence: "inferred" }));
    const graph = buildRepositoryLearningGraph({ ...analysis, edges: repositoryFeatureEdges(analysis, feature) }, feature.nodeIds);
    expect(graph.edges).toContainEqual(expect.objectContaining({ confidence: "inferred", label: "함수 호출 · 추정" }));
    const context = buildLearningContext(analysis, { type: "feature", feature });
    expect(context.code.find((item) => item.functionId === a.id)?.relations).toContainEqual(expect.objectContaining({ otherFunctionId: b.id, confidence: "inferred" }));
  });

  it("uses API endpoints as explicit boundaries and shares those boundaries with learning and AI", () => {
    const analysis = analyzeSourceFiles([
      page("app/users/page.tsx", "import { local } from '../../lib/work'; export default function Users() { local(); fetch('/api/users'); return <div/>; }"),
      { path: "app/api/users/route.ts", content: "import { local } from '../../../lib/work'; export function GET() { return local(); } export function POST() { return local(); }" },
      { path: "lib/work.ts", content: "export function local() { return true; }" },
    ]);
    const pageFeature = find(analysis, "/users"), get = find(analysis, "/api/users", "GET"), post = find(analysis, "/api/users", "POST");
    expect(pageFeature.nodeIds).toContain(get.entryNodeId);
    expect(pageFeature.nodeIds).not.toContain(post.entryNodeId);
    const edges = repositoryFeatureEdges(analysis, pageFeature);
    expect(edges.some((edge) => edge.source === get.entryNodeId)).toBe(false);
    expect(repositoryFeatureEdges(analysis, get).some((edge) => edge.source === get.entryNodeId)).toBe(true);
    const graph = buildRepositoryLearningGraph({ ...analysis, edges }, pageFeature.nodeIds);
    expect(graph.edges.map((edge) => edge.id)).toEqual(edges.map((edge) => `learning:${edge.id}`));
    const context = buildLearningContext(analysis, { type: "feature", feature: pageFeature });
    expect(context.selection.id).toBe(pageFeature.id);
    expect(context.code.find((code) => code.functionId === get.entryNodeId)?.relations.some((relation) => relation.direction === "outgoing")).toBe(false);
    expect(buildLearningPrompt(context)).not.toContain(post.entryNodeId);
  });

  it("keeps bounded DFS and node expansion inside the selected feature", () => {
    const analysis = analyzeSourceFiles(sharedInputs);
    const login = find(analysis, "/login"), signup = find(analysis, "/signup");
    const shallow = traverseRepositoryFeature(analysis, login, 1);
    expect(shallow.nodes).toHaveLength(2);
    const graph = traverseRepositoryFeature(analysis, login, 5, shallow.nodes.map((node) => node.id));
    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes.map((node) => node.id)).not.toContain(signup.entryNodeId);
    const context = buildLearningContext(analysis, { type: "feature", feature: login });
    expect(context.code.map((code) => code.filePath)).not.toContain("app/signup/page.tsx");
  });
});
