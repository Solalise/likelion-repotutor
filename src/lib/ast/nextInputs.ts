import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import type { RepositoryEntryPoint } from "@/types/analysis";
import { functionSyntax } from "./prismaClientResolver";

export type NextInputs = { declarations: Map<Node, "action" | "page-object" | "page-values">; names: Set<string>; actions: Array<{ filePath: string; line: number; name: string }> };
const directive = (statements: Node[]) => statements.some((s, i) => i === 0 && Node.isExpressionStatement(s) && Node.isStringLiteral(s.getExpression()) && s.getExpression().getText().slice(1, -1) === "use server");
export function collectNextInputs(sources: Array<{ path: string; sourceFile: SourceFile }>, entries: RepositoryEntryPoint[], owner: (node: Node) => string | undefined): NextInputs {
  const facts: NextInputs = { declarations: new Map(), names: new Set(), actions: [] };
  for (const { path, sourceFile } of sources) for (const node of sourceFile.getDescendants()) {
    const fn = functionSyntax(node); if (!fn) continue;
    const body = fn.getBody();
    const exported = Node.isFunctionDeclaration(fn) ? fn.isExported() : fn.getFirstAncestorByKind(SyntaxKind.VariableStatement)?.isExported();
    const action = fn.isAsync() && (body && Node.isBlock(body) && directive(body.getStatements()) || exported && directive(sourceFile.getStatements()));
    const page = entries.some(e => e.kind === "page" && e.framework === "next-app" && e.nodeId === owner(fn));
    const route = entries.some(e => e.kind === "api" && e.framework === "next-app" && e.nodeId === owner(fn));
    if (!action && !page && !route) continue;
    if (action) facts.actions.push({ filePath: path, line: fn.getStartLineNumber(), name: Node.isFunctionDeclaration(fn) ? fn.getName() ?? "default" : fn.getParent().getText().slice(0, 80) });
    fn.getParameters().forEach((param, index) => {
      if (route && !action && index !== 1) return;
      const name = param.getNameNode();
      if (Node.isIdentifier(name)) { facts.declarations.set(param, action ? "action" : "page-object"); facts.names.add(name.getText()); }
      else if (Node.isObjectBindingPattern(name) && (action || index === 0 || route && index === 1)) for (const binding of name.getElements()) {
        if (!Node.isIdentifier(binding.getNameNode()) || binding.getDotDotDotToken()) continue;
        const key = binding.getPropertyNameNode()?.getText() ?? binding.getName();
        if (action || ["params", "searchParams"].includes(key)) { facts.declarations.set(binding, action ? "action" : "page-values"); facts.names.add(binding.getName()); }
      }
    });
  }
  return facts;
}
export function nextInput(node: Node, facts?: NextInputs) {
  if (!facts) return;
  const identifier = Node.isPropertyAccessExpression(node) ? node.getExpression() : node;
  if (!Node.isIdentifier(identifier) || !facts.names.has(identifier.getText())) return;
  const symbol = identifier.getSymbol();
  const declarations = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? [];
  if (declarations.length !== 1) return;
  const kind = facts.declarations.get(declarations[0]);
  if (!kind || kind === "page-object" && (!Node.isPropertyAccessExpression(node) || !["params", "searchParams"].includes(node.getName()))) return;
  if (Node.isParameterDeclaration(identifier.getParent()) || Node.isBindingElement(identifier.getParent())) return;
  return { filePath: node.getSourceFile().getFilePath().replace(/^\//, ""), line: node.getStartLineNumber(), code: node.getText().slice(0, 600),
    description: kind === "action" ? "Server Action 인수 읽기 · 사용자 제어 여부는 실행 시 확인" : "Next.js 페이지 params/searchParams 입력 읽기" };
}
