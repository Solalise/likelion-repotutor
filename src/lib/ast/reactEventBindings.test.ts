import { describe, expect, it } from "vitest";
import { analyzeSourceFiles } from "./analyzer";

const helpers = "function handleLogin() {}\nfunction handleSubmit() {}\nfunction handleChange() {}\n";
function parse(jsx: string, setup = "") {
  return analyzeSourceFiles([{ path: "app/page.tsx", content: `${helpers}export default function Page() { ${setup} return <>${jsx}</>; }` }]);
}

describe("React JSX event binding extraction", () => {
  it.each([
    ["button", "onClick", "handleLogin", "click"], ["form", "onSubmit", "handleSubmit", "submit"], ["input", "onChange", "handleChange", "change"],
  ])("resolves intrinsic <%s> %s with a direct declaration", (tag, prop, handler, type) => {
    const analysis = parse(`<${tag} ${prop}={${handler}}/>`);
    const binding = analysis.reactEventBindings![0];
    expect(binding).toMatchObject({ eventName: prop, eventType: type, phase: "bubble", mode: "direct", status: "confirmed", confidence: "confirmed", targetResolution: "resolved", element: { name: tag, kind: "intrinsic" } });
    expect(analysis.nodes.find(node => node.id === binding.targetNodeId)?.name).toBe(handler);
    expect(binding.sourceCode).toBe(`${prop}={${handler}}`);
    expect(analysis.files[0].sourceCode.slice(binding.startOffset, binding.endOffset)).toBe(binding.sourceCode);
    expect(binding.column).toBeGreaterThan(1);
    expect(binding.line).toBe(4);
  });

  it.each([
    '<button onClick={() => handleLogin()}/>',
    '<form onSubmit={(event) => { event.preventDefault(); handleSubmit(); }}/>',
    '<input onChange={function(event) { handleChange(); }}/>',
  ])("resolves an inline callback boundary without skipping it: %s", (jsx) => {
    const analysis = parse(jsx);
    const binding = analysis.reactEventBindings![0];
    expect(binding).toMatchObject({ mode: "inline", status: "confirmed", targetResolution: "resolved" });
    const fn = analysis.files[0].functions.find(fn => fn.id === binding.targetNodeId)!;
    expect(fn.sourceCode).toBe(binding.handlerExpression);
    expect(fn.name).toMatch(/callback@/);
    expect(fn.id).not.toBe(binding.ownerNodeId);
  });

  it.each(["ready ? handleLogin : handleChange", "ready && handleLogin", "ready || handleLogin", "ready ?? handleLogin"])("retains a conditional binding without choosing a target: %s", (expression) => {
    const binding = parse(`<button onClick={${expression}}/>`).reactEventBindings![0];
    expect(binding).toMatchObject({ mode: "conditional", confidence: "inferred", status: "unresolved", reason: "conditional-handler", targetResolution: "unresolved" });
    expect(binding.targetNodeId).toBeUndefined();
  });

  it.each(["handlers[key]", "makeHandler()", "handleLogin.bind(null)", "controller.handle"])("does not infer a dynamic handler value: %s", (expression) => {
    expect(parse(`<button onClick={${expression}}/>`).reactEventBindings![0]).toMatchObject({ mode: "dynamic", status: "unresolved", reason: "dynamic-handler" });
  });

  it("preserves custom component props as non-DOM findings even with a resolved handler", () => {
    const binding = parse('<Button onClick={handleLogin}/>').reactEventBindings![0];
    expect(binding).toMatchObject({ element: { kind: "component", name: "Button" }, status: "unresolved", reason: "component-prop", targetResolution: "resolved" });
    expect(binding.targetNodeId).toBeDefined();
  });

  it.each([["my-button", "custom-element"], ["UI.Button", "component-prop"], ["mystery", "unsupported-element"], ["svg:button", "unsupported-element"]])("does not treat <%s> as a supported intrinsic DOM element", (tag, reason) => {
    expect(parse(`<${tag} onClick={handleLogin}/>`).reactEventBindings![0]).toMatchObject({ status: "unresolved", reason });
  });

  it("keeps arbitrary JSX function props out of event metadata", () => {
    const analysis = parse('<Button action={handleLogin} render={handleSubmit}/>');
    expect(analysis.reactEventBindings).toEqual([]);
    expect(analysis.edges.filter(edge => edge.relation === "reference")).toHaveLength(2);
  });

  it("retains multiple sites lost by same-line generic reference merging", () => {
    const analysis = parse('<button onClick={handleLogin} onChange={handleLogin}/><form onSubmit={handleLogin}/><button onClick={handleLogin}/>');
    expect(analysis.reactEventBindings).toHaveLength(4);
    expect(new Set(analysis.reactEventBindings!.map(item => item.id)).size).toBe(4);
    expect(analysis.edges.filter(edge => edge.relation === "reference")).toHaveLength(1);
    expect(analysis.reactEventBindings!.every(item => item.status === "confirmed")).toBe(true);
  });

  it("respects attribute/spread precedence without assuming the spread's contents", () => {
    const analysis = parse('<button onClick={handleLogin} {...props}/><button {...props} onClick={handleLogin}/><button onClick={handleLogin} onClick={handleChange}/>');
    const explicit = analysis.reactEventBindings!.filter(item => item.eventName !== "*");
    expect(explicit.map(item => item.reason)).toEqual(["later-spread", undefined, "overridden-attribute", undefined]);
    expect(analysis.reactEventBindings!.filter(item => item.mode === "spread").every(item => item.reason === "spread-properties")).toBe(true);
  });

  it("resolves const aliases and imported functions with declaration identity", () => {
    const analysis = analyzeSourceFiles([
      { path: "lib/handler.ts", content: "export function handle() {}" },
      { path: "app/page.tsx", content: 'import { handle as imported } from "../lib/handler"; const alias = imported; export default function Page() { return <button onClick={alias}/>; }' },
    ]);
    const binding = analysis.reactEventBindings![0];
    expect(binding.status).toBe("confirmed");
    expect(analysis.nodes.find(node => node.id === binding.targetNodeId)?.filePath).toBe("lib/handler.ts");
  });

  it("does not resolve mutable variable handlers or visibly reassigned functions", () => {
    const mutable = parse('<button onClick={local}/>', "let local = () => handleLogin();");
    expect(mutable.reactEventBindings![0]).toMatchObject({ status: "unresolved", reason: "dynamic-handler" });
    const reassigned = parse('<button onClick={handleLogin}/>', "handleLogin = () => handleChange();");
    expect(reassigned.reactEventBindings![0]).toMatchObject({ status: "unresolved", reason: "dynamic-handler" });
  });

  it("distinguishes shadowed names by declaration ID", () => {
    const analysis = analyzeSourceFiles([{ path: "app/page.tsx", content: `
      function A() { const handle = () => 1; return <button onClick={handle}/>; }
      export default function Page() { const handle = () => 2; return <button onClick={handle}/>; }
    ` }]);
    expect(analysis.reactEventBindings).toHaveLength(2);
    expect(new Set(analysis.reactEventBindings!.map(item => item.targetNodeId)).size).toBe(2);
  });

  it.each(['<button onClick/>', '<button onClick="text"/>', '<button onClick={null}/>'])("retains a missing/non-function handler safely: %s", (jsx) => {
    expect(parse(jsx).reactEventBindings![0]).toMatchObject({ status: "unresolved", reason: "missing-handler" });
  });

  it("retains unknown targets, unsupported events and ownerless JSX", () => {
    expect(parse('<button onClick={unknownHandler}/>').reactEventBindings![0]).toMatchObject({ status: "unresolved", reason: "unresolved-target" });
    expect(parse('<button onMystery={handleLogin}/>').reactEventBindings![0]).toMatchObject({ status: "unresolved", reason: "unsupported-event" });
    const moduleJsx = analyzeSourceFiles([{ path: "element.tsx", content: "function handle() {} const element = <button onClick={handle}/>;" }]);
    expect(moduleJsx.reactEventBindings![0]).toMatchObject({ status: "unresolved", reason: "owner-unavailable" });
  });

  it("records capture phase and exact multiline/CRLF/UTF-16 ranges", () => {
    const analysis = analyzeSourceFiles([{ path: "app/page.tsx", content: 'function handle() {}\r\nexport default function Page() { return <button title="한글😀"\r\n onClickCapture={\r\n handle\r\n }/>; }' }]);
    const binding = analysis.reactEventBindings![0];
    expect(binding).toMatchObject({ eventType: "click", phase: "capture", status: "confirmed", line: 3, endLine: 5, column: 2 });
    expect(analysis.files[0].sourceCode.slice(binding.startOffset, binding.endOffset)).toBe(binding.sourceCode);
  });
});
