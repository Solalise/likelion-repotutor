import { Node, type SourceFile } from "ts-morph";
import type { RepositoryEntryPoint } from "@/types/analysis";

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

function location(path: string) {
  const parts = path.split("/");
  const index = parts.indexOf("app");
  if (index < 0) return undefined;
  const directory = parts.slice(0, index + 1).join("/");
  const root = parts.slice(0, parts[index - 1] === "src" ? index - 1 : index).join("/");
  const segments = parts.slice(index + 1, -1);
  if (segments.some((part) => part.startsWith("_") || part.startsWith("@") || /^\(\.{1,3}\)/.test(part))) return undefined;
  const routeSegments = segments.filter((part) => !/^\([^/]+\)$/.test(part));
  return { directory, root, routePath: `/${routeSegments.join("/")}`, leaf: parts.at(-1)! };
}

function runtimeExport(file: SourceFile, name: string, visited = new Set<string>()): boolean {
  const key = `${file.getFilePath()}:${name}`;
  if (visited.has(key)) return false;
  visited.add(key);
  if (name === "default" && file.getExportAssignments().some((assignment) => !assignment.isExportEquals())) return true;
  if (file.getFunctions().some((fn) => fn.isExported() && (fn.isDefaultExport() ? name === "default" : fn.getName() === name))) return true;
  if (file.getVariableStatements().some((statement) => statement.isExported()
    && statement.getDeclarations().some((declaration) => declaration.getName() === name))) return true;
  return file.getExportDeclarations().some((declaration) => {
    if (declaration.isTypeOnly() || declaration.getNamespaceExport()) return false;
    const named = declaration.getNamedExports();
    const target = declaration.getModuleSpecifierSourceFile();
    if (named.length === 0) return name !== "default" && target ? runtimeExport(target, name, visited) : false;
    return named.some((specifier) => !specifier.isTypeOnly()
      && (specifier.getAliasNode()?.getText() ?? specifier.getName()) === name
      && (!declaration.getModuleSpecifier() || (target && runtimeExport(target, specifier.getName(), visited))));
  });
}

/** Server-only metadata extraction; never guess a page from its function name. */
export function collectEntryPointMetadata(
  sources: Array<{ path: string; sourceFile: SourceFile }>, resolve: (node: Node) => string | undefined,
): RepositoryEntryPoint[] {
  const locations = sources.map(({ path }) => location(path));
  const nextDirectories = new Set(locations.flatMap((item) => item && /^(?:page|route)\.[jt]sx?$/.test(item.leaf) ? [item.directory] : []));
  return sources.flatMap(({ path, sourceFile }, index) => {
    const item = locations[index];
    if (!item) return [];
    if (item.directory !== [item.root, "app"].filter(Boolean).join("/")
      && locations.some((other) => other?.root === item.root && other.directory === [item.root, "app"].filter(Boolean).join("/"))) return [];
    const api = /^route\.[jt]sx?$/.test(item.leaf);
    const page = /^page\.[jt]sx?$/.test(item.leaf);
    // Retain the app/**/index.tsx file-route shape already used by the mobile demo repository.
    const legacyIndex = !nextDirectories.has(item.directory) && /^index\.[jt]sx?$/.test(item.leaf);
    if (!api && !page && !legacyIndex) return [];
    const exported = sourceFile.getExportedDeclarations();
    return [...exported].flatMap(([name, declarations]) => {
      if ((api ? !METHODS.has(name) : name !== "default") || !runtimeExport(sourceFile, name)) return [];
      const ids = new Set(declarations.flatMap((node) => resolve(Node.isExportAssignment(node) ? node.getExpression() : node) ?? []));
      if (ids.size !== 1) return [];
      return [{ kind: api ? "api" as const : "page" as const, framework: legacyIndex ? "app-index" as const : "next-app" as const,
        filePath: path, routePath: item.routePath, method: api ? name : undefined, nodeId: [...ids][0] }];
    });
  });
}
