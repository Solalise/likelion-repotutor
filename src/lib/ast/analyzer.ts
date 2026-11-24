import path from "node:path";
import { Node, Project, ScriptTarget, SyntaxKind, ts, type SourceFile } from "ts-morph";
import type { ScanDiagnostic } from "@/types/scanCoverage";
import type { FileAnalysis, FunctionInfo, FunctionRelation, RepositoryAnalysis, SourceInput } from "@/types/analysis";
import { buildGraph, resolveImportPath } from "./graphBuilder";
import { analyzeImport } from "./importAnalyzer";
import { analyzeApiRequest, connectApiRequests } from "./apiRelations";
import { collectEntryPointMetadata } from "@/lib/features/entryPointMetadata";
import { normalizePath, symbolNodeId } from "./pathUtils";
import { collectReactEventBindings } from "./reactEventBindings";
import { extractFunctionControlFlow } from "./controlFlowExtractor";
import { collectHttpRequests } from "./httpRequests";
import { collectDatabaseAccess } from "./databaseAccess";
import { collectServerResponses } from "./serverResponses";
import { collectSqlInjection } from "./sqlInjection";
import { collectXss } from "./xss";
import { collectAccessControl, failedAccessControlAnalysis } from "./accessControl";
import { relationKind } from "./relationDiagnostics";
import { collectNextInputs } from "./nextInputs";
import { identifyTechnology } from "@/lib/repository/technologyStack";
import type { PackageManifest } from "@/types/technology";

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
      relation: "call", name: relationName(expression, aliases), targetId: target, diagnosticKind: target ? undefined : relationKind(expression),
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
    push({ relation: "component", name: tag.getText().split(".").at(-1) ?? tag.getText(), targetId: target, diagnosticKind: target ? undefined : relationKind(tag, true), line: element.getStartLineNumber(), evidence: evidence(element), confidence: target ? "confirmed" : "inferred" });
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

export function analyzeSourceFiles(inputs: SourceInput[], repository = "sample-repository", manifests: PackageManifest[] = []): RepositoryAnalysis {
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
  const sourceFiles = inputs.filter((input) => /\.(?:tsx?|jsx?)$/i.test(input.path)).map((input) => {
    const normalized = normalizePath(input.path);
    return { path: normalized, sourceFile: project.createSourceFile(`/${normalized}`, input.content, { overwrite: true, scriptKind: /tsx$/i.test(normalized) ? ts.ScriptKind.TSX : /jsx$/i.test(normalized) ? ts.ScriptKind.JSX : /js$/i.test(normalized) ? ts.ScriptKind.JS : ts.ScriptKind.TS }) };
  });
  project.resolveSourceFileDependencies();
  const diagnostics: ScanDiagnostic[] = inputs.filter(input => !/\.(?:tsx?|jsx?)$/i.test(input.path)).map(input => ({ filePath: input.path, line: 1, code: "", message: "미지원 언어: JS/TS만 분석합니다.", kind: "unsupported" }));
  for (const { path: filePath, sourceFile } of sourceFiles) {
    for (const diagnostic of project.getProgram().compilerObject.getSyntacticDiagnostics(sourceFile.compilerNode)) {
      const start = diagnostic.start ?? 0;
      diagnostics.push({ filePath, line: sourceFile.getLineAndColumnAtPos(start).line, code: sourceFile.getFullText().slice(start, start + 100), message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "), kind: "parse" });
    }
    for (const declaration of sourceFile.getImportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      if ((specifier.startsWith(".") || specifier.startsWith("@/")) && !declaration.getModuleSpecifierSourceFile()) diagnostics.push({ filePath, line: declaration.getStartLineNumber(), code: declaration.getText(), message: "수집 범위에서 로컬 import를 해결하지 못했습니다.", kind: "unresolved" });
    }
  }
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
  const reactEventBindings = collectReactEventBindings(sourceFiles, {
    resolveTarget: node => targetId(node, candidates, ids),
    resolveOwner: node => { const candidate = enclosingCandidate(node, candidates); return candidate ? ids.get(candidate) : undefined; },
  });
  const functionsById = new Map(files.flatMap(file => file.functions).map(fn => [fn.id, fn]));
  const functionControlFlows = [...ids].map(([candidate, id]) => extractFunctionControlFlow(candidate.node, functionsById.get(id)!, {
    edges: graph.edges, resolveTarget: node => targetId(node, candidates, ids),
    resolveOwner: node => { const owner = enclosingCandidate(node, candidates); return owner ? ids.get(owner) : undefined; },
  }));
  const functionRelations = files.flatMap((file) => file.functions.flatMap((fn) => (fn.relations ?? []).map((relation) => ({ fn, relation }))));
  const unresolvedRelations = functionRelations.filter(({ fn, relation }) => !graph.edges.some((edge) =>
    edge.source === fn.id && edge.target === relation.targetId && edge.relation === relation.relation && edge.line === relation.line,
  ));
  const entryPoints = collectEntryPointMetadata(sourceFiles, (node) => targetId(node, candidates, ids));
  const nextInputs = collectNextInputs(sourceFiles, entryPoints, node => { const candidate = enclosingCandidate(node, candidates); return candidate ? ids.get(candidate) : undefined; });
  const httpRequests = collectHttpRequests(sourceFiles, node => targetId(node, candidates, ids),
    node => { const owner = enclosingCandidate(node, candidates); return owner ? ids.get(owner) : undefined; }, entryPoints, functionControlFlows);
  const databaseAccess = collectDatabaseAccess(sourceFiles, {
    definitions: new Map([...ids].map(([candidate, id]) => [id, candidate.node])), files, edges: graph.edges, entries: entryPoints,
    controlFlows: functionControlFlows, resolveTarget: node => targetId(node, candidates, ids),
    resolveOwner: node => { const owner = enclosingCandidate(node, candidates); return owner ? ids.get(owner) : undefined; },
  });
  const serverResponses = collectServerResponses(sourceFiles, { entries: entryPoints, controlFlows: functionControlFlows, database: databaseAccess,
    resolveOwner: node => { const owner = enclosingCandidate(node, candidates); return owner ? ids.get(owner) : undefined; },
  });
  for (const { path: filePath, sourceFile } of sourceFiles) {
    if (/(?:^|\/)pages\/api\//.test(filePath) || sourceFile.getImportDeclarations().some(d => /^(?:express|fastify|koa)$/.test(d.getModuleSpecifierValue()))) diagnostics.push({ filePath, line: 1, code: "", kind: "unsupported", message: "API 프레임워크 의미 미지원: Next App Route Handler 외 요청·API 연결은 확정하지 않습니다." });
  }
  const definitions = new Map([...ids].map(([candidate, id]) => [id, candidate.node]));
  const callers = new Map<string, import("ts-morph").CallExpression[]>();
  const callTargets = new Map<Node, string>();
  const callSites = new Map(functionControlFlows.flatMap(flow => flow.callSites).map(site =>
    [`${site.location.filePath}:${site.location.startOffset}`, site]));
  for (const { sourceFile } of sourceFiles) for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const site = callSites.get(`${sourceFile.getFilePath().replace(/^\//, "")}:${call.getStart()}`);
    if (site?.targetResolution === "resolved" && site.targetNodeId && !site.inUnsupportedRegion) {
      callTargets.set(call.getExpression(), site.targetNodeId);
      callers.set(site.targetNodeId, [...(callers.get(site.targetNodeId) ?? []), call]);
    }
  }
  const traceContext = { entries: entryPoints, definitions, callers, nextInputs, resolveTarget: (node: Node) => callTargets.get(node),
    resolveOwner: (node: Node) => { const owner = enclosingCandidate(node, candidates); return owner ? ids.get(owner) : undefined; } };
  const guarded = <T,>(work: () => T, fallback: T): T => { try { return work(); } catch { return fallback; } };
  const failedCoverage = (name: string) => ({ status: "failed" as const, inputs: [], sinks: [], connectedSinks: 0, suspectedCandidates: 0,
    diagnostics: [{ filePath: "", line: 1, code: "", kind: "unsupported" as const, message: `${name} 분석에 실패했습니다. 후보 유무를 판단하지 못했습니다.` }] });
  const analysis: RepositoryAnalysis = {
    scannerRevision: "repository-security-3", diagnostics, technology: identifyTechnology(files, manifests), serverActions: nextInputs.actions,
    repository,
    files,
    ...graph,
    reactEventBindings,
    functionControlFlows,
    entryPoints,
    httpRequests,
    databaseAccess,
    serverResponses,
    sqlInjection: guarded(() => collectSqlInjection(sourceFiles, {
      ...traceContext,
      resolveOwner: node => { const owner = enclosingCandidate(node, candidates); return owner ? ids.get(owner) : undefined; },
    }), { version: "sqli-static-v1", findings: [], truncated: false, limitations: [], coverage: failedCoverage("SQL Injection") }),
    xss: guarded(() => collectXss(sourceFiles, {
      ...traceContext, responses: serverResponses,
      resolveOwner: node => { const owner = enclosingCandidate(node, candidates); return owner ? ids.get(owner) : undefined; },
    }), { version: "xss-static-v1", findings: [], truncated: false, limitations: [], coverage: failedCoverage("XSS") }),
    stats: {
      files: files.length,
      functions: files.flatMap((file) => file.functions).length,
      relations: graph.edges.length,
      unresolvedRelations: unresolvedRelations.length,
      unmatchedApiRequests: unresolvedRelations.filter(({ relation }) => relation.relation === "api").length,
    },
  };
  try {
    analysis.accessControl = collectAccessControl(sourceFiles, {
      analysis, nextInputs, definitions: new Map([...ids].map(([candidate, id]) => [id, candidate.node])),
      resolveOwner: node => { const owner = enclosingCandidate(node, candidates); return owner ? ids.get(owner) : undefined; },
    });
  } catch {
    // This additive review must never discard the existing SQLi/XSS/graph results.
    analysis.accessControl = failedAccessControlAnalysis();
  }
  if (analysis.accessControl.status !== "failed") {
    if (!entryPoints.some(entry => entry.kind === "api" && entry.framework === "next-app") && !analysis.accessControl.findings.length && !nextInputs.actions.length) analysis.accessControl.status = "unsupported";
    else if (diagnostics.length && analysis.accessControl.status === "completed") analysis.accessControl.status = "partial";
  }
  // Existing resolved call edges provide API context, not a new runtime/taint claim.
  for (const finding of [...(analysis.sqlInjection?.findings ?? []), ...(analysis.xss?.findings ?? [])]) {
    const owner = files.flatMap(file => file.functions).filter(fn => fn.filePath === finding.filePath && fn.line <= finding.line && fn.endLine >= finding.endLine)
      .sort((a, b) => a.endLine - a.line - (b.endLine - b.line))[0];
    const reachable = new Set<string>();
    const walk = (id: string, depth: number) => {
      if (depth > 4 || reachable.has(id)) return;
      reachable.add(id);
      for (const edge of graph.edges.filter(e => e.target === id && e.relation === "call")) walk(edge.source, depth + 1);
    };
    if (owner) walk(owner.id, 0);
    finding.apiContexts = entryPoints.filter(e => e.kind === "api" && e.method && reachable.has(e.nodeId))
      .map(e => ({ path: e.routePath, method: e.method!, filePath: e.filePath, relation: "confirmed-call-path" }));
  }
  for (const report of [analysis.sqlInjection, analysis.xss]) if (report?.coverage && diagnostics.length && report.coverage.status !== "failed") report.coverage.status = sourceFiles.length ? "partial" : "unsupported";
  return analysis;
}
