import { Node, SyntaxKind, type VariableDeclaration } from "ts-morph";

export type LocalValueFlow = {
  values: Node[];
  writes: Node[];
  uncertain: boolean;
  unresolved: boolean;
  composed: boolean;
};

function unwrap(node: Node): Node {
  while (Node.isParenthesizedExpression(node) || Node.isAsExpression(node) || Node.isNonNullExpression(node)
    || Node.isTypeAssertion(node)) node = node.getExpression();
  return node;
}

function variable(node: Node): VariableDeclaration | undefined {
  const definitions = node.getSymbol()?.getDeclarations() ?? [];
  return definitions.length === 1 && Node.isVariableDeclaration(definitions[0]) ? definitions[0] : undefined;
}

function target(node: Node, declaration: VariableDeclaration): { matches: boolean; property?: string; indirect: boolean } {
  node = unwrap(node);
  let property: string | undefined;
  let indirect = false;
  if (Node.isPropertyAccessExpression(node)) { property = node.getName(); node = unwrap(node.getExpression()); }
  else if (Node.isElementAccessExpression(node)) {
    const key = node.getArgumentExpression();
    property = key && Node.isStringLiteral(key) ? key.getLiteralValue() : undefined;
    indirect = property === undefined;
    node = unwrap(node.getExpression());
  }
  while (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    indirect = true; node = unwrap(node.getExpression());
  }
  return { matches: Node.isIdentifier(node) && variable(node) === declaration, property, indirect };
}

function statement(node: Node): Node | undefined {
  return node.getFirstAncestor(ancestor => Node.isVariableStatement(ancestor) || Node.isExpressionStatement(ancestor)
    || Node.isReturnStatement(ancestor) || Node.isThrowStatement(ancestor));
}

function field(node: Node | undefined, name: string): Node | undefined {
  if (!node) return;
  node = unwrap(node);
  if (!Node.isObjectLiteralExpression(node)) return;
  if (node.getProperties().some(property => Node.isSpreadAssignment(property)
    || Node.isComputedPropertyName(property.getNameNode()))) return;
  const matches = node.getProperties().filter(property => !Node.isSpreadAssignment(property)
    && property.getName().replace(/^['"]|['"]$/g, "") === name);
  if (matches.length !== 1) return;
  const property = matches[0];
  return Node.isPropertyAssignment(property) ? property.getInitializer()
    : Node.isShorthandPropertyAssignment(property) ? property.getNameNode() : undefined;
}

/** Bounded same-function reaching values. Only standalone writes in the use's block kill
 * prior values; branch/loop/nested-function/indirect mutations remain explicitly uncertain. */
export function resolveLocalValue(reference: Node, use: Node, resolveOwner: (node: Node) => string | undefined, property?: string): LocalValueFlow | undefined {
  reference = unwrap(reference);
  if (!Node.isIdentifier(reference)) return;
  const declaration = variable(reference);
  if (!declaration || declaration.getSourceFile() !== use.getSourceFile() || declaration.getEnd() > use.getStart()
    || resolveOwner(declaration) !== resolveOwner(use)) return;
  const initializer = declaration.getInitializer();
  const initial = property === undefined ? initializer : field(initializer, property);
  const result: LocalValueFlow = { values: initial ? [initial] : [], writes: [declaration], uncertain: false,
    unresolved: !initial, composed: false };
  const useStatement = statement(use);
  let count = 0;
  let opaque = false;
  for (const node of use.getSourceFile().getDescendants()) {
    let left: Node | undefined;
    let right: Node | undefined;
    let operator: SyntaxKind | undefined;
    if (Node.isBinaryExpression(node) && node.getOperatorToken().getKind() >= SyntaxKind.FirstAssignment
      && node.getOperatorToken().getKind() <= SyntaxKind.LastAssignment) {
      left = node.getLeft(); right = node.getRight(); operator = node.getOperatorToken().getKind();
    } else if ((Node.isPrefixUnaryExpression(node) || Node.isPostfixUnaryExpression(node))
      && (node.getOperatorToken() === SyntaxKind.PlusPlusToken || node.getOperatorToken() === SyntaxKind.MinusMinusToken)) left = node.getOperand();
    else if (Node.isDeleteExpression(node)) left = node.getExpression();
    if (!left) {
      // An object passed to an unknown call or aliased can be mutated outside this pass.
      if (property !== undefined && node.getEnd() <= use.getStart() && node.getStart() > declaration.getEnd()) {
        const expression = Node.isCallExpression(node) ? node.getExpression() : undefined;
        const receiver = expression && Node.isPropertyAccessExpression(expression)
          ? target(expression.getExpression(), declaration) : undefined;
        const escape = Node.isCallExpression(node) && (node.getArguments().some(argument => unwrap(argument).getSymbol() === declaration.getNameNode().getSymbol())
          || receiver?.matches && (receiver.property === undefined || receiver.property === property || receiver.indirect))
          || Node.isVariableDeclaration(node) && node.getInitializer()?.getSymbol() === declaration.getNameNode().getSymbol();
        if (escape) opaque = true;
      }
      continue;
    }
    const destination = target(left, declaration);
    if (property !== undefined && right && node.getEnd() <= use.getStart()
      && node.getStart() > declaration.getEnd() && unwrap(right).getSymbol() === declaration.getNameNode().getSymbol()) opaque = true;
    if (!destination.matches || node.getStart() < declaration.getEnd()) continue;
    if (property === undefined && destination.property !== undefined && !destination.indirect) continue;
    if (property !== undefined && destination.property !== undefined && destination.property !== property && !destination.indirect) continue;
    // Other function bodies may run in a different order, even if located later in the file.
    if (resolveOwner(node) !== resolveOwner(use)) { opaque = true; continue; }
    if (node.getEnd() > use.getStart()) continue;
    if (++count > 128) { result.uncertain = true; result.unresolved = true; break; }
    const writeStatement = statement(node);
    const definite = writeStatement && Node.isExpressionStatement(writeStatement)
      && unwrap(writeStatement.getExpression()) === node && writeStatement.getParent() === useStatement?.getParent();
    const value = property !== undefined && destination.property === undefined && !destination.indirect ? field(right, property) : right;
    result.writes.push(node);
    if (operator === SyntaxKind.EqualsToken && definite && !destination.indirect) {
      result.values = value ? [value] : [];
      result.uncertain = !value; result.unresolved = !value; result.composed = false;
    } else {
      if (value) result.values.push(value);
      if (!definite || operator !== SyntaxKind.PlusEqualsToken || destination.indirect) result.uncertain = true;
      if (!value || destination.indirect || operator !== SyntaxKind.EqualsToken && operator !== SyntaxKind.PlusEqualsToken) result.unresolved = true;
      if (operator === SyntaxKind.PlusEqualsToken) result.composed = true;
    }
  }
  if (opaque) { result.uncertain = true; result.unresolved = true; }
  result.values = [...new Set(result.values)].slice(-128);
  return result;
}

export function sqlQueryField(node: Node): "text" | "query" | undefined {
  node = unwrap(node);
  const declaration = Node.isIdentifier(node) ? variable(node) : undefined;
  const value = declaration?.getInitializer() ?? node;
  if (Node.isObjectLiteralExpression(unwrap(value))) {
    const object = unwrap(value);
    if (Node.isObjectLiteralExpression(object)) {
      if (object.getProperty("text")) return "text";
      if (object.getProperty("query")) return "query";
    }
  }
  if (declaration) for (const assignment of node.getSourceFile().getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (assignment.getEnd() > node.getStart()) continue;
    const destination = target(assignment.getLeft(), declaration);
    if (destination.matches && destination.property === "text") return "text";
    if (destination.matches && destination.property === "query") return "query";
    if (destination.matches && destination.property === undefined && assignment.getOperatorToken().getKind() === SyntaxKind.EqualsToken) {
      const right = unwrap(assignment.getRight());
      if (Node.isObjectLiteralExpression(right)) {
        if (right.getProperty("text")) return "text";
        if (right.getProperty("query")) return "query";
      }
    }
  }
}

export function objectFieldValue(node: Node, name: string): Node | undefined { return field(node, name); }
