import type { CodeEdge, FunctionInfo, FunctionRelation, RepositoryAnalysis, RepositoryEntryPoint } from "@/types/analysis";
import type { BehaviorEvidence } from "@/types/behavior";
import { reactElementKind, reactEventDescriptor } from "@/lib/ast/reactEventRules";

export function behaviorId(kind: string, ...parts: unknown[]): string {
  return `behavior:${kind}:${JSON.stringify(parts)}`;
}

/** Canonical comparisons do not depend on object property insertion order. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** Conflicting duplicate IDs are ambiguous; identical repeated records are harmless. */
export function unambiguousIndex<T>(items: T[], key: (item: T) => string): Map<string, T> {
  const result = new Map<string, T>();
  const ambiguous = new Set<string>();
  for (const item of items) {
    const id = key(item);
    if (ambiguous.has(id)) continue;
    const existing = result.get(id);
    if (existing && canonical(existing) !== canonical(item)) { result.delete(id); ambiguous.add(id); }
    else result.set(id, item);
  }
  return result;
}

export function sameEntry(a: RepositoryEntryPoint, b: RepositoryEntryPoint): boolean {
  return canonical(a) === canonical(b);
}

function sameRelation(a: FunctionRelation, b: FunctionRelation): boolean { return canonical(a) === canonical(b); }
const normalized = (text: string) => text.replace(/\s+/g, " ").trim();

export function createEvidenceMapper(analysis: RepositoryAnalysis) {
  const files = unambiguousIndex(analysis.files, (file) => file.path);
  const nodes = unambiguousIndex(analysis.nodes, (node) => node.id);
  const functions = unambiguousIndex(analysis.files.flatMap(file => file.functions), (fn) => fn.id);
  const edges = unambiguousIndex(analysis.edges, (edge) => edge.id);
  const eventBindings = unambiguousIndex(analysis.reactEventBindings ?? [], item => item.id);
  const lines = new Map([...files].map(([path, file]) => [path, file.sourceCode.split(/\r?\n/)]));

  function declaration(nodeId: string): BehaviorEvidence | undefined {
    const node = nodes.get(nodeId), fn = functions.get(nodeId);
    if (!node || !fn || node.type === "file" || node.filePath !== fn.filePath || node.line !== fn.line
      || node.endLine !== fn.endLine || node.sourceCode !== fn.sourceCode) return undefined;
    const source = lines.get(fn.filePath);
    if (!source || !Number.isInteger(fn.line) || !Number.isInteger(fn.endLine) || fn.line < 1
      || fn.endLine < fn.line || fn.endLine > source.length || !fn.sourceCode.trim()) return undefined;
    const excerpt = source.slice(fn.line - 1, fn.endLine).join("\n");
    const start = normalized(excerpt).indexOf(normalized(fn.sourceCode));
    if (start < 0 || start >= normalized(source[fn.line - 1]).length) return undefined;
    return {
      id: behaviorId("declaration", nodeId),
      location: { filePath: fn.filePath, precision: "range", startLine: fn.line, endLine: fn.endLine },
      excerpt, confidence: "confirmed", sourceNodeIds: [nodeId], sourceEdgeIds: [],
      origin: { kind: "declaration", nodeId },
    };
  }

  function entryPoint(entry: RepositoryEntryPoint): BehaviorEvidence | undefined {
    if (!(analysis.entryPoints ?? []).some(item => sameEntry(item, entry)) || !files.has(entry.filePath)
      || !declaration(entry.nodeId)) return undefined;
    // Metadata has no export location. Re-exports may point to a declaration in another file.
    return {
      id: behaviorId("entry", entry), location: { filePath: entry.filePath, precision: "file" },
      confidence: "confirmed", sourceNodeIds: [entry.nodeId], sourceEdgeIds: [],
      origin: { kind: "entry-point", entryPoint: { ...entry } },
    };
  }

  function relation(sourceId: string, item: FunctionRelation, sourceEdgeIds: string[] = []): BehaviorEvidence | undefined {
    const fn = functions.get(sourceId), source = fn && lines.get(fn.filePath);
    if (!fn || !source || !declaration(sourceId) || !fn.relations?.some(candidate => sameRelation(candidate, item))
      || !Number.isInteger(item.line) || item.line < fn.line || item.line > fn.endLine || !item.evidence.trim()) return undefined;
    const needle = normalized(item.evidence);
    let endLine = item.line;
    while (endLine <= fn.endLine && !normalized(source.slice(item.line - 1, endLine).join("\n")).includes(needle)) endLine++;
    if (endLine > fn.endLine || normalized(source.slice(item.line - 1, endLine).join("\n")).indexOf(needle) >= normalized(source[item.line - 1]).length) return undefined;
    const ids = [...new Set(sourceEdgeIds)].sort();
    if (ids.some(id => {
      const edge = edges.get(id);
      return !edge || !edgeMatchesRelation(edge, sourceId, item);
    })) return undefined;
    return {
      id: behaviorId("relation", sourceId, item),
      location: { filePath: fn.filePath, precision: item.line === endLine ? "line" : "range", startLine: item.line, endLine },
      excerpt: source.slice(item.line - 1, endLine).join("\n"),
      confidence: item.confidence, sourceNodeIds: [sourceId], sourceEdgeIds: ids,
      origin: { kind: "relation", sourceId, relation: { ...item } },
    };
  }

  function edgeEvidence(edge: CodeEdge): BehaviorEvidence[] {
    const fn = functions.get(edge.source);
    if (!fn || !edges.has(edge.id)) return [];
    const occurrences = edge.occurrences ?? [{ edgeId: edge.id, line: edge.line, evidence: edge.evidence, confidence: edge.confidence }];
    return occurrences.flatMap(occurrence => {
      const item = fn.relations?.find(candidate => candidate.targetId === edge.target && candidate.relation === edge.relation
        && candidate.line === occurrence.line && candidate.evidence === occurrence.evidence
        && candidate.confidence === (occurrence.confidence ?? edge.confidence));
      const mapped = item && relation(edge.source, item, [edge.id]);
      return mapped ? [mapped] : [];
    });
  }

  function eventBinding(bindingId: string): BehaviorEvidence | undefined {
    const binding = eventBindings.get(bindingId);
    if (!binding) return undefined;
    const file = files.get(binding.filePath);
    if (!file || !binding.ownerNodeId || !declaration(binding.ownerNodeId)) return undefined;
    const owner = functions.get(binding.ownerNodeId)!;
    const source = file.sourceCode;
    const { startOffset: start, endOffset: end, element } = binding;
    if (![start, end, element.startOffset, element.endOffset].every(Number.isInteger)
      || start < 0 || end <= start || end > source.length || element.startOffset < 0
      || element.endOffset > start || element.endOffset <= element.startOffset
      || source.slice(start, end) !== binding.sourceCode
      || source.slice(element.startOffset, element.endOffset) !== element.name
      || element.kind !== reactElementKind(element.name)
      || binding.id !== `react-event:${JSON.stringify([binding.filePath, start, end])}`) return undefined;
    const line = source.slice(0, start).split("\n").length;
    const endLine = source.slice(0, end).split("\n").length;
    const column = start - source.lastIndexOf("\n", start - 1), endColumn = end - source.lastIndexOf("\n", end - 1);
    if (binding.line !== line || binding.endLine !== endLine || binding.column !== column || binding.endColumn !== endColumn
      || owner.filePath !== binding.filePath || line < owner.line || endLine > owner.endLine) return undefined;
    const descriptor = reactEventDescriptor(binding.eventName);
    if (binding.status === "confirmed" && (binding.reason || binding.confidence !== "confirmed" || element.kind !== "intrinsic"
      || !descriptor || descriptor.type !== binding.eventType || descriptor.phase !== binding.phase
      || !["direct", "inline"].includes(binding.mode) || binding.targetResolution !== "resolved"
      || !binding.targetNodeId || !declaration(binding.targetNodeId))) return undefined;
    return {
      id: behaviorId("event-binding", binding.id),
      location: { filePath: binding.filePath, precision: line === endLine ? "line" : "range", startLine: line, endLine,
        startOffset: start, endOffset: end, startColumn: column, endColumn },
      excerpt: binding.sourceCode, confidence: binding.confidence, sourceNodeIds: [binding.ownerNodeId], sourceEdgeIds: [],
      origin: { kind: "event-binding", binding: structuredClone(binding) },
    };
  }

  return { files, nodes, functions, edges, eventBindings, declaration, entryPoint, relation, edgeEvidence, eventBinding };
}

export function edgeMatchesRelation(edge: CodeEdge, sourceId: string, relation: FunctionRelation): boolean {
  if (edge.source !== sourceId || edge.target !== relation.targetId || edge.relation !== relation.relation) return false;
  return (edge.occurrences ?? [{ line: edge.line, evidence: edge.evidence, confidence: edge.confidence }]).some(occurrence =>
    occurrence.line === relation.line && occurrence.evidence === relation.evidence
    && (occurrence.confidence ?? edge.confidence) === relation.confidence);
}

export function relationsOf(fn: FunctionInfo): FunctionRelation[] {
  return [...new Map((fn.relations ?? []).map(item => [canonical(item), item])).values()];
}
