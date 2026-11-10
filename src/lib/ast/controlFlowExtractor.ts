import { Node, SyntaxKind } from "ts-morph";
import type { CodeEdge, FunctionInfo } from "@/types/analysis";
import type {
  ControlFlowGuard, ControlFlowLocation, ControlFlowStatement, FunctionControlFlow,
} from "@/types/controlFlow";
import { buildControlGraph, controlId } from "@/lib/controlFlow/graphBuilder";

export const CONTROL_EXTRACTION_LIMITS = { statements: 500, depth: 32 } as const;

/** Descend evaluated syntax only: a nested function has its own owner/body/CFG. */
function evaluatedNodes(root: Node): Node[] {
  const result: Node[] = [];
  function visit(node: Node) {
    if (Node.isFunctionLikeDeclaration(node)) return;
    result.push(node);
    node.forEachChild(visit);
  }
  visit(root);
  return result;
}

export function extractFunctionControlFlow(functionNode: Node, fn: FunctionInfo, context: {
  edges: CodeEdge[];
  resolveTarget: (node: Node) => string | undefined;
  resolveOwner: (node: Node) => string | undefined;
}): FunctionControlFlow {
  const source = functionNode.getSourceFile().getFullText();
  function location(start: number, end: number): ControlFlowLocation {
    return { filePath: fn.filePath, startOffset: start, endOffset: end,
      startLine: source.slice(0, start).split("\n").length, endLine: source.slice(0, end).split("\n").length,
      startColumn: start - source.lastIndexOf("\n", start - 1), endColumn: end - source.lastIndexOf("\n", end - 1) };
  }
  const flow: FunctionControlFlow = {
    schemaVersion: 1, id: controlId("function", fn.id), ownerFunctionId: fn.id,
    functionLocation: location(functionNode.getStart(), functionNode.getEnd()), scope: "function-body",
    semantics: "intra-function-static-control-flow", runtimeExecution: "not-observed", status: "supported",
    bodyStatementIds: [], entryNodeId: "", exits: { normal: "", return: "", throw: "", unknown: "" },
    statements: [], callSites: [], awaitSites: [], nodes: [], edges: [],
    limitations: [
      { code: "function-body-only", message: "Parameter initialization, invocation, event dispatch and caller/callee control flow are outside this graph." },
      { code: "possible-exceptions", message: "Non-literal expression evaluation may throw; possible exceptional edges do not establish an actual exception." },
      { code: "async-order-unavailable", message: "Await locations are recorded; external completion order, scheduling and side effects are not inferred." },
    ],
  };
  const body = (Node.isFunctionDeclaration(functionNode) || Node.isArrowFunction(functionNode)
    || Node.isFunctionExpression(functionNode) || Node.isMethodDeclaration(functionNode)) ? functionNode.getBody() : undefined;
  const originalEdges = context.edges.filter(edge => edge.source === fn.id && edge.relation === "call" && edge.confidence === "confirmed");

  function add(node: Node, kind: ControlFlowStatement["kind"], depth: number, parent: string | undefined, guards: ControlFlowGuard[], start = node.getStart(), end = node.getEnd()): ControlFlowStatement {
    const statement: ControlFlowStatement = {
      id: controlId("statement", fn.id, start, end, kind), ownerFunctionId: fn.id, kind, syntaxKind: node.getKindName(),
      location: location(start, end), sourceCode: source.slice(start, end), depth, parentStatementId: parent,
      branchPath: guards.map(item => ({ ...item })), callSiteIds: [], awaitSiteIds: [], mayThrow: false, reachability: "unknown",
    };
    flow.statements.push(statement);
    return statement;
  }
  function markUnsupported(statement: ControlFlowStatement, reason: string) {
    statement.unsupportedReason = reason;
    flow.status = "partial";
    flow.limitations.push({ code: "unsupported-region", message: reason, statementIds: [statement.id] });
  }
  function collectSites(statement: ControlFlowStatement, roots: Node[]) {
    const seen = new Set<Node>();
    for (const root of roots) for (const item of evaluatedNodes(root)) {
      if (seen.has(item)) continue; seen.add(item);
      if ((!Node.isCallExpression(item) && !Node.isAwaitExpression(item)) || context.resolveOwner(item) !== fn.id) continue;
      if (Node.isCallExpression(item)) {
        const target = context.resolveTarget(item.getExpression());
        const text = item.getText();
        const evidence = text.replace(/\s+/g, " ").slice(0, 240);
        const range = location(item.getStart(), item.getEnd());
        const edgeIds = target ? originalEdges.filter(edge => edge.target === target && (edge.occurrences ?? [edge]).some(occurrence =>
          occurrence.line === range.startLine && occurrence.evidence === evidence && (occurrence.confidence ?? edge.confidence) === "confirmed")).map(edge => edge.id) : [];
        const id = controlId("call", fn.id, range.startOffset, range.endOffset);
        flow.callSites.push({ id, ownerFunctionId: fn.id, statementId: statement.id, location: range, sourceCode: text,
          targetNodeId: target, targetResolution: target ? "resolved" : "unresolved", sourceEdgeIds: [...new Set(edgeIds)].sort(),
          branchPath: statement.branchPath.map(item => ({ ...item })), inUnsupportedRegion: statement.kind === "unsupported", execution: "not-established" });
        statement.callSiteIds.push(id);
      } else if (Node.isAwaitExpression(item)) {
        const range = location(item.getStart(), item.getEnd()), id = controlId("await", fn.id, range.startOffset, range.endOffset);
        flow.awaitSites.push({ id, ownerFunctionId: fn.id, statementId: statement.id, location: range, sourceCode: item.getText(),
          branchPath: statement.branchPath.map(item => ({ ...item })), inUnsupportedRegion: statement.kind === "unsupported", completionOrder: "not-established" });
        statement.awaitSiteIds.push(id);
      }
    }
  }
  function complex(roots: Node[]): boolean {
    return roots.flatMap(evaluatedNodes).some(item => Node.isConditionalExpression(item) || Node.isYieldExpression(item)
      || item.getKind() === SyntaxKind.CommaListExpression
      || ((Node.isCallExpression(item) || Node.isPropertyAccessExpression(item) || Node.isElementAccessExpression(item)) && item.hasQuestionDotToken())
      || (Node.isBinaryExpression(item) && [SyntaxKind.AmpersandAmpersandToken, SyntaxKind.BarBarToken, SyntaxKind.QuestionQuestionToken,
        SyntaxKind.AmpersandAmpersandEqualsToken, SyntaxKind.BarBarEqualsToken, SyntaxKind.QuestionQuestionEqualsToken, SyntaxKind.CommaToken].includes(item.getOperatorToken().getKind())));
  }
  function literalSafe(node: Node): boolean {
    return Node.isStringLiteral(node) || Node.isNumericLiteral(node) || Node.isBigIntLiteral(node)
      || Node.isTrueLiteral(node) || Node.isFalseLiteral(node) || Node.isNullLiteral(node)
      || Node.isArrowFunction(node) || Node.isFunctionExpression(node);
  }
  function sequence(statements: Node[], depth: number, parent: string | undefined, guards: ControlFlowGuard[]): string[] {
    const ids: string[] = [];
    for (const [index, node] of statements.entries()) {
      if (flow.statements.length >= CONTROL_EXTRACTION_LIMITS.statements) {
        const cut = add(node, "unsupported", depth, parent, guards, node.getStart(), statements.at(-1)!.getEnd());
        cut.syntaxKind = "TruncatedStatements";
        markUnsupported(cut, `Statement budget exceeded; ${statements.length - index} remaining statements are opaque.`);
        ids.push(cut.id); break;
      }
      ids.push(parse(node, depth, parent, guards));
    }
    return ids;
  }
  function parse(node: Node, depth: number, parent: string | undefined, guards: ControlFlowGuard[], implicitReturn = false): string {
    let kind: ControlFlowStatement["kind"] = "unsupported";
    let roots: Node[] = [];
    if (implicitReturn) { kind = "return"; roots = [node]; }
    else if (Node.isBlock(node)) kind = "block";
    else if (Node.isIfStatement(node)) { kind = "if"; roots = [node.getExpression()]; }
    else if (Node.isReturnStatement(node)) { kind = "return"; roots = node.getExpression() ? [node.getExpression()!] : []; }
    else if (Node.isThrowStatement(node)) { kind = "throw"; roots = [node.getExpression()]; }
    else if (Node.isTryStatement(node)) kind = "try";
    else if (Node.isExpressionStatement(node)) { kind = "expression"; roots = [node.getExpression()]; }
    else if (Node.isVariableStatement(node)) {
      roots = node.getDeclarations().flatMap(declaration => declaration.getInitializer() ?? []);
      if (["const", "let", "var"].includes(node.getDeclarationKind()) && node.getDeclarations().every(declaration => Node.isIdentifier(declaration.getNameNode()))) kind = "variable";
    } else if (Node.isFunctionDeclaration(node) || Node.isInterfaceDeclaration(node) || Node.isTypeAliasDeclaration(node)) kind = "declaration";
    else if (Node.isEmptyStatement(node)) kind = "empty";
    const depthExceeded = depth > CONTROL_EXTRACTION_LIMITS.depth;
    const complexExpression = complex(roots);
    if (depthExceeded || complexExpression) kind = "unsupported";
    const statement = add(node, kind, depth, parent, guards);
    if (Node.isIfStatement(node)) statement.condition = { sourceCode: node.getExpression().getText(), location: location(node.getExpression().getStart(), node.getExpression().getEnd()) };
    if (implicitReturn) { statement.implicitReturn = true; statement.syntaxKind = "ArrowExpressionBody"; }
    if (kind === "unsupported") {
      markUnsupported(statement, depthExceeded ? "Nesting depth limit exceeded." : complexExpression ? "Conditional/short-circuit/optional/yield/comma expression is opaque in this version." : `Unsupported syntax: ${node.getKindName()}.`);
      // Positions are still useful, but never imply unconditional invocation.
      collectSites(statement, [node]);
      return statement.id;
    }
    statement.mayThrow = roots.some(root => !literalSafe(root));
    collectSites(statement, roots);
    if (kind === "block" && Node.isBlock(node)) statement.children = sequence(node.getStatements(), depth + 1, statement.id, guards);
    if (kind === "if" && Node.isIfStatement(node)) {
      statement.thenBranch = sequence([node.getThenStatement()], depth + 1, statement.id, [...guards, { conditionStatementId: statement.id, branch: "true" }]);
      statement.elseBranch = node.getElseStatement() ? sequence([node.getElseStatement()!], depth + 1, statement.id, [...guards, { conditionStatementId: statement.id, branch: "false" }]) : [];
    }
    if (kind === "try" && Node.isTryStatement(node)) {
      statement.tryBlockId = sequence([node.getTryBlock()], depth + 1, statement.id, guards)[0];
      const caught = node.getCatchClause();
      if (caught) {
        const binding = caught.getVariableDeclaration();
        const clause = add(caught, binding && !Node.isIdentifier(binding.getNameNode()) ? "unsupported" : "catch", depth + 1, statement.id, guards);
        statement.catchClauseId = clause.id;
        if (clause.kind === "unsupported") markUnsupported(clause, "Destructured catch binding is opaque.");
        else clause.children = sequence(caught.getBlock().getStatements(), depth + 2, clause.id, guards);
      }
      const final = node.getFinallyBlock();
      if (final) {
        const keyword = node.getFirstChildByKind(SyntaxKind.FinallyKeyword);
        const clause = add(final, "finally", depth + 1, statement.id, guards, keyword?.getStart() ?? final.getStart(), final.getEnd());
        clause.syntaxKind = "FinallyClause";
        clause.children = sequence(final.getStatements(), depth + 2, clause.id, guards);
        statement.finallyClauseId = clause.id;
      }
    }
    return statement.id;
  }
  if (!body) {
    flow.status = "unavailable";
    flow.limitations.push({ code: "body-unavailable", message: "No supported function body was available." });
  } else flow.bodyStatementIds = Node.isBlock(body) ? sequence(body.getStatements(), 0, undefined, []) : [parse(body, 0, undefined, [], true)];
  buildControlGraph(flow);
  return flow;
}
