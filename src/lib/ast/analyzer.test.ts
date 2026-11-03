import { describe, expect, it } from "vitest";
import { traceDisplayGraph, traverseGraph } from "@/lib/graph/dfs";
import { analyzeSourceFiles } from "./analyzer";

const sources = [
  { path: "app/login/page.tsx", content: `import { login } from "../../services/auth";
    export default function LoginPage() { const handleLogin = async () => login(); return <button onClick={handleLogin}>Login</button>; }` },
  { path: "services/auth.ts", content: `import { findUser } from "../repositories/userRepository";
    export function login() { return findUser(); }` },
  { path: "repositories/userRepository.ts", content: `export function findUser() { return { id: 1 }; }` },
];

describe("analyzeSourceFiles", () => {
  it("extracts files, imports, functions and call edges", () => {
    const result = analyzeSourceFiles(sources);
    expect(result.stats.files).toBe(3);
    expect(result.nodes.some((node) => node.name === "LoginPage" && node.type === "component")).toBe(true);
    expect(result.nodes.some((node) => node.name === "handleLogin" && node.type === "function")).toBe(true);
    expect(result.edges.some((edge) => edge.id.includes("LoginPage") && edge.id.includes("handleLogin"))).toBe(true);
    expect(result.edges.some((edge) => edge.id.includes("handleLogin") && edge.id.includes("login"))).toBe(true);
    expect(result.edges.some((edge) => edge.id.includes("login") && edge.id.includes("findUser"))).toBe(true);
  });

  it("resolves package-local @ aliases and JSX component references", () => {
    const result = analyzeSourceFiles([
      {
        path: "apps/mobile/app/document/index.tsx",
        content: `import { DocumentScreen } from "@/features/document/screens/DocumentScreen";
          export default function DocumentRoute() { return <DocumentScreen />; }`,
      },
      {
        path: "apps/mobile/src/features/document/screens/DocumentScreen.tsx",
        content: `import { Button } from "@/components/common/button";
          export function DocumentScreen() {
            function runScan() { return true; }
            const handleScan = () => runScan();
            const retryScan = useCallback(() => runScan(), []);
            return <Button onPress={handleScan || retryScan} />;
          }`,
      },
      {
        path: "apps/mobile/src/components/common/button.tsx",
        content: "export function Button() { return <button />; }",
      },
    ], "acme/mobile");

    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "symbol:apps/mobile/app/document/index.tsx#DocumentRoute",
        target: "symbol:apps/mobile/src/features/document/screens/DocumentScreen.tsx#DocumentScreen",
        relation: "component",
      }),
      expect.objectContaining({
        source: "symbol:apps/mobile/src/features/document/screens/DocumentScreen.tsx#DocumentScreen",
        target: "symbol:apps/mobile/src/components/common/button.tsx#Button",
        relation: "component",
      }),
    ]));
    expect(result.nodes.map((node) => node.name)).toEqual(expect.arrayContaining(["runScan", "handleScan", "retryScan"]));
    expect(result.edges).toContainEqual(expect.objectContaining({
      source: "symbol:apps/mobile/src/features/document/screens/DocumentScreen.tsx#DocumentScreen",
      target: "symbol:apps/mobile/src/features/document/screens/DocumentScreen.tsx#runScan",
      relation: "reference",
    }));
  });

  it("uses declarations for aliases, re-exports, class/object methods and callbacks", () => {
    const result = analyzeSourceFiles([
      { path: "lib/actions.ts", content: `export function save() { return true; }
        export class Worker { run() { return save(); } }
        export const helpers = { finish: () => save() };` },
      { path: "lib/index.ts", content: `export { save as persist, Worker, helpers } from "./actions";` },
      { path: "app/page.tsx", content: `import { persist as submit, Worker, helpers } from "../lib";
        export function Page() {
          const handleClick = () => submit();
          new Worker().run(); helpers.finish();
          return <button onClick={handleClick}>save</button>;
        }` },
    ]);
    const edgePairs = result.edges.map((edge) => `${edge.relation}:${edge.source}->${edge.target}`);
    expect(edgePairs).toContain("call:symbol:app/page.tsx#handleClick->symbol:lib/actions.ts#save");
    expect(edgePairs).toContain("call:symbol:app/page.tsx#Page->symbol:lib/actions.ts#Worker.run");
    expect(edgePairs).toContain("call:symbol:app/page.tsx#Page->symbol:lib/actions.ts#helpers.finish");
    expect(result.edges).toContainEqual(expect.objectContaining({
      source: "symbol:app/page.tsx#Page", target: "symbol:app/page.tsx#handleClick", relation: "reference", confidence: "confirmed",
    }));
  });

  it("connects static fetch and axios requests to matching Next.js route handlers", () => {
    const result = analyzeSourceFiles([
      { path: "app/users/page.tsx", content: `export function UsersPage() {
        const load = async () => fetch("/api/users/42");
        const remove = () => axios.delete("/api/users/42");
        return <button onClick={load}>load</button>;
      }` },
      { path: "app/api/users/[id]/route.ts", content: `export async function GET() { return Response.json([]); }
        export async function DELETE() { return Response.json({ ok: true }); }` },
    ]);
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "symbol:app/users/page.tsx#load", target: "symbol:app/api/users/[id]/route.ts#GET", relation: "api", evidence: `fetch("/api/users/42")` }),
      expect.objectContaining({ source: "symbol:app/users/page.tsx#remove", target: "symbol:app/api/users/[id]/route.ts#DELETE", relation: "api" }),
    ]));
  });

  it("preserves the sample login direction, evidence and depth without inventing an API match", () => {
    const result = analyzeSourceFiles([
      { path: "app/login/page.tsx", content: `import { login } from "../../services/auth";
        export default function LoginPage() {
          const handleLogin = async () => login({ email: "a", password: "b" });
          return <button onClick={handleLogin}>Login</button>;
        }` },
      { path: "services/auth.ts", content: `export async function login(input: unknown) {
        return fetch("/api/auth/login", { method: "POST", body: JSON.stringify(input) });
      }` },
      { path: "app/api/auth/route.ts", content: `import { findUser } from "../../../repositories/userRepository";
        export async function POST() { return findUser("a"); }` },
      { path: "repositories/userRepository.ts", content: `export function findUser(email: string) { return { email }; }` },
    ]);
    const symbols = new Map(result.nodes.map((node) => [node.name, node.id]));
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: symbols.get("LoginPage"), target: symbols.get("handleLogin"), relation: "reference", evidence: "onClick={handleLogin}" }),
      expect.objectContaining({ source: symbols.get("handleLogin"), target: symbols.get("login"), relation: "call" }),
      expect.objectContaining({ source: symbols.get("POST"), target: symbols.get("findUser"), relation: "call" }),
    ]));
    expect(result.edges).not.toContainEqual(expect.objectContaining({ source: symbols.get("login"), target: symbols.get("POST"), relation: "api" }));
    expect(result.edges.some((edge) => edge.source === edge.target)).toBe(false);

    const depthOne = traverseGraph(symbols.get("LoginPage")!, result.nodes, result.edges, 1);
    const depthTwo = traverseGraph(symbols.get("LoginPage")!, result.nodes, result.edges, 2);
    const full = traverseGraph(symbols.get("LoginPage")!, result.nodes, result.edges, 8);
    expect(depthOne.nodes.map((node) => node.name)).toEqual(["LoginPage", "handleLogin"]);
    expect(depthTwo.nodes.map((node) => node.name)).toEqual(["LoginPage", "handleLogin", "login"]);
    expect(full.nodes.map((node) => node.name)).toEqual(["LoginPage", "handleLogin", "login"]);
    expect(full.edges).toHaveLength(2);
  });

  it("connects PreviousCaseLookupScreen through an imported object method to its API route", () => {
    const result = analyzeSourceFiles([
      { path: "apps/mobile/src/features/case-access/screens/PreviousCaseLookupScreen.tsx", content: `
        import { previousCaseService } from "@/features/case-access/services/previousCase";
        export function PreviousCaseLookupScreen() {
          async function handleSubmit() { return previousCaseService.lookup({ caseNumber: "A" }); }
          return <button onClick={handleSubmit}>lookup</button>;
        }` },
      { path: "apps/mobile/src/features/case-access/services/previousCase.ts", content: `
        function getApiUrl(path: string) { return path; }
        export const previousCaseService = { async lookup(input: unknown) {
          return fetch(getApiUrl("/api/cases/auth"), { method: "POST", body: JSON.stringify(input) });
        } };` },
      { path: "apps/web/src/app/api/cases/auth/route.ts", content: "export async function POST() { return Response.json({ ok: true }); }" },
    ], "team/repository");
    const edgePairs = result.edges.map((edge) => `${edge.relation}:${edge.source}->${edge.target}`);
    expect(result.nodes).toContainEqual(expect.objectContaining({ name: "previousCaseService.lookup", filePath: "apps/mobile/src/features/case-access/services/previousCase.ts" }));
    expect(edgePairs).toContain("call:symbol:apps/mobile/src/features/case-access/screens/PreviousCaseLookupScreen.tsx#handleSubmit->symbol:apps/mobile/src/features/case-access/services/previousCase.ts#previousCaseService.lookup");
    expect(result.edges).toContainEqual(expect.objectContaining({
      source: "symbol:apps/mobile/src/features/case-access/services/previousCase.ts#previousCaseService.lookup",
      target: "symbol:apps/web/src/app/api/cases/auth/route.ts#POST",
      relation: "api",
      evidence: expect.stringContaining("fetch(getApiUrl"),
    }));
    const flow = traceDisplayGraph("symbol:apps/mobile/src/features/case-access/screens/PreviousCaseLookupScreen.tsx#PreviousCaseLookupScreen", result.nodes, result.edges, { maxDepth: 3 });
    expect(flow.nodes.map((node) => node.name)).toEqual(expect.arrayContaining([
      "PreviousCaseLookupScreen", "handleSubmit", "previousCaseService.lookup", "POST",
    ]));
  });

  it("resolves a local object alias and only matches a compatible dynamic API route", () => {
    const result = analyzeSourceFiles([
      { path: "apps/mobile/src/features/nearby-agencies/screens/NearbyAgenciesScreen.tsx", content: `
        import { apiNearbyAgenciesService } from "@/features/nearby-agencies/services/apiNearbyAgencies";
        export function NearbyAgenciesScreen() {
          const nearbyAgenciesService = apiNearbyAgenciesService;
          const loadAgencies = async () => nearbyAgenciesService.getNearbyAgencies({ caseId: "1" });
          return <button onClick={loadAgencies}>load</button>;
        }` },
      { path: "apps/mobile/src/features/nearby-agencies/services/apiNearbyAgencies.ts", content: `
        function getApiUrl(path: string) { return path; }
        export const apiNearbyAgenciesService = { async getNearbyAgencies(query: { caseId: string }) {
          return fetch(getApiUrl(\`/api/cases/\${encodeURIComponent(query.caseId)}/nearby-agencies?sort=distance\`));
        } };` },
      { path: "apps/web/src/app/api/cases/[id]/nearby-agencies/route.ts", content: "export async function GET() { return Response.json([]); }" },
      { path: "apps/web/src/app/api/other/[id]/route.ts", content: "export async function GET() { return Response.json([]); }" },
    ], "team/repository");
    expect(result.edges).toContainEqual(expect.objectContaining({
      source: "symbol:apps/mobile/src/features/nearby-agencies/screens/NearbyAgenciesScreen.tsx#loadAgencies",
      target: "symbol:apps/mobile/src/features/nearby-agencies/services/apiNearbyAgencies.ts#apiNearbyAgenciesService.getNearbyAgencies",
      relation: "call",
      evidence: expect.stringContaining("nearbyAgenciesService.getNearbyAgencies"),
    }));
    expect(result.edges).toContainEqual(expect.objectContaining({
      source: "symbol:apps/mobile/src/features/nearby-agencies/services/apiNearbyAgencies.ts#apiNearbyAgenciesService.getNearbyAgencies",
      target: "symbol:apps/web/src/app/api/cases/[id]/nearby-agencies/route.ts#GET",
      relation: "api",
      evidence: expect.stringContaining("fetch(getApiUrl"),
    }));
    expect(result.edges).not.toContainEqual(expect.objectContaining({
      source: "symbol:apps/mobile/src/features/nearby-agencies/services/apiNearbyAgencies.ts#apiNearbyAgenciesService.getNearbyAgencies",
      target: "symbol:apps/web/src/app/api/other/[id]/route.ts#GET",
    }));
    const flow = traceDisplayGraph("symbol:apps/mobile/src/features/nearby-agencies/screens/NearbyAgenciesScreen.tsx#NearbyAgenciesScreen", result.nodes, result.edges, { maxDepth: 3 });
    expect(flow.nodes.map((node) => node.name)).toEqual(expect.arrayContaining([
      "NearbyAgenciesScreen", "loadAgencies", "apiNearbyAgenciesService.getNearbyAgencies", "GET",
    ]));
  });
});
