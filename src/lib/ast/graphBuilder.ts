import path from "node:path";
import type { CodeEdge, CodeNode, FileAnalysis, FunctionInfo } from "@/types/analysis";
import { fileNodeId, normalizePath, withoutExtension } from "./pathUtils";

export function resolveImportPath(currentFile: string, moduleSpecifier: string, knownPaths: string[]): string | undefined {
  if (!moduleSpecifier.startsWith(".") && !moduleSpecifier.startsWith("@/")) return undefined;

  const bases = moduleSpecifier.startsWith("@/")
    ? aliasBases(currentFile, moduleSpecifier.slice(2))
    : [normalizePath(path.posix.join(path.posix.dirname(currentFile), moduleSpecifier))];

  for (const base of bases) {
    const stem = withoutExtension(base);
    const explicitTypeScript = /\.tsx?$/.test(base);
    const candidates = explicitTypeScript ? [base] : [
      ...[".ts", ".tsx", ".js", ".jsx"].map((extension) => `${stem}${extension}`),
      ...(!/\.[jt]sx?$/.test(base) ? [".ts", ".tsx", ".js", ".jsx"].map((extension) => `${base}/index${extension}`) : []),
    ];
    const match = candidates.find((candidate) => knownPaths.includes(candidate));
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

  if (roots.size === 0) roots.add(normalized.match(/^(?:apps|packages)\/[^/]+/)?.[0] ?? "");
  return [...roots].flatMap((root) => [
    normalizePath(path.posix.join(root, "src", aliasPath)),
    normalizePath(path.posix.join(root, aliasPath)),
  ]);
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
        line: imported.line,
        evidence: `import from ${JSON.stringify(imported.source)}`,
        confidence: "confirmed",
      });
    }

    for (const fn of file.functions) {
      // A declaration is not a reference. Only emit targets resolved by the AST.
      // Name-only fallback would bypass lexical shadowing and the new scoped IDs.
      for (const relation of fn.relations ?? []) {
        const target = relation.targetId;
        if (!target || !functionById.has(target)) continue;
        edges.push({
          id: `${relation.relation}:${fn.id}->${target}:${relation.line}`,
          source: fn.id,
          target,
          relation: relation.relation,
          line: relation.line,
          evidence: relation.evidence,
          confidence: relation.confidence,
        });
      }
    }
  }

  return {
    nodes,
    edges: [...new Map(edges.map((edge) => [edge.id, edge])).values()],
  };
}
