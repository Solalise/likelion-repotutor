import path from "node:path";
import { Node, Project, ScriptTarget, SyntaxKind, ts, type SourceFile } from "ts-morph";
import type { FileAnalysis, FunctionInfo, FunctionRelation, RepositoryAnalysis, SourceInput } from "@/types/analysis";
import { buildGraph, resolveImportPath } from "./graphBuilder";
import { analyzeImport } from "./importAnalyzer";
import { analyzeApiRequest, connectApiRequests } from "./apiRelations";
import { collectEntryPointMetadata } from "@/lib/features/entryPointMetadata";
import { normalizePath, symbolNodeId } from "./pathUtils";

type FunctionNode = Node & { getStartLineNumber(): number; getEndLineNumber(): number; getText(): string };
interface Candidate { node: FunctionNode; declaration: Node; name: string; qualifiedName: string; kind: FunctionInfo["kind"] }

function classify(name: string, filePath: string, bodyText: string): FunctionInfo["nodeType"] {
  if (/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/.test(name) && /(?:^|\/)route\.[jt]sx?$/.test(filePath)) return "api";
  if (/^[A-Z]/.test(name) && (bodyText.includes("<") || /(?:^|\/)page\.tsx$/.test(filePath))) return "component";
  return "function";
}

function ownerName(node: Node): string | undefined {
  const parent = node.getParent();
  if (parent && Node.isClassDeclaration(parent)) return parent.getName();
  if (parent && Node.isObjectLiteralExpression(parent)) {
    const container = parent.getParent();
    if (container && Node.isVariableDeclaration(container)) return container.getName();
    if (container && Node.isPropertyAssignment(container)) return container.getName();
  }
  return undefined;
}

function collectCandidates(sourceFile: SourceFile): Candidate[] {
  const candidates: Candidate[] = [];
  for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
    if (!declaration.getBody()) continue;
    const name = declaration.getName() ?? (declaration.isDefaultExport() ? "default" : "anonymous");
    candidates.push({ node: declaration, declaration, name, qualifiedName: name, kind: "function" });
  }
  for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const initializer = declaration.getInitializer();
    if (!initializer) continue;
    const wrapped = Node.isCallExpression(initializer) && ["useCallback", "useMemo"].includes(initializer.getExpression().getText())
      ? initializer.getArguments().find((argument) => Node.isArrowFunction(argument) || Node.isFunctionExpression(argument)) : undefined;
    const functionNode = Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer) ? initializer : wrapped;
    if (!functionNode || (!Node.isArrowFunction(functionNode) && !Node.isFunctionExpression(functionNode))) continue;
    const name = wrapped ? `${declaration.getName()}.callback` : declaration.getName();
    // A callback passed to a wrapper is not the wrapper's return value.
    // Keep its readable context name, but do not bind calls of the result to it.
    candidates.push({ node: functionNode, declaration: wrapped ? functionNode : declaration, name, qualifiedName: name, kind: "arrow" });
  }
  for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    const initializer = declaration.getInitializer();
    if (!initializer || (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer))) continue;
    const name = declaration.getName();
    const owner = ownerName(declaration);
    candidates.push({ node: initializer, declaration, name, qualifiedName: owner ? `${owner}.${name}` : name, kind: "method" });
  }
  for (const method of sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration)) {
    if (!method.getBody()) continue;
    const name = method.getName();
    const owner = ownerName(method);
    candidates.push({ node: method, declaration: method, name, qualifiedName: owner ? `${owner}.${name}` : name, kind: "method" });
  }
  for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyDeclaration)) {
    const initializer = declaration.getInitializer();
    if (!initializer || (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer))) continue;
    const name = declaration.getName();
    const owner = ownerName(declaration);
    candidates.push({ node: initializer, declaration, name, qualifiedName: owner ? `${owner}.${name}` : name, kind: "method" });
  }
  // Keep every callback's execution boundary, including inline JSX handlers and IIFEs.
  const collected = new Set(candidates.map((candidate) => candidate.node));
  for (const node of sourceFile.getDescendants().filter((item) => Node.isArrowFunction(item) || Node.isFunctionExpression(item))) {
    if (collected.has(node)) continue;
    const name = Node.isFunctionExpression(node) && node.getName()
      ? node.getName()! : `callback@${node.getStartLineNumber()}:${node.getStart() - node.getStartLinePos() + 1}`;
    candidates.push({ node, declaration: node, name, qualifiedName: name, kind: "arrow" });
  }
  return candidates;
}

function nodeKey(node: Node): string {
  return `${normalizePath(node.getSourceFile().getFilePath()).replace(/^\//, "")}:${node.getKind()}:${node.getStart()}`;
}
function evidence(node: Node): string { return node.getText().replace(/\s+/g, " ").slice(0, 240); }

function enclosingCandidate(node: Node, candidates: Map<string, Candidate>): Candidate | undefined {
  let current: Node | undefined = node;
  while (current) {
    const match = candidates.get(nodeKey(current));
    if (match) return match;
    if (Node.isFunctionLikeDeclaration(current)) return undefined;
    current = current.getParent();
  }
  return undefined;
}

function resolvedDeclarations(node: Node): Node[] {
  let symbol = node.getSymbol();
  if (!symbol) return [];
  const visited = new Set<string>();
  while (symbol.isAlias()) {
    const key = symbol.getDeclarations().map(nodeKey).join("|") || symbol.getName();
    if (visited.has(key)) break;
    visited.add(key);
    const aliased = symbol.getAliasedSymbol();
    if (!aliased || aliased === symbol) break;
    symbol = aliased;
  }
  return symbol.getDeclarations();
}

function targetId(node: Node, candidates: Map<string, Candidate>, ids: Map<Candidate, string>, visited = new Set<string>()): string | undefined {
  const key = nodeKey(node);
  if (visited.has(key)) return undefined;
  visited.add(key);
  const direct = candidates.get(key);
  if (direct) return ids.get(direct);
  if (Node.isParenthesizedExpression(node) || Node.isAsExpression(node) || Node.isNonNullExpression(node)) {
    return targetId(node.getExpression(), candidates, ids, visited);
  }
  const targets = new Set<string>();
  for (const declaration of resolvedDeclarations(node)) {
    // Resolve the declaration itself, never the function containing a variable or parameter.
    const candidate = candidates.get(nodeKey(declaration));
    if (candidate) targets.add(ids.get(candidate)!);
    else if (Node.isVariableDeclaration(declaration) && declaration.getVariableStatement()?.getDeclarationKind() === "const") {
      const initializer = declaration.getInitializer();
      if (initializer && (Node.isIdentifier(initializer) || Node.isPropertyAccessExpression(initializer))) {
        const target = targetId(initializer, candidates, ids, visited);
        if (target) targets.add(target);
      }
    }
  }
  return targets.size === 1 ? [...targets][0] : undefined;
}

function localValueAliases(sourceFile: SourceFile): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const initializer = declaration.getInitializer();
    if (initializer && Node.isIdentifier(initializer)) aliases.set(declaration.getName(), initializer.getText());
  }
  return aliases;
}

function relationName(expression: Node, aliases: Map<string, string>): string {
  if (!Node.isPropertyAccessExpression(expression)) return expression.getText();
  const owner = expression.getExpression().getText();
  return `${aliases.get(owner) ?? owner}.${expression.getName()}`;
}

function analyzeRelations(candidate: Candidate, candidates: Map<string, Candidate>, ids: Map<Candidate, string>): FunctionRelation[] {
  const relations: FunctionRelation[] = [];
  const aliases = localValueAliases(candidate.node.getSourceFile());
  const push = (item: FunctionRelation): void => {
    const key = `${item.relation}:${item.targetId ?? item.name}:${item.line}`;
    if (!relations.some((current) => `${current.relation}:${current.targetId ?? current.name}:${current.line}` === key)) relations.push(item);
  };
  for (const call of candidate.node.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (enclosingCandidate(call, candidates) !== candidate) continue;
    const request = analyzeApiRequest(call);
    if (request) push(request);
    const expression = call.getExpression();
    const target = targetId(expression, candidates, ids);
    push({
      relation: "call", name: relationName(expression, aliases), targetId: target,
      line: call.getStartLineNumber(), evidence: evidence(call), confidence: target ? "confirmed" : "inferred",
    });
    for (const argument of call.getArguments()) {
      const callbackTarget = targetId(argument, candidates, ids);
      if (callbackTarget && callbackTarget !== ids.get(candidate)) push({ relation: "reference", name: argument.getText(), targetId: callbackTarget, line: argument.getStartLineNumber(), evidence: evidence(call), confidence: "confirmed" });
    }
  }
  const elements = [...candidate.node.getDescendantsOfKind(SyntaxKind.JsxOpeningElement), ...candidate.node.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)];
  for (const element of elements) {
    if (enclosingCandidate(element, candidates) !== candidate) continue;
    const tag = element.getTagNameNode();
    const target = targetId(tag, candidates, ids);
    push({ relation: "component", name: tag.getText().split(".").at(-1) ?? tag.getText(), targetId: target, line: element.getStartLineNumber(), evidence: evidence(element), confidence: target ? "confirmed" : "inferred" });
  }
  for (const attribute of candidate.node.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    if (enclosingCandidate(attribute, candidates) !== candidate) continue;
    const initializer = attribute.getInitializer();
    const expression = initializer && Node.isJsxExpression(initializer) ? initializer.getExpression() : undefined;
    if (!expression) continue;
    const directTarget = targetId(expression, candidates, ids);
    if (directTarget) {
      push({ relation: "reference", name: expression.getText(), targetId: directTarget, line: attribute.getStartLineNumber(), evidence: evidence(attribute), confidence: "confirmed" });
      continue;
    }
    const references = expression.getDescendants().filter((item) =>
      (Node.isIdentifier(item) || Node.isPropertyAccessExpression(item))
      && enclosingCandidate(item, candidates) === candidate
      && !item.getFirstAncestor((ancestor) => Node.isCallExpression(ancestor) && ancestor.getStart() >= expression.getStart() && ancestor.getEnd() <= expression.getEnd()));
    for (const reference of references) {
      const target = targetId(reference, candidates, ids);
      if (target) push({ relation: "reference", name: reference.getText(), targetId: target, line: attribute.getStartLineNumber(), evidence: evidence(attribute), confidence: "confirmed" });
    }
  }
  return relations;
}

export function analyzeSourceFiles(inputs: SourceInput[], repository = "sample-repository"): RepositoryAnalysis {
  const knownPaths = inputs.map((input) => normalizePath(input.path));
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { allowJs: true, jsx: 2, target: ScriptTarget.ESNext, moduleResolution: 2 },
    skipAddingFilesFromTsConfig: true,
    // Use the existing repository-local import rules in the type checker too.
    // This resolves aliases to declarations instead of guessing IDs by name.
    resolutionHost: (host, options) => ({
      resolveModuleNames: (names, containingFile) => names.map((name) => {
        const resolved = resolveImportPath(containingFile.replace(/^\//, ""), name, knownPaths);
        return resolved ? { resolvedFileName: `/${resolved}` }
          : ts.resolveModuleName(name, containingFile, options(), host).resolvedModule;
      }),
    }),
  });
  const sourceFiles = inputs.filter((input) => /\.(?:tsx?|jsx?)$/.test(input.path)).map((input) => {
    const normalized = normalizePath(input.path);
    return { path: normalized, sourceFile: project.createSourceFile(`/${normalized}`, input.content, { overwrite: true }) };
  });
  project.resolveSourceFileDependencies();
  const candidates = new Map<string, Candidate>();
  const ids = new Map<Candidate, string>();
  const byFile = new Map<string, Candidate[]>();
  for (const { path: filePath, sourceFile } of sourceFiles) {
    const items = collectCandidates(sourceFile);
    byFile.set(filePath, items);
    for (const item of items) {
      candidates.set(nodeKey(item.node), item); candidates.set(nodeKey(item.declaration), item);
      const scope = item.node.getAncestors().reverse()
        .filter((ancestor) => Node.isFunctionLikeDeclaration(ancestor) || Node.isBlock(ancestor)
          || Node.isClassDeclaration(ancestor) || Node.isClassExpression(ancestor) || Node.isObjectLiteralExpression(ancestor))
        .map((ancestor) => `${ancestor.getKindName()}@${ancestor.getStart()}`).join("/") || "module";
      ids.set(item, symbolNodeId(filePath, item.qualifiedName, { start: item.declaration.getStart(), scope }));
    }
  }
  const files: FileAnalysis[] = sourceFiles.map(({ path: filePath, sourceFile }) => ({
    path: filePath, name: path.posix.basename(filePath), sourceCode: sourceFile.getFullText(), imports: sourceFile.getImportDeclarations().map(analyzeImport),
    functions: (byFile.get(filePath) ?? []).map((candidate) => {
      const parentNode = candidate.node.getFirstAncestor((ancestor) => {
        const owner = candidates.get(nodeKey(ancestor));
        return Boolean(owner && owner !== candidate);
      });
      const parent = parentNode ? candidates.get(nodeKey(parentNode)) : undefined;
      const relations = analyzeRelations(candidate, candidates, ids);
      return {
        id: ids.get(candidate)!, name: candidate.qualifiedName, filePath, line: candidate.node.getStartLineNumber(), endLine: candidate.node.getEndLineNumber(), kind: candidate.kind,
        nodeType: classify(candidate.name, filePath, candidate.node.getText()), sourceCode: candidate.node.getText(), parentId: parent ? ids.get(parent) : undefined, relations,
        calls: relations.filter((item) => item.relation === "call").map((item) => item.name),
        componentReferences: relations.filter((item) => item.relation === "component").map((item) => item.name),
        callbackReferences: relations.filter((item) => item.relation === "reference").map((item) => item.name),
      };
    }),
  }));
  connectApiRequests(files, sourceFiles, (node) => targetId(node, candidates, ids));
  const graph = buildGraph(files);
  const functionRelations = files.flatMap((file) => file.functions.flatMap((fn) => (fn.relations ?? []).map((relation) => ({ fn, relation }))));
  const unresolvedRelations = functionRelations.filter(({ fn, relation }) => !graph.edges.some((edge) =>
    edge.source === fn.id && edge.target === relation.targetId && edge.relation === relation.relation && edge.line === relation.line,
  ));
  return {
    repository,
    files,
    ...graph,
    entryPoints: collectEntryPointMetadata(sourceFiles, (node) => targetId(node, candidates, ids)),
    stats: {
      files: files.length,
      functions: files.flatMap((file) => file.functions).length,
      relations: graph.edges.length,
      unresolvedRelations: unresolvedRelations.length,
      unmatchedApiRequests: unresolvedRelations.filter(({ relation }) => relation.relation === "api").length,
    },
  };
}
