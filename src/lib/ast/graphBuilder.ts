import path from "node:path";
import type { CodeEdge, CodeNode, FileAnalysis, FunctionInfo } from "@/types/analysis";
import { fileNodeId, normalizePath, symbolNodeId, withoutExtension } from "./pathUtils";

function resolveImportPath(currentFile: string, moduleSpecifier: string, knownPaths: string[]): string | undefined {
  if (!moduleSpecifier.startsWith(".") && !moduleSpecifier.startsWith("@/")) return undefined;

  const bases = moduleSpecifier.startsWith("@/")
    ? aliasBases(currentFile, moduleSpecifier.slice(2))
    : [normalizePath(path.posix.join(path.posix.dirname(currentFile), moduleSpecifier))];

  for (const base of bases) {
    const normalizedBase = withoutExtension(base).replace(/\/index$/, "");
    const match = knownPaths.find((candidate) => {
      const normalizedCandidate = withoutExtension(candidate);
      return normalizedCandidate === normalizedBase || normalizedCandidate === `${normalizedBase}/index`;
    });
    if (match) return match;
  }
  return undefined;
}

function aliasBases(currentFile: string, aliasPath: string): string[] {
  const normalized = normalizePath(currentFile);
  const roots = new Set<string>();
  const srcMarker = normalized.indexOf("/src/");
  const appMarker = normalized.indexOf("/app/");
  if (srcMarker >= 0) roots.add(normalized.slice(0, srcMarker));
  if (appMarker >= 0) roots.add(normalized.slice(0, appMarker));
  if (normalized.startsWith("src/")) roots.add("");
  if (normalized.startsWith("app/")) roots.add("");

  return [
    ...[...roots].map((root) => normalizePath(path.posix.join(root, "src", aliasPath))),
    normalizePath(path.posix.join("src", aliasPath)),
    normalizePath(aliasPath),
  ];
}

function toNode(item: FunctionInfo): CodeNode {
  return {
    id: item.id,
    type: item.nodeType,
    name: item.name,
    filePath: item.filePath,
    line: item.line,
    endLine: item.endLine,
    sourceCode: item.sourceCode,
  };
}

export function buildGraph(files: FileAnalysis[]): { nodes: CodeNode[]; edges: CodeEdge[] } {
  const knownPaths = files.map((file) => normalizePath(file.path));
  const functions = files.flatMap((file) => file.functions);
  const functionById = new Map(functions.map((item) => [item.id, item]));
  const nodes: CodeNode[] = [
    ...files.map((file) => ({ id: fileNodeId(file.path), type: "file" as const, name: file.name, filePath: file.path, sourceCode: file.sourceCode, line: 1, endLine: file.sourceCode.split("\n").length })),
    ...functions.map(toNode),
  ];
  const edges: CodeEdge[] = [];

  for (const file of files) {
    for (const imported of file.imports) {
      const targetPath = resolveImportPath(file.path, imported.source, knownPaths);
      if (!targetPath) continue;
      edges.push({
        id: `import:${file.path}->${targetPath}`,
        source: fileNodeId(file.path),
        target: fileNodeId(targetPath),
        relation: "import",
      });
    }

    const imports = new Map<string, string>();
    for (const imported of file.imports) {
      const targetPath = resolveImportPath(file.path, imported.source, knownPaths);
      if (!targetPath) continue;
      for (const symbol of imported.symbols) imports.set(symbol, targetPath);
    }

    for (const fn of file.functions) {
      if (fn.parentId && functionById.has(fn.parentId)) {
        edges.push({
          id: `reference:${fn.parentId}->${fn.id}`,
          source: fn.parentId,
          target: fn.id,
          relation: "reference",
        });
      }
      const addRelations = (names: string[], relation: CodeEdge["relation"]): void => {
        for (const calledName of names) {
          const localId = symbolNodeId(file.path, calledName);
          const importedPath = imports.get(calledName);
          const targetId = functionById.has(localId)
            ? localId
            : importedPath
              ? symbolNodeId(importedPath, calledName)
              : undefined;
          if (!targetId || !functionById.has(targetId)) continue;
          edges.push({
            id: `${relation}:${fn.id}->${targetId}`,
            source: fn.id,
            target: targetId,
            relation,
          });
        }
      };
      addRelations(fn.calls, "call");
      addRelations(fn.componentReferences, "component");
      addRelations(fn.callbackReferences, "reference");
    }
  }

  return {
    nodes,
    edges: [...new Map(edges.map((edge) => [edge.id, edge])).values()],
  };
}
