import type {
  CodeEdge,
  CodeRelation,
  FunctionInfo,
  RelationConfidence,
  RepositoryAnalysis,
  RepositoryFeature,
} from "@/types/analysis";

const DEFAULT_MAX_INPUT_TOKENS = 6_000;
const DEFAULT_TARGET_INPUT_TOKENS = 2_500;
const DEFAULT_SAFETY_MARGIN_RATIO = 0.15;
const CONSERVATIVE_CHARACTERS_PER_TOKEN = 3.5;

export type LearningContextSelection =
  | { type: "function"; functionId: string }
  | { type: "feature"; feature: RepositoryFeature };

export interface LearningContextOptions {
  maxInputTokens?: number;
  targetInputTokens?: number;
  safetyMarginRatio?: number;
}

export interface LearningContextRelation {
  relation: Exclude<CodeRelation, "import">;
  direction: "incoming" | "outgoing";
  otherFunctionId: string;
  otherFunctionName: string;
  otherFilePath: string;
  line?: number;
  evidence?: string;
  confidence?: RelationConfidence;
}

export interface LearningContextCode {
  functionId: string;
  filePath: string;
  functionName: string;
  startLine: number;
  endLine: number;
  importance: number;
  distance: number;
  sourceCode: string;
  truncated: boolean;
  estimatedTokens: number;
  relations: LearningContextRelation[];
}

export interface LearningContextExclusion {
  functionId: string;
  filePath: string;
  functionName: string;
  startLine: number;
  endLine: number;
  importance: number;
  reason: "duplicate-range" | "token-limit";
}

export interface LearningContext {
  repository: string;
  selection: {
    type: LearningContextSelection["type"];
    id: string;
    name: string;
  };
  maxInputTokens: number;
  targetInputTokens: number;
  usableInputTokens: number;
  safetyMarginTokens: number;
  estimatedTokens: number;
  candidateCodeCount: number;
  extractedCodeCount: number;
  excludedCodeCount: number;
  truncatedCodeCount: number;
  code: LearningContextCode[];
  excluded: LearningContextExclusion[];
}

interface RankedFunction {
  fn: FunctionInfo;
  distance: number;
  importance: number;
  relations: LearningContextRelation[];
}

function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / CONSERVATIVE_CHARACTERS_PER_TOKEN);
}

function functionMap(analysis: RepositoryAnalysis): Map<string, FunctionInfo> {
  return new Map(analysis.files.flatMap((file) => file.functions).map((fn) => [fn.id, fn]));
}

function relevantEdges(analysis: RepositoryAnalysis, functions: Map<string, FunctionInfo>): CodeEdge[] {
  return analysis.edges.filter((edge) => edge.relation !== "import"
    && functions.has(edge.source)
    && functions.has(edge.target));
}

function candidateIds(
  selection: LearningContextSelection,
  functions: Map<string, FunctionInfo>,
  edges: CodeEdge[],
): { rootId: string; ids: Set<string>; selectionName: string; selectionId: string } {
  if (selection.type === "feature") {
    return {
      rootId: selection.feature.entryNodeId,
      ids: new Set(selection.feature.nodeIds.filter((id) => functions.has(id))),
      selectionName: selection.feature.title,
      selectionId: selection.feature.id,
    };
  }

  const selected = functions.get(selection.functionId);
  if (!selected) throw new Error(`Unknown function selection: ${selection.functionId}`);
  const ids = new Set([selection.functionId]);
  for (const edge of edges) {
    if (edge.source === selection.functionId) ids.add(edge.target);
    if (edge.target === selection.functionId) ids.add(edge.source);
  }
  return { rootId: selection.functionId, ids, selectionName: selected.name, selectionId: selected.id };
}

function distances(rootId: string, ids: Set<string>, edges: CodeEdge[]): Map<string, number> {
  const result = new Map<string, number>([[rootId, 0]]);
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const nextDistance = result.get(current)! + 1;
    for (const edge of edges) {
      const next = edge.source === current ? edge.target : edge.target === current ? edge.source : undefined;
      if (!next || !ids.has(next) || result.has(next)) continue;
      result.set(next, nextDistance);
      queue.push(next);
    }
  }
  return result;
}

function relationsFor(
  functionId: string,
  candidateSet: Set<string>,
  functions: Map<string, FunctionInfo>,
  edges: CodeEdge[],
): LearningContextRelation[] {
  return edges.flatMap((edge) => {
    const direction: LearningContextRelation["direction"] | undefined = edge.source === functionId
      ? "outgoing"
      : edge.target === functionId ? "incoming" : undefined;
    if (!direction) return [];
    const otherId = direction === "outgoing" ? edge.target : edge.source;
    const other = functions.get(otherId);
    if (!other || !candidateSet.has(otherId)) return [];
    return [{
      relation: edge.relation as Exclude<CodeRelation, "import">,
      direction,
      otherFunctionId: other.id,
      otherFunctionName: other.name,
      otherFilePath: other.filePath,
      line: edge.line,
      evidence: edge.evidence,
      confidence: edge.confidence,
    }];
  }).sort((a, b) => a.direction.localeCompare(b.direction)
    || a.relation.localeCompare(b.relation)
    || a.otherFunctionName.localeCompare(b.otherFunctionName));
}

function rankFunctions(
  rootId: string,
  ids: Set<string>,
  functions: Map<string, FunctionInfo>,
  edges: CodeEdge[],
): RankedFunction[] {
  const distanceMap = distances(rootId, ids, edges);
  return [...ids].flatMap((id) => {
    const fn = functions.get(id);
    if (!fn) return [];
    const distance = distanceMap.get(id) ?? 99;
    const incident = edges.filter((edge) => edge.source === id || edge.target === id);
    const confirmed = incident.filter((edge) => edge.confidence === "confirmed").length;
    const importance = (id === rootId ? 10_000 : 0)
      + Math.max(0, 1_000 - distance * 150)
      + incident.length * 20
      + confirmed * 5;
    return [{ fn, distance, importance, relations: relationsFor(id, ids, functions, edges) }];
  }).sort((a, b) => b.importance - a.importance
    || a.distance - b.distance
    || a.fn.filePath.localeCompare(b.fn.filePath)
    || a.fn.line - b.fn.line);
}

function overlapsIncluded(candidate: RankedFunction, included: RankedFunction[]): boolean {
  return included.some(({ fn }) => fn.filePath === candidate.fn.filePath
    && candidate.fn.line <= fn.endLine
    && fn.line <= candidate.fn.endLine);
}

function contextCode(item: RankedFunction, sourceCode = item.fn.sourceCode, truncated = false): LearningContextCode {
  const value = {
    functionId: item.fn.id,
    filePath: item.fn.filePath,
    functionName: item.fn.name,
    startLine: item.fn.line,
    endLine: item.fn.endLine,
    importance: item.importance,
    distance: item.distance,
    sourceCode,
    truncated,
    relations: item.relations,
  };
  return { ...value, estimatedTokens: estimateTokens(value) };
}

function truncateToBudget(item: RankedFunction, budget: number): LearningContextCode | undefined {
  const suffix = "\n/* ... truncated for context budget ... */";
  let low = 0;
  let high = item.fn.sourceCode.length;
  let best: LearningContextCode | undefined;
  while (low <= high) {
    const length = Math.floor((low + high) / 2);
    const candidate = contextCode(item, `${item.fn.sourceCode.slice(0, length)}${suffix}`, true);
    if (candidate.estimatedTokens <= budget) {
      best = candidate;
      low = length + 1;
    } else {
      high = length - 1;
    }
  }
  return best;
}

export function buildLearningContext(
  analysis: RepositoryAnalysis,
  selection: LearningContextSelection,
  options: LearningContextOptions = {},
): LearningContext {
  const maxInputTokens = Math.max(1, Math.floor(options.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS));
  const targetInputTokens = Math.min(
    maxInputTokens,
    Math.max(1, Math.floor(options.targetInputTokens ?? DEFAULT_TARGET_INPUT_TOKENS)),
  );
  const safetyMarginRatio = Math.min(0.5, Math.max(0, options.safetyMarginRatio ?? DEFAULT_SAFETY_MARGIN_RATIO));
  const usableInputTokens = Math.max(1, Math.floor(targetInputTokens * (1 - safetyMarginRatio)));
  const safetyMarginTokens = targetInputTokens - usableInputTokens;
  const functions = functionMap(analysis);
  const edges = relevantEdges(analysis, functions);
  const selected = candidateIds(selection, functions, edges);
  if (!selected.ids.has(selected.rootId) || !functions.has(selected.rootId)) {
    throw new Error(`Unknown learning context entry: ${selected.rootId}`);
  }
  const ranked = rankFunctions(selected.rootId, selected.ids, functions, edges);
  const includedRanks: RankedFunction[] = [];
  const code: LearningContextCode[] = [];
  const excluded: LearningContextExclusion[] = [];
  let estimatedTokens = 0;

  for (const item of ranked) {
    const exclusion = (reason: LearningContextExclusion["reason"]): void => {
      excluded.push({
        functionId: item.fn.id,
        filePath: item.fn.filePath,
        functionName: item.fn.name,
        startLine: item.fn.line,
        endLine: item.fn.endLine,
        importance: item.importance,
        reason,
      });
    };

    if (overlapsIncluded(item, includedRanks)) {
      exclusion("duplicate-range");
      continue;
    }
    const full = contextCode(item);
    const remaining = usableInputTokens - estimatedTokens;
    const fitted = full.estimatedTokens <= remaining
      ? full
      : item.fn.id === selected.rootId ? truncateToBudget(item, remaining) : undefined;
    if (!fitted) {
      exclusion("token-limit");
      continue;
    }
    includedRanks.push(item);
    code.push(fitted);
    estimatedTokens += fitted.estimatedTokens;
  }

  return {
    repository: analysis.repository,
    selection: { type: selection.type, id: selected.selectionId, name: selected.selectionName },
    maxInputTokens,
    targetInputTokens,
    usableInputTokens,
    safetyMarginTokens,
    estimatedTokens,
    candidateCodeCount: ranked.length,
    extractedCodeCount: code.length,
    excludedCodeCount: excluded.length,
    truncatedCodeCount: code.filter((item) => item.truncated).length,
    code,
    excluded,
  };
}
