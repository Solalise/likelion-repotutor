import { Node, SyntaxKind, type Node as MorphNode } from "ts-morph";

const IGNORED_CALLS = new Set(["map", "filter", "reduce", "forEach", "then", "catch", "json", "log"]);

export function analyzeCalls(node: MorphNode): string[] {
  const calls = node.getDescendantsOfKind(SyntaxKind.CallExpression).filter((call) => {
    const owner = call.getFirstAncestor((ancestor) =>
      Node.isFunctionDeclaration(ancestor)
      || Node.isArrowFunction(ancestor)
      || Node.isFunctionExpression(ancestor)
      || Node.isMethodDeclaration(ancestor),
    );
    return owner === node;
  }).map((call) => {
    const expression = call.getExpression();
    if (Node.isIdentifier(expression)) return expression.getText();
    if (Node.isPropertyAccessExpression(expression)) return expression.getName();
    return expression.getText();
  });

  return [...new Set(calls.filter((name) => name && !IGNORED_CALLS.has(name)))];
}

export function analyzeComponentReferences(node: MorphNode): string[] {
  const jsxReferences = [
    ...node.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...node.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ].filter((element) => {
    const owner = element.getFirstAncestor((ancestor) =>
      Node.isFunctionDeclaration(ancestor)
      || Node.isArrowFunction(ancestor)
      || Node.isFunctionExpression(ancestor)
      || Node.isMethodDeclaration(ancestor),
    );
    return owner === node;
  }).map((element) => element.getTagNameNode().getText().split(".").at(-1) ?? "");

  return [...new Set(jsxReferences.filter(Boolean))];
}

export function analyzeCallbackReferences(node: MorphNode): string[] {
  const callbackReferences = node.getDescendantsOfKind(SyntaxKind.CallExpression).flatMap((call) => {
    const owner = call.getFirstAncestor((ancestor) =>
      Node.isFunctionDeclaration(ancestor)
      || Node.isArrowFunction(ancestor)
      || Node.isFunctionExpression(ancestor)
      || Node.isMethodDeclaration(ancestor),
    );
    if (owner !== node) return [];
    return call.getArguments().filter(Node.isIdentifier).map((argument) => argument.getText());
  });

  const eventHandlerReferences = node.getDescendantsOfKind(SyntaxKind.JsxAttribute).flatMap((attribute) => {
    const owner = attribute.getFirstAncestor((ancestor) =>
      Node.isFunctionDeclaration(ancestor)
      || Node.isArrowFunction(ancestor)
      || Node.isFunctionExpression(ancestor)
      || Node.isMethodDeclaration(ancestor),
    );
    if (owner !== node) return [];
    const initializer = attribute.getInitializer();
    const expression = initializer && Node.isJsxExpression(initializer) ? initializer.getExpression() : undefined;
    return expression && Node.isIdentifier(expression) ? [expression.getText()] : [];
  });

  return [...new Set([...callbackReferences, ...eventHandlerReferences]
    .filter((name) => name && !IGNORED_CALLS.has(name)))];
}
