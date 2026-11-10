import { Node, SyntaxKind, VariableDeclarationKind, type SourceFile } from "ts-morph";
import type { FunctionControlFlow } from "@/types/controlFlow";
import type { DatabaseEvidence } from "@/types/database";
import { requestLocation } from "./staticRequestValues";

export interface PrismaProof { kind: "client" | "transaction"; evidence: DatabaseEvidence[]; transactionSiteId?: string }
export type PrismaBindings = Map<Node, PrismaProof>;
export function databaseEvidence(kind: DatabaseEvidence["kind"], node: Node): DatabaseEvidence {
  return { kind, location: requestLocation(node), sourceCode: node.getText() };
}
export function functionSyntax(node: Node) {
  return Node.isFunctionDeclaration(node) || Node.isFunctionExpression(node) || Node.isArrowFunction(node) || Node.isMethodDeclaration(node) ? node : undefined;
}
function unwrap(node: Node): Node {
  return Node.isAsExpression(node) || Node.isParenthesizedExpression(node) || Node.isSatisfiesExpression(node) || Node.isNonNullExpression(node) ? unwrap(node.getExpression()) : node;
}
function declarations(node: Node): Node[] {
  const symbol = node.getSymbol();
  return (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? [];
}

/** Source identity, never the receiver/variable's spelling or an asserted Prisma type. */
export function createPrismaResolver(sources: SourceFile[], definitions: Map<string, Node>, controlFlows: FunctionControlFlow[], resolveTarget: (node: Node) => string | undefined) {
  const writes: Node[] = [];
  for (const source of sources) {
    for (const binary of source.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      if (/^(?:=|\+=|-=|\*=|\/=|\?\?=|&&=|\|\|=|\*\*=|%=|&=|\|=|\^=|<<=|>>=|>>>=)$/.test(binary.getOperatorToken().getText())) writes.push(binary.getLeft());
    }
    for (const unary of [...source.getDescendantsOfKind(SyntaxKind.PrefixUnaryExpression), ...source.getDescendantsOfKind(SyntaxKind.PostfixUnaryExpression)]) {
      if ([SyntaxKind.PlusPlusToken, SyntaxKind.MinusMinusToken].includes(unary.getOperatorToken())) writes.push(unary.getOperand());
    }
    writes.push(...source.getDescendantsOfKind(SyntaxKind.DeleteExpression).map(item => item.getExpression()));
  }
  function mutated(declaration: Node): boolean {
    function aliasesTo(node: Node, visited = new Set<Node>()): boolean {
      if (visited.size > 24 || visited.has(node)) return false;
      const next = new Set(visited).add(node);
      node = unwrap(node);
      if (!Node.isIdentifier(node)) return false;
      return declarations(node).some(item => item === declaration || (Node.isVariableDeclaration(item)
        && item.getInitializer() && aliasesTo(item.getInitializer()!, next)));
    }
    return writes.some(write => {
      let root = unwrap(write);
      while (Node.isPropertyAccessExpression(root) || Node.isElementAccessExpression(root)) root = unwrap(root.getExpression());
      return aliasesTo(root);
    });
  }
  function constructorImport(node: Node): Node | undefined {
    node = unwrap(node);
    if (Node.isIdentifier(node)) {
      const imports = node.getSymbol()?.getDeclarations() ?? [];
      return imports.find(item => Node.isImportSpecifier(item) && item.getName() === "PrismaClient" && !item.isTypeOnly()
        && !item.getFirstAncestorByKind(SyntaxKind.ImportClause)?.isTypeOnly()
        && item.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)?.getModuleSpecifierValue() === "@prisma/client");
    }
    if (Node.isPropertyAccessExpression(node) && node.getName() === "PrismaClient") {
      return (node.getExpression().getSymbol()?.getDeclarations() ?? []).find(item => Node.isNamespaceImport(item)
        && !item.getFirstAncestorByKind(SyntaxKind.ImportClause)?.isTypeOnly()
        && item.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)?.getModuleSpecifierValue() === "@prisma/client");
    }
  }
  function resolve(node: Node | undefined, bindings: PrismaBindings, visited = new Set<Node>(), budget = { remaining: 128 }): PrismaProof | undefined {
    if (!node || visited.size > 24 || visited.has(node) || budget.remaining-- <= 0) return;
    const original = node;
    node = unwrap(node);
    const next = new Set(visited).add(original).add(node);
    if (Node.isNewExpression(node)) {
      const imported = constructorImport(node.getExpression());
      if (imported) return { kind: "client", evidence: [databaseEvidence("constructor-import", imported), databaseEvidence("client-construction", node)] };
      return;
    }
    if (Node.isIdentifier(node)) {
      if ((node.getSymbol()?.getDeclarations() ?? []).some(item => (Node.isImportSpecifier(item) && item.isTypeOnly())
        || (Node.isImportClause(item) && item.isTypeOnly()) || item.getFirstAncestorByKind(SyntaxKind.ImportClause)?.isTypeOnly())) return;
      const items = declarations(node);
      if (items.length !== 1) return;
      const declaration = items[0];
      if (mutated(declaration)) return;
      const bound = bindings.get(declaration);
      if (bound) return { ...bound, evidence: [...bound.evidence, databaseEvidence("alias", node)] };
      if (!Node.isVariableDeclaration(declaration) || declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const) return;
      const proof = resolve(declaration.getInitializer(), bindings, next, budget);
      return proof && { ...proof, evidence: [...proof.evidence, databaseEvidence("alias", declaration), databaseEvidence("alias", node)] };
    }
    if (Node.isPropertyAccessExpression(node)) {
      const namespace = node.getExpression().getSymbol()?.getDeclarations() ?? [];
      if (!namespace.some(item => Node.isNamespaceImport(item) && !item.getFirstAncestorByKind(SyntaxKind.ImportClause)?.isTypeOnly()
        && item.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)?.getModuleSpecifierSourceFile())) return;
      const items = declarations(node), declaration = items.length === 1 ? items[0] : undefined;
      if (!declaration || !Node.isVariableDeclaration(declaration) || mutated(declaration)
        || declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const) return;
      const proof = resolve(declaration.getInitializer(), bindings, next, budget);
      return proof && {...proof,evidence:[...proof.evidence,databaseEvidence("alias",declaration),databaseEvidence("alias",node)]};
    }
    if (Node.isCallExpression(node) && !node.hasQuestionDotToken() && node.getArguments().length === 0) {
      const id = resolveTarget(node.getExpression()), syntax = id ? definitions.get(id) : undefined;
      const fn = syntax && functionSyntax(syntax), cfg = controlFlows.find(item => item.ownerFunctionId === id);
      // A synchronous zero-argument factory must return a verified client on every normal exit.
      if (!fn || fn.isAsync() || fn.getParameters().length || !cfg || cfg.status !== "supported"
        || cfg.nodes.find(item => item.id === cfg.exits.normal)?.reachability !== "unreachable-in-model") return;
      const body = fn.getBody();
      const returns = body && Node.isBlock(body) ? body.getDescendantsOfKind(SyntaxKind.ReturnStatement)
        .filter(item => item.getFirstAncestor(ancestor => Boolean(functionSyntax(ancestor))) === fn).map(item => item.getExpression()) : body ? [body] : [];
      if (!returns.length) return;
      const proofs: PrismaProof[] = [];
      for (const expression of returns) {
        const proof = resolve(expression, bindings, next, budget);
        if (!proof || proof.kind !== "client") return;
        proofs.push(proof);
      }
      return { kind: "client", evidence: [...proofs.flatMap(item => item.evidence), databaseEvidence("factory-return", node)] };
    }
  }
  return { resolve };
}
