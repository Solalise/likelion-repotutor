import type { CodeEdge, RepositoryAnalysis, RepositoryFeature } from "@/types/analysis";
import type { RepositoryOverviewEdge, RepositoryOverviewGraph, RepositoryOverviewNode, OverviewRelation } from "@/types/overview";

const MAX_MODULES = 24;
const MAX_FILES_PER_MODULE = 16;
const MAX_SYMBOLS_PER_FILE = 20;
const MAX_EDGES = 120;

function modulePath(filePath: string): string {
  const parts = filePath.split("/");
  const featureIndex = parts.findIndex((part) => /^(?:features?|modules?|packages?)$/i.test(part));
  if (featureIndex >= 0 && parts[featureIndex + 1]) return parts.slice(0, featureIndex + 2).join("/");
  const sharedIndex = parts.findIndex((part) => /^(?:components?|services?|utils?|lib|hooks?|api)$/i.test(part));
  if (sharedIndex >= 0) return parts.slice(0, sharedIndex + 1).join("/");
  const appIndex = parts.findIndex((part) => /^(?:app|pages|routes?)$/i.test(part));
  if (appIndex >= 0) return parts.slice(0, Math.min(parts.length - 1, appIndex + 3)).join("/");
  return parts.slice(0, Math.min(2, Math.max(1, parts.length - 1))).join("/");
}

function moduleId(moduleName: string): string { return `overview:module:${moduleName}`; }
function overviewFileId(filePath: string): string { return `overview:file:${filePath}`; }
function overviewSymbolId(codeNodeId: string): string { return `overview:symbol:${codeNodeId}`; }

function titleFromPath(value: string): string {
  return value.split("/").at(-1)?.replace(/[-_]+/g, " ") ?? value;
}

function aggregateEdge(map: Map<string, RepositoryOverviewEdge>, source: string, target: string, relation: OverviewRelation): void {
  if (source === target) return;
  const key = `${relation}:${source}->${target}`;
  const current = map.get(key);
  if (current) current.count += 1;
  else map.set(key, { id: `overview:${key}`, source, target, relation, count: 1 });
}

export function buildRepositoryOverview(analysis: RepositoryAnalysis, expandedIds: ReadonlySet<string> = new Set()): RepositoryOverviewGraph {
  const fileModule = new Map(analysis.files.map((file) => [file.path, modulePath(file.path)]));
  const codeNodeMap = new Map(analysis.nodes.map((node) => [node.id, node]));
  const fileSymbols = new Map<string, typeof analysis.nodes>();
  for (const node of analysis.nodes) if (node.type !== "file") fileSymbols.set(node.filePath, [...(fileSymbols.get(node.filePath) ?? []), node]);
  const moduleFiles = new Map<string, typeof analysis.files>();
  for (const file of analysis.files) {
    const moduleName = fileModule.get(file.path)!;
    moduleFiles.set(moduleName, [...(moduleFiles.get(moduleName) ?? []), file]);
  }
  const crossModuleConnections = new Map<string, number>();
  for (const edge of analysis.edges) {
    const sourceNode = codeNodeMap.get(edge.source);
    const targetNode = codeNodeMap.get(edge.target);
    const sourcePath = sourceNode?.filePath ?? (edge.source.startsWith("file:") ? edge.source.slice(5) : undefined);
    const targetPath = targetNode?.filePath ?? (edge.target.startsWith("file:") ? edge.target.slice(5) : undefined);
    const sourceModule = sourcePath ? fileModule.get(sourcePath) : undefined;
    const targetModule = targetPath ? fileModule.get(targetPath) : undefined;
    if (sourceModule && targetModule && sourceModule !== targetModule) {
      crossModuleConnections.set(sourceModule, (crossModuleConnections.get(sourceModule) ?? 0) + 1);
      crossModuleConnections.set(targetModule, (crossModuleConnections.get(targetModule) ?? 0) + 1);
    }
  }
  const modules = [...moduleFiles.keys()].sort((a, b) =>
    (crossModuleConnections.get(b) ?? 0) - (crossModuleConnections.get(a) ?? 0)
      || (moduleFiles.get(b)?.length ?? 0) - (moduleFiles.get(a)?.length ?? 0)
      || a.localeCompare(b)).slice(0, MAX_MODULES);
  const visibleModules = new Set(modules);
  const projectId = `overview:project:${analysis.repository}`;
  const nodes: RepositoryOverviewNode[] = [{
    id: projectId, type: "project", name: analysis.repository, subtitle: `${analysis.files.length}개 파일 · ${analysis.stats.functions}개 함수`,
    fileCount: analysis.files.length, symbolCount: analysis.stats.functions, expandable: false, expanded: true,
  }];
  const edgeMap = new Map<string, RepositoryOverviewEdge>();
  const visibleFilePaths = new Set(modules.flatMap((moduleName) => expandedIds.has(moduleId(moduleName))
    ? (moduleFiles.get(moduleName) ?? []).slice(0, MAX_FILES_PER_MODULE).map((file) => file.path)
    : []));
  const visibleSymbolIds = new Set([...visibleFilePaths].flatMap((filePath) => expandedIds.has(overviewFileId(filePath))
    ? (fileSymbols.get(filePath) ?? []).slice(0, MAX_SYMBOLS_PER_FILE).map((node) => node.id)
    : []));
  const endpointForFile = (filePath: string): string | undefined => {
    const moduleName = fileModule.get(filePath);
    if (!moduleName || !visibleModules.has(moduleName)) return undefined;
    return expandedIds.has(moduleId(moduleName)) && visibleFilePaths.has(filePath) ? overviewFileId(filePath) : moduleId(moduleName);
  };
  const endpointForCodeNode = (nodeId: string, filePath: string): string | undefined => {
    const fileEndpoint = endpointForFile(filePath);
    return fileEndpoint && expandedIds.has(overviewFileId(filePath)) && visibleSymbolIds.has(nodeId) ? overviewSymbolId(nodeId) : fileEndpoint;
  };

  for (const moduleName of modules) {
    const files = moduleFiles.get(moduleName) ?? [];
    const id = moduleId(moduleName);
    const symbolCount = files.reduce((sum, file) => sum + (fileSymbols.get(file.path)?.length ?? 0), 0);
    nodes.push({ id, type: "module", name: titleFromPath(moduleName), subtitle: moduleName, fileCount: files.length, symbolCount, expandable: true, expanded: expandedIds.has(id) });
    aggregateEdge(edgeMap, projectId, id, "contains");
    if (!expandedIds.has(id)) continue;
    for (const file of files.slice(0, MAX_FILES_PER_MODULE)) {
      const fileId = overviewFileId(file.path);
      const symbols = fileSymbols.get(file.path) ?? [];
      nodes.push({ id: fileId, type: "file", name: file.name, subtitle: file.path, filePath: file.path, codeNodeId: `file:${file.path}`, symbolCount: symbols.length, expandable: symbols.length > 0, expanded: expandedIds.has(fileId) });
      aggregateEdge(edgeMap, id, fileId, "contains");
      if (!expandedIds.has(fileId)) continue;
      for (const symbol of symbols.slice(0, MAX_SYMBOLS_PER_FILE)) {
        const symbolId = overviewSymbolId(symbol.id);
        nodes.push({ id: symbolId, type: "symbol", name: symbol.name, subtitle: symbol.type, filePath: symbol.filePath, codeNodeId: symbol.id, expandable: false, expanded: false });
        aggregateEdge(edgeMap, fileId, symbolId, "contains");
      }
    }
  }

  for (const edge of analysis.edges) {
    let source: string | undefined;
    let target: string | undefined;
    if (edge.source.startsWith("file:") && edge.target.startsWith("file:")) {
      source = endpointForFile(edge.source.slice(5));
      target = endpointForFile(edge.target.slice(5));
    } else {
      const sourceNode = codeNodeMap.get(edge.source);
      const targetNode = codeNodeMap.get(edge.target);
      if (sourceNode && targetNode) {
        source = endpointForCodeNode(sourceNode.id, sourceNode.filePath);
        target = endpointForCodeNode(targetNode.id, targetNode.filePath);
      }
    }
    if (source && target) aggregateEdge(edgeMap, source, target, edge.relation as CodeEdge["relation"]);
  }
  const allEdges = [...edgeMap.values()];
  const hiddenNodeCount = Math.max(0, moduleFiles.size - modules.length)
    + modules.reduce((sum, moduleName) => sum + Math.max(0, (moduleFiles.get(moduleName)?.length ?? 0) - MAX_FILES_PER_MODULE), 0)
    + [...visibleFilePaths].reduce((sum, filePath) => sum + (expandedIds.has(overviewFileId(filePath))
      ? Math.max(0, (fileSymbols.get(filePath)?.length ?? 0) - MAX_SYMBOLS_PER_FILE) : 0), 0);
  return { nodes, edges: allEdges.slice(0, MAX_EDGES), truncated: hiddenNodeCount > 0 || allEdges.length > MAX_EDGES, hiddenNodeCount };
}

export function findOverviewFeature(node: RepositoryOverviewNode | undefined, features: RepositoryFeature[]): RepositoryFeature | undefined {
  if (!node) return undefined;
  const candidates = features.filter((feature) => {
    if (node.filePath) return feature.filePaths.includes(node.filePath);
    if (node.type === "module") return feature.filePaths.some((filePath) => filePath === node.subtitle || filePath.startsWith(`${node.subtitle}/`));
    return false;
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}
