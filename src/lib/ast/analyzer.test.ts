import { describe, expect, it } from "vitest";
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
});
