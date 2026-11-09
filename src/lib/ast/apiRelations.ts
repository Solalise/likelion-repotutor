import { Node, SyntaxKind, type CallExpression, type SourceFile } from "ts-morph";
import type { FileAnalysis, FunctionRelation } from "@/types/analysis";
import { normalizePath } from "./pathUtils";

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const AXIOS_METHOD = /^(get|post|put|patch|delete|head|options)$/i;

function staticString(node: Node | undefined): string | undefined {
  if (node && (Node.isParenthesizedExpression(node) || Node.isAsExpression(node))) return staticString(node.getExpression());
  return node && (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) ? node.getLiteralValue() : undefined;
}

/** Unknown options, spreads and computed keys can change otherwise literal fields. */
function field(object: Node | undefined, name: string): { known: boolean; value?: Node } {
  if (!object) return { known: true };
  if (!Node.isObjectLiteralExpression(object)) return { known: false };
  let value: Node | undefined;
  for (const property of object.getProperties()) {
    if (Node.isSpreadAssignment(property)) return { known: false };
    const key = property.getNameNode();
    if (Node.isComputedPropertyName(key)) return { known: false };
    if ((staticString(key) ?? key.getText()) !== name) continue;
    if (!Node.isPropertyAssignment(property)) return { known: false };
    value = property.getInitializer();
  }
  return { known: true, value };
}

function requestMethod(options: Node | undefined): string | undefined {
  const method = field(options, "method");
  if (!method.known) return undefined;
  return method.value ? staticString(method.value)?.toUpperCase() : "GET";
}

function isAxiosImport(node: Node): boolean {
  if (!Node.isIdentifier(node)) return false;
  return (node.getSymbol()?.getDeclarations() ?? []).some((declaration) => {
    // Only the default axios client has known URL/method semantics here.
    if (Node.isImportClause(declaration)) {
      return declaration.getDefaultImport()?.getText() === node.getText()
        && declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)?.getModuleSpecifierValue() === "axios";
    }
    if (Node.isImportSpecifier(declaration) && declaration.getName() === "default") {
      return declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)?.getModuleSpecifierValue() === "axios";
    }
    return false;
  });
}

function localPath(value: string | undefined): string | undefined {
  if (!value?.startsWith("/") || value.startsWith("//")) return undefined;
  const pathname = value.split(/[?#]/, 1)[0];
  if (/[\\\s\u0000-\u001f]/.test(pathname) || pathname.includes("//")) return undefined;
  try {
    if (pathname.split("/").some((part) => [".", ".."].includes(decodeURIComponent(part)))) return undefined;
    decodeURIComponent(pathname);
  } catch { return undefined; }
  return pathname;
}

export function analyzeApiRequest(call: CallExpression): FunctionRelation | undefined {
  const expression = call.getExpression();
  const args = call.getArguments();
  let path: string | undefined;
  let method: string | undefined;
  let transportKnown = false;
  if (Node.isIdentifier(expression) && expression.getText() === "fetch") {
    path = staticString(args[0]);
    method = requestMethod(args[1]);
    // A local/imported function named fetch is not necessarily the platform API.
    transportKnown = !(expression.getSymbol()?.getDeclarations() ?? []).some((declaration) => !declaration.getSourceFile().isDeclarationFile());
  } else if (Node.isPropertyAccessExpression(expression) && AXIOS_METHOD.test(expression.getName())) {
    const client = expression.getExpression();
    if (!isAxiosImport(client) && !/(?:axios|client|api)$/i.test(client.getText())) return undefined;
    path = staticString(args[0]);
    method = expression.getName().toUpperCase();
    const config = args[/^(POST|PUT|PATCH)$/.test(method) ? 2 : 1];
    transportKnown = isAxiosImport(client) && ["baseURL", "url", "method"].every((name) => {
      const property = field(config, name);
      return property.known && !property.value;
    });
  } else if (isAxiosImport(expression) || (Node.isIdentifier(expression) && /axios$/i.test(expression.getText()))) {
    const config = args[0];
    const url = field(config, "url");
    path = url.known ? staticString(url.value) : undefined;
    method = requestMethod(config);
    const base = field(config, "baseURL");
    transportKnown = isAxiosImport(expression) && base.known && !base.value;
  } else return undefined;
  return {
    relation: "api", name: `${method ?? "?"} ${path ?? args[0]?.getText() ?? "?"}`,
    line: call.getStartLineNumber(), evidence: call.getText().replace(/\s+/g, " ").slice(0, 240),
    confidence: transportKnown && localPath(path) && method && METHODS.has(method) ? "confirmed" : "inferred",
    requestPath: path, requestMethod: method,
  };
}

interface Application { root: string; directory: string }
function application(filePath: string): Application | undefined {
  const parts = normalizePath(filePath).split("/");
  const appIndex = parts.indexOf("app");
  if (appIndex < 0) return undefined;
  const rootParts = parts.slice(0, appIndex);
  if (rootParts.at(-1) === "src") rootParts.pop();
  return { root: rootParts.join("/"), directory: parts.slice(0, appIndex + 1).join("/") };
}

interface Route {
  app: Application;
  pattern: RegExp;
  specificity: number[];
  handlers: Map<string, string>;
}

function route(filePath: string): Omit<Route, "handlers"> | undefined {
  if (!/(?:^|\/)route\.[jt]sx?$/.test(filePath)) return undefined;
  const app = application(filePath);
  if (!app) return undefined;
  const raw = normalizePath(filePath).slice(app.directory.length + 1).split("/").slice(0, -1);
  if (raw.some((part) => part.startsWith("_") || part.startsWith("@") || /^\(\.{1,3}\)/.test(part))) return undefined;
  const parts = raw.filter((part) => !/^\([^/]+\)$/.test(part));
  const specificity: number[] = [];
  let pattern = "^";
  for (const [index, part] of parts.entries()) {
    if (/^\[\[\.\.\.[^\[\]]+\]\]$/.test(part)) {
      if (index !== parts.length - 1) return undefined;
      pattern += "(?:/(?:[^/]+)(?:/[^/]+)*)?"; specificity.push(1);
    } else if (/^\[\.\.\.[^\[\]]+\]$/.test(part)) {
      if (index !== parts.length - 1) return undefined;
      pattern += "/[^/]+(?:/[^/]+)*"; specificity.push(2);
    } else if (/^\[[^\[\]]+\]$/.test(part)) {
      pattern += "/[^/]+"; specificity.push(3);
    } else {
      if (/[\[\]]/.test(part)) return undefined;
      pattern += `/${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`; specificity.push(4);
    }
  }
  return { app, pattern: new RegExp(`${pattern}/?$`), specificity };
}

function compareRoutes(a: Route, b: Route): number {
  for (let index = 0; index < Math.max(a.specificity.length, b.specificity.length); index++) {
    const difference = (b.specificity[index] ?? 5) - (a.specificity[index] ?? 5);
    if (difference) return difference;
  }
  return 0;
}

function callerApp(filePath: string, applications: Application[]): string | undefined {
  const own = application(filePath);
  if (own) return own.root;
  const workspace = filePath.match(/^(?:apps|packages)\/[^/]+/)?.[0];
  const candidates = applications.filter(({ root }) => root ? filePath.startsWith(`${root}/`) : !workspace)
    .sort((a, b) => b.root.length - a.root.length);
  return candidates[0]?.root;
}

function hasRuntimeExport(file: SourceFile, name: string, visited = new Set<string>()): boolean {
  const key = `${file.getFilePath()}:${name}`;
  if (visited.has(key)) return false;
  visited.add(key);
  if (file.getFunctions().some((fn) => fn.isExported() && fn.getName() === name)) return true;
  if (file.getVariableStatements().some((statement) => statement.isExported()
    && statement.getDeclarations().some((declaration) => declaration.getName() === name))) return true;
  return file.getExportDeclarations().some((declaration) => {
    if (declaration.isTypeOnly() || declaration.getNamespaceExport()) return false;
    const named = declaration.getNamedExports();
    const target = declaration.getModuleSpecifierSourceFile();
    if (named.length === 0) return target ? hasRuntimeExport(target, name, visited) : false;
    return named.some((specifier) => !specifier.isTypeOnly()
      && (specifier.getAliasNode()?.getText() ?? specifier.getName()) === name
      && (!declaration.getModuleSpecifier() || (target && hasRuntimeExport(target, specifier.getName(), visited))));
  });
}

export function connectApiRequests(
  files: FileAnalysis[], sources: Array<{ path: string; sourceFile: SourceFile }>,
  resolveDeclaration: (node: Node) => string | undefined,
): void {
  const applications = sources.flatMap(({ path }) => application(path) ?? []);
  const routes = sources.flatMap(({ path, sourceFile }) => {
    const descriptor = route(path);
    if (!descriptor) return [];
    // Next.js uses root app/ instead of src/app/ when both exist.
    if (descriptor.app.directory.endsWith("src/app") && applications.some((app) => app.root === descriptor.app.root && app.directory === [app.root, "app"].filter(Boolean).join("/"))) return [];
    const handlers = new Map<string, string>();
    for (const [method, declarations] of sourceFile.getExportedDeclarations()) {
      if (!METHODS.has(method) || !hasRuntimeExport(sourceFile, method)) continue;
      const ids = new Set(declarations.flatMap((node) => resolveDeclaration(node) ?? []));
      if (ids.size === 1) handlers.set(method, [...ids][0]);
    }
    return [{ ...descriptor, handlers }];
  });
  for (const fn of files.flatMap((file) => file.functions)) for (const relation of fn.relations ?? []) {
    if (relation.relation !== "api") continue;
    const eligible = relation.confidence === "confirmed";
    relation.targetId = undefined;
    relation.confidence = "inferred";
    const pathname = localPath(relation.requestPath);
    const app = callerApp(fn.filePath, applications);
    if (!eligible || !pathname || app === undefined || !relation.requestMethod) continue;
    // Select the URL's route before checking its method; a 405 is not a dynamic fallback.
    const matches = routes.filter((candidate) => candidate.app.root === app && candidate.pattern.test(pathname)).sort(compareRoutes);
    if (!matches[0] || (matches[1] && compareRoutes(matches[0], matches[1]) === 0)) continue;
    const target = matches[0].handlers.get(relation.requestMethod);
    if (!target) continue;
    relation.targetId = target;
    relation.confidence = "confirmed";
  }
}
