import type { RepositoryAnalysis } from "@/types/analysis";
import type { ControlFlowLocation, FunctionControlFlow } from "@/types/controlFlow";
import { canonical, unambiguousIndex } from "@/lib/behavior/evidenceMapper";
import { controlId } from "./graphBuilder";

/** Validates serialized CFG provenance against its trusted AST snapshot, not runtime effects. */
export function validateFunctionControlFlow(flow: FunctionControlFlow, analysis: RepositoryAnalysis): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const fail = (code: string) => errors.push(code);
  const original = unambiguousIndex(analysis.functionControlFlows ?? [], item => item.id).get(flow.id);
  const fn = unambiguousIndex(analysis.files.flatMap(file => file.functions), item => item.id).get(flow.ownerFunctionId);
  const file = analysis.files.find(item => item.path === fn?.filePath);
  if (!original || (original !== flow && canonical(original) !== canonical(flow))) fail("cfg-snapshot-mismatch");
  if (!fn || !file || flow.id !== controlId("function", flow.ownerFunctionId) || flow.schemaVersion !== 1
    || flow.scope !== "function-body" || flow.semantics !== "intra-function-static-control-flow" || flow.runtimeExecution !== "not-observed") fail("cfg-contract");
  const source = file?.sourceCode ?? "";
  function sourceMatches(range: ControlFlowLocation, text: string): boolean {
    return range.filePath === fn?.filePath && Number.isInteger(range.startOffset) && Number.isInteger(range.endOffset)
      && range.startOffset >= 0 && range.endOffset > range.startOffset && range.endOffset <= source.length
      && source.slice(range.startOffset, range.endOffset) === text
      && source.slice(0, range.startOffset).split("\n").length === range.startLine
      && source.slice(0, range.endOffset).split("\n").length === range.endLine
      && range.startOffset - source.lastIndexOf("\n", range.startOffset - 1) === range.startColumn
      && range.endOffset - source.lastIndexOf("\n", range.endOffset - 1) === range.endColumn;
  }
  if (fn && !sourceMatches(flow.functionLocation, fn.sourceCode)) fail("cfg-function-source");
  const index = <T extends { id: string }>(values: T[]) => {
    const result = new Map<string, T>();
    for (const value of values) { if (result.has(value.id)) fail("cfg-duplicate-id"); result.set(value.id, value); }
    return result;
  };
  const statements = index(flow.statements), nodes = index(flow.nodes), calls = index(flow.callSites), awaits = index(flow.awaitSites);
  index(flow.edges);
  if (nodes.get(flow.entryNodeId)?.kind !== "entry" || nodes.get(flow.exits.normal)?.kind !== "normal-exit"
    || nodes.get(flow.exits.return)?.kind !== "return-exit" || nodes.get(flow.exits.throw)?.kind !== "throw-exit"
    || nodes.get(flow.exits.unknown)?.kind !== "analysis-boundary") fail("cfg-endpoints");
  for (const statement of flow.statements) {
    if (statement.ownerFunctionId !== flow.ownerFunctionId || !sourceMatches(statement.location, statement.sourceCode)
      || statement.location.startOffset < flow.functionLocation.startOffset || statement.location.endOffset > flow.functionLocation.endOffset
      || statement.callSiteIds.some(id => calls.get(id)?.statementId !== statement.id)
      || statement.awaitSiteIds.some(id => awaits.get(id)?.statementId !== statement.id)
      || statement.branchPath.some(guard => statements.get(guard.conditionStatementId)?.kind !== "if")
      || (statement.condition && !sourceMatches(statement.condition.location, statement.condition.sourceCode))) fail("cfg-statement-evidence");
  }
  for (const site of [...flow.callSites, ...flow.awaitSites]) {
    const statement = statements.get(site.statementId);
    if (!statement || site.ownerFunctionId !== flow.ownerFunctionId || !sourceMatches(site.location, site.sourceCode)
      || site.location.startOffset < statement.location.startOffset || site.location.endOffset > statement.location.endOffset
      || canonical(site.branchPath) !== canonical(statement.branchPath)) fail("cfg-site-evidence");
    if ("sourceEdgeIds" in site) {
      if (site.execution !== "not-established" || (site.targetNodeId && !analysis.nodes.some(node => node.id === site.targetNodeId && node.type !== "file"))
        || site.sourceEdgeIds.some(id => !analysis.edges.some(edge => edge.id === id && edge.source === flow.ownerFunctionId
          && edge.relation === "call" && edge.target === site.targetNodeId && edge.confidence === "confirmed"))) fail("cfg-call-evidence");
    } else if (site.completionOrder !== "not-established") fail("cfg-await-order");
  }
  for (const node of flow.nodes) {
    if (node.ownerFunctionId !== flow.ownerFunctionId || (node.kind === "statement" && !statements.has(node.statementId ?? ""))
      || node.context.some(item => statements.get(item.tryStatementId)?.kind !== "try")) fail("cfg-node-evidence");
  }
  for (const edge of flow.edges) {
    const from = nodes.get(edge.source), to = nodes.get(edge.target);
    if (!from || !to || edge.semantics !== "static-control-flow") { fail("cfg-edge"); continue; }
    const statement = statements.get(from.statementId ?? "");
    if (statement?.kind === "return" && edge.kind === "next") fail("cfg-return-fallthrough");
    if (statement?.kind === "throw" && edge.kind === "next") fail("cfg-throw-fallthrough");
    if (["true", "false"].includes(edge.kind) && statement?.kind !== "if") fail("cfg-branch-source");
    if (edge.kind === "exception" && (edge.certainty !== "possible" || edge.completion !== "throw")) fail("cfg-exception-certainty");
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}
