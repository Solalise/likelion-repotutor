import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import type { ReactEventBinding, ReactEventBindingReason } from "@/types/analysis";

import { reactEventDescriptor, reactElementKind } from "./reactEventRules";

function unwrap(node: Node): Node {
  while (Node.isParenthesizedExpression(node) || Node.isAsExpression(node) || Node.isNonNullExpression(node)
    || Node.isSatisfiesExpression(node)) node = node.getExpression();
  return node;
}

/** Only immutable identifier values are followed; call results and mutable fields are not handlers. */
function stableIdentifier(node: Node, visited = new Set<string>()): boolean {
  node = unwrap(node);
  if (!Node.isIdentifier(node)) return false;
  const key = `${node.getSourceFile().getFilePath()}:${node.getStart()}`;
  if (visited.has(key)) return false;
  visited.add(key);
  let symbol = node.getSymbol();
  const aliases = new Set<string>();
  while (symbol?.isAlias()) {
    const key = symbol.getDeclarations().map(item => `${item.getSourceFile().getFilePath()}:${item.getStart()}`).join("|");
    if (aliases.has(key)) return false;
    aliases.add(key);
    symbol = symbol.getAliasedSymbol();
  }
  const declarations = symbol?.getDeclarations() ?? [];
  return declarations.length > 0 && declarations.every(declaration => {
    if (Node.isFunctionDeclaration(declaration)) return true;
    if (!Node.isVariableDeclaration(declaration) || declaration.getVariableStatement()?.getDeclarationKind() !== "const") return false;
    const value = declaration.getInitializer();
    if (!value) return false;
    const unwrapped = unwrap(value);
    return Node.isArrowFunction(unwrapped) || Node.isFunctionExpression(unwrapped) || stableIdentifier(unwrapped, new Set(visited));
  });
}

export function collectReactEventBindings(sources: Array<{ path: string; sourceFile: SourceFile }>, callbacks: {
  resolveTarget: (node: Node) => string | undefined;
  resolveOwner: (node: Node) => string | undefined;
}): ReactEventBinding[] {
  const writtenTargets = new Set<string>();
  for (const { sourceFile } of sources) for (const binary of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    const operator = binary.getOperatorToken().getKind();
    if (operator >= SyntaxKind.FirstAssignment && operator <= SyntaxKind.LastAssignment) {
      const target = callbacks.resolveTarget(binary.getLeft());
      if (target) writtenTargets.add(target);
    }
  }
  const result: ReactEventBinding[] = [];
  for (const { path, sourceFile } of sources) {
    const fullText = sourceFile.getFullText();
    const elements = [...sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement), ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)];
    for (const element of elements) {
      const tag = element.getTagNameNode(), name = tag.getText(), kind = reactElementKind(name);
      const attributes = element.getAttributes();
      for (const [index, attribute] of attributes.entries()) {
        const spread = Node.isJsxSpreadAttribute(attribute);
        const eventName = Node.isJsxAttribute(attribute) ? attribute.getNameNode().getText() : "*";
        if (!spread && !/^on[A-Z]/.test(eventName)) continue;
        const descriptor = reactEventDescriptor(eventName);
        const initializer = Node.isJsxAttribute(attribute) ? attribute.getInitializer() : undefined;
        const expression = initializer && Node.isJsxExpression(initializer) ? initializer.getExpression() : undefined;
        const value = expression && unwrap(expression);
        let mode: ReactEventBinding["mode"] = spread ? "spread" : "none";
        let targetNodeId: string | undefined;
        let reason: ReactEventBindingReason | undefined;
        if (value) {
          if (Node.isArrowFunction(value) || Node.isFunctionExpression(value)) {
            mode = "inline"; targetNodeId = callbacks.resolveTarget(value);
          } else if (Node.isConditionalExpression(value) || (Node.isBinaryExpression(value)
            && [SyntaxKind.AmpersandAmpersandToken, SyntaxKind.BarBarToken, SyntaxKind.QuestionQuestionToken].includes(value.getOperatorToken().getKind()))) {
            mode = "conditional"; reason = "conditional-handler";
          } else if (Node.isIdentifier(value)) {
            mode = "direct";
            const resolved = callbacks.resolveTarget(value);
            if (stableIdentifier(value)) targetNodeId = resolved;
            else reason = resolved ? "dynamic-handler" : "unresolved-target";
          } else if (Node.isNullLiteral(value) || Node.isFalseLiteral(value) || Node.isTrueLiteral(value) || Node.isStringLiteral(value)) {
            mode = "none"; reason = "missing-handler";
          } else { mode = "dynamic"; reason = "dynamic-handler"; }
        }
        if (targetNodeId && writtenTargets.has(targetNodeId)) { targetNodeId = undefined; reason = "dynamic-handler"; mode = "dynamic"; }
        const ownerNodeId = callbacks.resolveOwner(attribute);
        const later = attributes.slice(index + 1);
        if (spread) reason = "spread-properties";
        else if (kind === "component") reason = "component-prop";
        else if (kind === "custom-element") reason = "custom-element";
        else if (kind !== "intrinsic") reason = "unsupported-element";
        else if (!descriptor) reason = "unsupported-event";
        else if (later.some(item => Node.isJsxAttribute(item) && item.getNameNode().getText() === eventName)) reason = "overridden-attribute";
        else if (later.some(Node.isJsxSpreadAttribute)) reason = "later-spread";
        else if (!ownerNodeId) reason = "owner-unavailable";
        else if (!value) reason = "missing-handler";
        else if (!reason && !targetNodeId) reason = "unresolved-target";
        const start = attribute.getStart(), end = attribute.getEnd();
        result.push({
          id: `react-event:${JSON.stringify([path, start, end])}`, ownerNodeId, eventName,
          eventType: descriptor?.type, phase: descriptor?.phase,
          element: { name, kind, startOffset: tag.getStart(), endOffset: tag.getEnd() },
          filePath: path, line: attribute.getStartLineNumber(), endLine: attribute.getEndLineNumber(),
          column: start - fullText.lastIndexOf("\n", start - 1), endColumn: end - fullText.lastIndexOf("\n", end - 1),
          startOffset: start, endOffset: end, sourceCode: attribute.getText(), handlerExpression: expression?.getText(), mode,
          targetNodeId, targetResolution: targetNodeId ? "resolved" : "unresolved",
          status: reason ? "unresolved" : "confirmed", confidence: reason ? mode === "conditional" ? "inferred" : "unknown" : "confirmed", reason,
        });
      }
    }
  }
  return result.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.startOffset - b.startOffset);
}
