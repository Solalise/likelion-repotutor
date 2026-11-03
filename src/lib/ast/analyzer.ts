import path from "node:path";
import { Node, Project, ScriptTarget, SyntaxKind, type CallExpression, type SourceFile } from "ts-morph";
import type { FileAnalysis, FunctionInfo, FunctionRelation, RepositoryAnalysis, SourceInput } from "@/types/analysis";
import { buildGraph } from "./graphBuilder";
import { analyzeImport } from "./importAnalyzer";
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
    const name = declaration.getName();
    candidates.push({ node: functionNode, declaration, name, qualifiedName: name, kind: "arrow" });
  }
  for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    const initializer = declaration.getInitializer();
    if (!initializer || (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer))) continue;
    const name = declaration.getName();
    const owner = ownerName(declaration);
    candidates.push({ node: initializer, declaration, name, qualifiedName: owner ? `${owner}.${name}` : name, kind: "method" });
  }
  for (const method of sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration)) {
    const name = method.getName();
    const owner = ownerName(method);
    candidates.push({ node: method, declaration: method, name, qualifiedName: owner ? `${owner}.${name}` : name, kind: "method" });
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
    current = current.getParent();
  }
  return undefined;
}

function resolvedDeclarations(node: Node): Node[] {
  let symbol = node.getSymbol();
  if (!symbol) return [];
  const visited = new Set<string>();
  while (symbol.isAlias()) {
    const key = `${symbol.getName()}:${symbol.getDeclarations()[0]?.getStart() ?? -1}`;
    if (visited.has(key)) break;
    visited.add(key);
    const aliased = symbol.getAliasedSymbol();
    if (!aliased || aliased === symbol) break;
    symbol = aliased;
  }
  return symbol.getDeclarations();
}

function targetId(node: Node, candidates: Map<string, Candidate>, ids: Map<Candidate, string>): string | undefined {
  for (const declaration of resolvedDeclarations(node)) {
    const candidate = enclosingCandidate(declaration, candidates);
    if (candidate) return ids.get(candidate);
  }
  return undefined;
}

function staticString(node: Node | undefined): string | undefined {
  return node && (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) ? node.getLiteralValue() : undefined;
}
function propertyValue(call: CallExpression, name: string): string | undefined {
  const object = call.getArguments().find(Node.isObjectLiteralExpression);
  const property = object?.getProperty(name);
  return property && Node.isPropertyAssignment(property) ? staticString(property.getInitializer()) : undefined;
}

function deriveRequestPath(node: Node | undefined, depth = 0): string | undefined {
  if (!node || depth > 3) return undefined;
  const literal = staticString(node);
  if (literal) return literal;
  if (Node.isTemplateExpression(node)) {
    return node.getHead().getLiteralText()
      + node.getTemplateSpans().map((span) => `__DYNAMIC__${span.getLiteral().getLiteralText()}`).join("");
  }
  if (Node.isCallExpression(node) && /(?:^|\.)(?:get|build|create)?ApiUrl$/i.test(node.getExpression().getText())) {
    return deriveRequestPath(node.getArguments()[0], depth + 1);
  }
  return undefined;
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

function requestRelation(call: CallExpression): FunctionRelation | undefined {
  const expression = call.getExpression();
  const text = expression.getText();
  let requestPath: string | undefined;
  let requestMethod: string | undefined;
  if (text === "fetch") {
    requestPath = deriveRequestPath(call.getArguments()[0]);
    requestMethod = propertyValue(call, "method")?.toUpperCase() ?? "GET";
  } else if (Node.isPropertyAccessExpression(expression) && /^(get|post|put|patch|delete|head|options)$/i.test(expression.getName())) {
    if (!/(?:axios|client|api)$/i.test(expression.getExpression().getText())) return undefined;
    requestPath = staticString(call.getArguments()[0]);
    requestMethod = expression.getName().toUpperCase();
  } else if (/axios$/i.test(text)) {
    requestPath = propertyValue(call, "url");
    requestMethod = propertyValue(call, "method")?.toUpperCase() ?? "GET";
  }
  if (!requestPath?.startsWith("/")) return undefined;
  return { relation: "api", name: `${requestMethod} ${requestPath}`, line: call.getStartLineNumber(), evidence: evidence(call), confidence: "confirmed", requestPath, requestMethod };
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
    const request = requestRelation(call);
    if (request) push(request);
    const expression = call.getExpression();
    const target = targetId(expression, candidates, ids);
    if (target !== ids.get(candidate)) push({
      relation: "call", name: relationName(expression, aliases), targetId: target,
      line: call.getStartLineNumber(), evidence: evidence(call), confidence: target ? "confirmed" : "inferred",
    });
    for (const argument of call.getArguments()) {
      if (!Node.isIdentifier(argument) && !Node.isPropertyAccessExpression(argument)) continue;
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
    if (enclosingCandidate(attribute, candidates) !== candidate || !/^on[A-Z]/.test(attribute.getNameNode().getText())) continue;
    const initializer = attribute.getInitializer();
    const expression = initializer && Node.isJsxExpression(initializer) ? initializer.getExpression() : undefined;
    if (!expression) continue;
    const references = Node.isIdentifier(expression) || Node.isPropertyAccessExpression(expression) ? [expression]
      : expression.getDescendants().filter((item) => Node.isIdentifier(item) || Node.isPropertyAccessExpression(item));
    for (const reference of references) {
      const target = targetId(reference, candidates, ids);
      if (target) push({ relation: "reference", name: reference.getText(), targetId: target, line: attribute.getStartLineNumber(), evidence: evidence(attribute), confidence: "confirmed" });
    }
  }
  return relations;
}

function routePattern(filePath: string): RegExp | undefined {
  const parts = normalizePath(filePath).split("/");
  const appIndex = parts.lastIndexOf("app");
  if (appIndex < 0 || !/^route\.[jt]sx?$/.test(parts.at(-1) ?? "")) return undefined;
  const routeParts = parts.slice(appIndex + 1, -1).filter((part) => !/^\(.*\)$/.test(part) && !part.startsWith("@"));
  if (routeParts[0] !== "api") return undefined;
  const pattern = routeParts.map((part) => {
    if (/^\[\[\.\.\.[^/]+\]\]$/.test(part)) return ".*";
    if (/^\[\.\.\.[^/]+\]$/.test(part)) return ".+";
    if (/^\[[^/]+\]$/.test(part)) return "[^/]+";
    return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("/");
  return new RegExp(`^/${pattern}/?$`);
}
function connectApiRequests(files: FileAnalysis[]): void {
  const routes = files.flatMap((file) => {
    const pattern = routePattern(file.path);
    return pattern ? file.functions.filter((fn) => fn.nodeType === "api").map((fn) => ({ fn, pattern })) : [];
  });
  for (const fn of files.flatMap((file) => file.functions)) for (const relation of fn.relations ?? []) {
    if (relation.relation !== "api" || !relation.requestPath || !relation.requestMethod) continue;
    const pathname = relation.requestPath.split(/[?#]/, 1)[0];
    relation.targetId = routes.find(({ fn: route, pattern }) => route.name === relation.requestMethod && pattern.test(pathname))?.fn.id;
  }
}

export function analyzeSourceFiles(inputs: SourceInput[], repository = "sample-repository"): RepositoryAnalysis {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: true, jsx: 2, target: ScriptTarget.ESNext, moduleResolution: 2 }, skipAddingFilesFromTsConfig: true });
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
      ids.set(item, symbolNodeId(filePath, item.qualifiedName));
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
  connectApiRequests(files);
  const graph = buildGraph(files);
  const functionRelations = files.flatMap((file) => file.functions.flatMap((fn) => (fn.relations ?? []).map((relation) => ({ fn, relation }))));
  const unresolvedRelations = functionRelations.filter(({ fn, relation }) => !graph.edges.some((edge) =>
    edge.source === fn.id && edge.relation === relation.relation && edge.line === relation.line,
  ));
  return {
    repository,
    files,
    ...graph,
    stats: {
      files: files.length,
      functions: files.flatMap((file) => file.functions).length,
      relations: graph.edges.length,
      unresolvedRelations: unresolvedRelations.length,
      unmatchedApiRequests: unresolvedRelations.filter(({ relation }) => relation.relation === "api").length,
    },
  };
}
