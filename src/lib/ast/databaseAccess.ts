import { Node, SyntaxKind, type CallExpression, type SourceFile } from "ts-morph";
import type { CodeEdge, FileAnalysis, RepositoryEntryPoint } from "@/types/analysis";
import type { FunctionControlFlow } from "@/types/controlFlow";
import type { DatabaseAccessSite, DatabaseAnalysis, DatabaseCallStep, DatabaseOperationType, DatabaseServerContext } from "@/types/database";
import type { HttpRequestContext } from "@/types/http";
import { createPrismaResolver, databaseEvidence, functionSyntax, type PrismaBindings } from "./prismaClientResolver";
import { requestLocation } from "./staticRequestValues";

const READ = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy"]);
const WRITE = new Set(["create", "createMany", "update", "updateMany", "delete", "deleteMany", "upsert"]);
function operationType(operation: string | undefined): DatabaseOperationType {
  return operation === "$transaction" ? "transaction" : READ.has(operation ?? "") ? "read" : WRITE.has(operation ?? "") ? "write" : "unknown";
}
export function databaseSiteId(node: Node): string {
  const location = requestLocation(node);
  return `database-access:${JSON.stringify([location.filePath, location.startOffset, location.endOffset])}`;
}
export function databaseContext(cfg: FunctionControlFlow | undefined, node: Node): HttpRequestContext | undefined {
  const call = cfg?.callSites.find(site => site.location.startOffset === node.getStart() && site.location.endOffset === node.getEnd() && site.sourceCode === node.getText());
  const statement = cfg?.statements.find(item => item.id === call?.statementId);
  return cfg && call && statement ? {
    controlFlowId: cfg.id, callSiteId: call.id, statementId: statement.id,
    graphNodeIds: cfg.nodes.filter(item => item.statementId === statement.id).map(item => item.id),
    branchPath: call.branchPath.map(item => ({ ...item })), reachability: statement.reachability,
    inUnsupportedRegion: call.inUnsupportedRegion, execution: "not-established",
  } : undefined;
}

function accessSyntax(call: CallExpression) {
  const expression = call.getExpression();
  if (!Node.isPropertyAccessExpression(expression) && !Node.isElementAccessExpression(expression)) return;
  const operation = Node.isPropertyAccessExpression(expression) ? expression.getName() : undefined;
  const receiver = expression.getExpression();
  if (Node.isPropertyAccessExpression(receiver) && !receiver.getName().startsWith("$")) {
    return { client: receiver.getExpression(), model: receiver.getName(), operation,
      dynamic: Node.isElementAccessExpression(expression), optional: expression.hasQuestionDotToken() || receiver.hasQuestionDotToken(), expression };
  }
  return { client: receiver, operation, model: undefined, dynamic: Node.isElementAccessExpression(expression), optional: expression.hasQuestionDotToken(), expression };
}

/** No DB connections. Traversal follows only proven call sites from actual API entry metadata. */
export function collectDatabaseAccess(sources: Array<{ path: string; sourceFile: SourceFile }>, context: {
  definitions: Map<string, Node>; files: FileAnalysis[]; edges: CodeEdge[]; entries: RepositoryEntryPoint[];
  controlFlows: FunctionControlFlow[]; resolveTarget: (node: Node) => string | undefined; resolveOwner: (node: Node) => string | undefined;
}): DatabaseAnalysis {
  const result: DatabaseAnalysis = { sites: [], limitations: [
    { code: "static-prisma-only", message: "Only source-proven @prisma/client clients and supported member calls are identified. Runtime queries, results, effects and commits are not observed." },
    { code: "client-resolution-limits", message: "Global caches, mutable clients, dynamic members, model aliases, extensions, asynchronous factories and other ORMs are not resolved. Type annotations alone do not prove a client." },
  ] };
  const resolver = createPrismaResolver(sources.map(item => item.sourceFile), context.definitions, context.controlFlows, context.resolveTarget);
  const cfgs = new Map(context.controlFlows.map(item => [item.ownerFunctionId, item]));
  const functions = new Map(context.files.flatMap(file => file.functions).map(fn => [fn.id, fn]));
  const calls = new Map<string, CallExpression[]>();
  const candidates = new Map<CallExpression, DatabaseAccessSite>();
  for (const { sourceFile } of sources) for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const owner = context.resolveOwner(call);
    if (!owner) continue;
    calls.set(owner, [...(calls.get(owner) ?? []), call]);
    const syntax = accessSyntax(call);
    if (!syntax) continue;
    const proof = resolver.resolve(syntax.client, new Map());
    // Unknown ordinary methods are not DB candidates. Known Prisma-shaped syntax remains explicitly unresolved.
    if (operationType(syntax.operation) === "unknown" && !proof && !syntax.dynamic) continue;
    if (syntax.dynamic && !syntax.model && !proof) continue;
    const cfgContext = databaseContext(cfgs.get(owner), call);
    const site: DatabaseAccessSite = {
      id: databaseSiteId(call), ownerFunctionId: owner, location: requestLocation(call), sourceCode: call.getText(),
      clientExpression: syntax.client.getText(), model: syntax.model, operation: syntax.operation,
      operationExpression: syntax.expression.getText(), operationType: "unknown", status: "unresolved", reason: "no-confirmed-server-path",
      context: cfgContext, contextStatus: cfgContext ? cfgContext.inUnsupportedRegion ? "unsupported-region" : "mapped" : "not-available",
      serverContexts: [],
    };
    candidates.set(call, site); result.sites.push(site);
  }
  const entryIds = new Set(context.entries.map(item => item.nodeId));
  for (const entryPoint of context.entries.filter(entry => entry.kind === "api" && entry.framework === "next-app")) {
    let visits = 0;
    const note = (code: string) => {
      if (!result.limitations.some(item => item.code === code && item.entryPoint === entryPoint)) result.limitations.push({code, message:"Server traversal stopped at a cycle or configured analysis budget; omitted paths are not proof of absence.", entryPoint});
    };
    function visit(owner: string, bindings: PrismaBindings, callPath: DatabaseCallStep[], stack: Set<string>) {
      if (stack.has(owner)) { note("recursive-call-boundary"); return; }
      if (++visits > 128 || callPath.length > 12) { note("server-traversal-limit"); return; }
      const nextStack = new Set(stack).add(owner);
      const cfg = cfgs.get(owner);
      for (const call of calls.get(owner) ?? []) {
        const syntax = accessSyntax(call), site = candidates.get(call);
        const proof = syntax && resolver.resolve(syntax.client, bindings);
        const reason = !proof ? "unverified-client" : syntax?.dynamic ? "dynamic-operation"
          : syntax?.optional || call.hasQuestionDotToken() ? "optional-access"
          : operationType(syntax?.operation) === "unknown" ? "unsupported-operation"
          : !syntax?.model && syntax?.operation !== "$transaction" ? "model-unresolved"
          : syntax?.model && syntax.model.startsWith("$") ? "model-unresolved"
          : proof.kind === "transaction" && syntax?.operation === "$transaction" ? "unsupported-transaction-operation" : undefined;
        if (site) {
          // Model delegates are static names, not evidence of a generated schema/model existing at runtime.
          const serverContext: DatabaseServerContext = {
            id: `database-context:${JSON.stringify([site.id, entryPoint, callPath.map(step => [step.kind, step.location.filePath, step.location.startOffset])])}`,
            entryPoint: { ...entryPoint }, callPath: structuredClone(callPath), status: reason ? "unresolved" : "confirmed", reason,
            clientEvidence: proof?.evidence ?? [], transactionSiteId: proof?.transactionSiteId,
          };
          site.serverContexts.push(serverContext);
          if (!reason) { site.status = "confirmed"; site.reason = undefined; site.operationType = operationType(site.operation); }
          else if (site.status !== "confirmed") site.reason = reason;
        }
        if (site && !reason && syntax?.operation === "$transaction" && proof?.kind === "client") {
          const callback = call.getArguments()[0];
          const fn = callback && functionSyntax(callback), targetId = fn ? context.resolveTarget(fn) : undefined;
          const parameter = fn?.getParameters()[0];
          if (fn && targetId) {
            const callbackBindings = new Map(bindings);
            if (parameter && !parameter.isRestParameter() && Node.isIdentifier(parameter.getNameNode())) callbackBindings.set(parameter, { kind:"transaction", transactionSiteId:site.id,
              evidence:[...proof.evidence, databaseEvidence("transaction-callback", call), databaseEvidence("argument-binding", parameter)] });
            visit(targetId, callbackBindings, [...callPath, {kind:"transaction-callback", sourceFunctionId:owner, targetFunctionId:targetId,
              location:requestLocation(call), sourceCode:call.getText(), sourceEdgeIds:[], context:databaseContext(cfg,call), transactionSiteId:site.id}], nextStack);
          }
        }
        const targetId = context.resolveTarget(call.getExpression());
        if (!targetId || (targetId !== entryPoint.nodeId && entryIds.has(targetId))) continue;
        const callSite = cfg?.callSites.find(item => item.location.startOffset === call.getStart() && item.location.endOffset === call.getEnd() && item.targetNodeId === targetId);
        const evidence = call.getText().replace(/\s+/g," ").slice(0,240);
        const relation = functions.get(owner)?.relations?.find(item => item.relation === "call" && item.targetId === targetId && item.confidence === "confirmed" && item.line === call.getStartLineNumber() && item.evidence === evidence);
        const edgeIds = relation ? (callSite?.sourceEdgeIds ?? []).filter(id => context.edges.some(edge => edge.id === id && edge.relation === "call" && edge.source === owner && edge.target === targetId && edge.confidence === "confirmed")) : [];
        // The legacy graph can discard a second same-line call. The exact CFG call site
        // still carries a source-resolved callee; do not invent a replacement CodeEdge.
        if (!callSite || callSite.targetResolution !== "resolved") continue;
        const definition = context.definitions.get(targetId), fn = definition && functionSyntax(definition);
        if (!fn) continue;
        const nextBindings = new Map(bindings);
        for (const [index, parameter] of fn.getParameters().entries()) {
          nextBindings.delete(parameter);
          const argument = call.getArguments()[index];
          const argumentProof = argument && !call.getArguments().some(Node.isSpreadElement) && resolver.resolve(argument, bindings);
          if (argumentProof && !parameter.isRestParameter() && Node.isIdentifier(parameter.getNameNode())) nextBindings.set(parameter,
            {...argumentProof, evidence:[...argumentProof.evidence, databaseEvidence("argument-binding",call), databaseEvidence("argument-binding",parameter)]});
        }
        visit(targetId, nextBindings, [...callPath, {kind:"call", sourceFunctionId:owner,targetFunctionId:targetId,
          location:requestLocation(call),sourceCode:call.getText(),sourceEdgeIds:edgeIds,context:databaseContext(cfg,call)}], nextStack);
      }
    }
    visit(entryPoint.nodeId, new Map(), [], new Set());
  }
  result.sites.sort((a,b) => a.id.localeCompare(b.id));
  return result;
}
