import { Node, VariableDeclarationKind } from "ts-morph";
import type { HttpValueEvidence } from "@/types/http";

export function requestLocation(node: Node) {
  const file = node.getSourceFile();
  const startOffset = node.getStart(), endOffset = node.getEnd();
  const start = file.getLineAndColumnAtPos(startOffset), end = file.getLineAndColumnAtPos(endOffset);
  return { filePath: file.getFilePath().replace(/^\//, ""), startOffset, endOffset,
    startLine: start.line, startColumn: start.column, endLine: end.line, endColumn: end.column };
}

/** Only immutable primitive strings. No evaluation, object aliases, coercion or naming heuristics. */
export function requestString(node: Node | undefined, visited = new Set<Node>(), budget = { remaining: 256 }): { value: string; evidence: HttpValueEvidence[] } | undefined {
  if (!node || visited.size > 32 || visited.has(node) || budget.remaining-- <= 0) return;
  const next = new Set(visited).add(node);
  const proof = { location: requestLocation(node), sourceCode: node.getText() };
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralValue().length <= 8192 ? { value: node.getLiteralValue(), evidence: [proof] } : undefined;
  if (Node.isParenthesizedExpression(node) || Node.isAsExpression(node) || Node.isNonNullExpression(node) || Node.isSatisfiesExpression(node)) return requestString(node.getExpression(), next, budget);
  if (Node.isBinaryExpression(node) && node.getOperatorToken().getText() === "+") {
    const left = requestString(node.getLeft(), next, budget);
    if (!left) return;
    const right = requestString(node.getRight(), next, budget);
    if (left && right && left.value.length + right.value.length <= 8192) return { value: left.value + right.value, evidence: [proof, ...left.evidence, ...right.evidence] };
  }
  if (Node.isTemplateExpression(node)) {
    let value = node.getHead().compilerNode.text;
    const evidence: HttpValueEvidence[] = [proof];
    for (const span of node.getTemplateSpans()) {
      const resolved = requestString(span.getExpression(), next, budget);
      if (!resolved) return;
      value += resolved.value + span.getLiteral().compilerNode.text;
      if (value.length > 8192) return;
      evidence.push(...resolved.evidence);
    }
    return { value, evidence };
  }
  if (!Node.isIdentifier(node)) return;
  const symbol = node.getSymbol();
  let declarations = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? [];
  if (declarations.length === 1 && Node.isShorthandPropertyAssignment(declarations[0])) declarations = declarations[0].getValueSymbol()?.getDeclarations() ?? [];
  if (declarations.length !== 1) return;
  const declaration = declarations[0];
  if (!Node.isVariableDeclaration(declaration) || declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const) return;
  const resolved = requestString(declaration.getInitializer(), next, budget);
  if (resolved) return { value: resolved.value, evidence: [proof, { location: requestLocation(declaration), sourceCode: declaration.getText() }, ...resolved.evidence] };
}

export function fetchMethod(options: Node | undefined): { value?: string; expression?: string; evidence: HttpValueEvidence[] } {
  if (!options) return { value: "GET", evidence: [] };
  if (Node.isParenthesizedExpression(options) || Node.isAsExpression(options) || Node.isSatisfiesExpression(options)) return fetchMethod(options.getExpression());
  if (!Node.isObjectLiteralExpression(options)) return { evidence: [] };
  let method: Node | undefined;
  for (const property of options.getProperties()) {
    if (Node.isSpreadAssignment(property) || Node.isComputedPropertyName(property.getNameNode())) return { evidence: [] };
    const name = property.getNameNode();
    const key = Node.isStringLiteral(name) ? name.getLiteralValue() : name.getText();
    if (key !== "method") continue;
    if (Node.isPropertyAssignment(property)) method = property.getInitializer();
    else if (Node.isShorthandPropertyAssignment(property)) method = property.getNameNode();
    else return { evidence: [] };
  }
  if (!method) return { value: "GET", evidence: [] };
  const resolved = requestString(method);
  return { value: resolved?.value.toUpperCase(), expression: method.getText(), evidence: resolved?.evidence ?? [] };
}
