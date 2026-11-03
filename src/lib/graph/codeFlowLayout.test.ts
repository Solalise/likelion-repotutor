import { describe, expect, it } from "vitest";
import type { CodeEdge, CodeNode } from "@/types/analysis";
import { buildCodeFlowLayout, classifyCodeNode } from "./codeFlowLayout";

const node = (name: string, type: CodeNode["type"], filePath: string): CodeNode => ({
  id: `symbol:${filePath}#${name}`,
  name,
  type,
  filePath,
  line: 1,
});

describe("buildCodeFlowLayout", () => {
  it("places the real login call chain from left to right in detected layers", () => {
    const nodes = [
      node("LoginPage", "component", "app/login/page.tsx"),
      node("handleLogin", "function", "app/login/page.tsx"),
      node("login", "function", "services/auth.ts"),
      node("POST", "api", "app/api/auth/route.ts"),
      node("findUser", "function", "repositories/userRepository.ts"),
    ];
    const edges: CodeEdge[] = [
      { id: "event", source: nodes[0].id, target: nodes[1].id, relation: "reference", evidence: "onClick={handleLogin}" },
      { id: "call-login", source: nodes[1].id, target: nodes[2].id, relation: "call" },
      { id: "api", source: nodes[2].id, target: nodes[3].id, relation: "api" },
      { id: "call-user", source: nodes[3].id, target: nodes[4].id, relation: "call" },
    ];
    const layout = buildCodeFlowLayout(nodes, edges);
    const byName = new Map(layout.nodes.map((item) => [item.node.name, item]));

    expect(layout.nodes).toHaveLength(nodes.length);
    expect(layout.nodes.map((item) => item.node.id)).toEqual(nodes.map((item) => item.id));
    expect(["LoginPage", "handleLogin", "login", "POST", "findUser"].map((name) => byName.get(name)!.stage)).toEqual([0, 1, 2, 3, 4]);
    expect(["LoginPage", "handleLogin", "login", "POST", "findUser"].map((name) => byName.get(name)!.position.x)).toEqual([
      byName.get("LoginPage")!.position.x,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    ]);
    expect(byName.get("LoginPage")!.position.x).toBeLessThan(byName.get("handleLogin")!.position.x);
    expect(byName.get("handleLogin")!.position.x).toBeLessThan(byName.get("login")!.position.x);
    expect(byName.get("login")!.position.x).toBeLessThan(byName.get("POST")!.position.x);
    expect(byName.get("POST")!.position.x).toBeLessThan(byName.get("findUser")!.position.x);
    expect(layout.lanes.map((lane) => lane.layer)).toEqual(["ui", "event", "api-client", "api-route", "data"]);
  });

  it("keeps cycles finite and classifies a service without an API request as service", () => {
    const first = node("first", "function", "services/workflow.ts");
    const second = node("second", "function", "services/workflow.ts");
    const edges: CodeEdge[] = [
      { id: "a", source: first.id, target: second.id, relation: "call" },
      { id: "b", source: second.id, target: first.id, relation: "call" },
    ];
    const layout = buildCodeFlowLayout([first, second], edges);
    expect(layout.nodes.map((item) => item.stage)).toEqual([0, 0]);
    expect(classifyCodeNode(first, edges)).toEqual({ layer: "service", role: "Service function" });
  });
});
