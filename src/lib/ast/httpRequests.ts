import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import type { RepositoryEntryPoint } from "@/types/analysis";
import type { FunctionControlFlow } from "@/types/controlFlow";
import type { HttpRequestSite } from "@/types/http";
import { createApiRouteResolver, localPath } from "./apiRelations";
import { fetchMethod, requestLocation, requestString } from "./staticRequestValues";

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

/** Exact native fetch locations, independent of legacy line-based edge merging. */
export function collectHttpRequests(
  sources: Array<{ path: string; sourceFile: SourceFile }>,
  resolveDeclaration: (node: Node) => string | undefined,
  resolveOwner: (node: Node) => string | undefined,
  entries: RepositoryEntryPoint[], controlFlows: FunctionControlFlow[],
): HttpRequestSite[] {
  const resolveRoute = createApiRouteResolver(sources, resolveDeclaration);
  const requests: HttpRequestSite[] = [];
  for (const { sourceFile } of sources) for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = call.getExpression();
    if (!Node.isIdentifier(expression) || expression.getText() !== "fetch") continue;
    const ownerFunctionId = resolveOwner(call);
    if (!ownerFunctionId) continue; // Module initializers have no function entry/CFG yet.
    const location = requestLocation(call), args = call.getArguments();
    const url = requestString(args[0]), method = fetchMethod(args[1]);
    const request: HttpRequestSite = {
      id: `http-request:${JSON.stringify([location.filePath, location.startOffset, location.endOffset])}`,
      ownerFunctionId, location, sourceCode: call.getText(), transport: "fetch",
      urlExpression: args[0]?.getText(), methodExpression: method.expression,
      url: url?.value, method: method.value, path: localPath(url?.value),
      valueEvidence: [...(url?.evidence ?? []), ...method.evidence],
      status: "unresolved", candidates: [], contextStatus: "not-available",
    };
    const cfg = controlFlows.find(item => item.ownerFunctionId === ownerFunctionId);
    const site = cfg?.callSites.find(item => item.location.startOffset === location.startOffset
      && item.location.endOffset === location.endOffset && item.sourceCode === request.sourceCode);
    const statement = cfg?.statements.find(item => item.id === site?.statementId);
    if (cfg && site && statement) {
      request.contextStatus = site.inUnsupportedRegion ? "unsupported-region" : "mapped";
      request.context = {
        controlFlowId: cfg.id, callSiteId: site.id, statementId: statement.id,
        graphNodeIds: cfg.nodes.filter(node => node.statementId === statement.id).map(node => node.id),
        branchPath: site.branchPath.map(guard => ({ ...guard })), reachability: statement.reachability,
        inUnsupportedRegion: site.inUnsupportedRegion, execution: "not-established",
      };
    }
    const shadowed = (expression.getSymbol()?.getDeclarations() ?? []).some(declaration => !declaration.getSourceFile().isDeclarationFile());
    if (shadowed) request.reason = "unknown-transport";
    else if (call.hasQuestionDotToken()) request.reason = "optional-call";
    else if (!url) request.reason = "dynamic-url";
    else if (!method.value) request.reason = "dynamic-method";
    else if (!METHODS.has(method.value)) request.reason = "unsupported-method";
    else if (!request.path) request.reason = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url.value) ? "external-url" : "invalid-path";
    else if (/%(?:2f|5c)/i.test(request.path)) request.reason = "encoded-path-separator";
    else {
      const result = resolveRoute(location.filePath, request.path, method.value, true);
      request.candidates = result.candidates;
      request.reason = result.reason;
      if (!result.reason) {
        const matches = entries.filter(entry => entry.kind === "api" && entry.framework === "next-app"
          && entry.filePath === result.filePath && entry.nodeId === result.targetId && entry.method === method.value);
        if (matches.length !== 1) request.reason = "entry-point-unavailable";
        else {
          const entryPoint = matches[0], parameters: Record<string, string | string[]> = Object.create(null);
          const actual = request.path.replace(/\/$/, "").split("/").slice(1);
          let matchKind: NonNullable<HttpRequestSite["target"]>["matchKind"] = "static";
          for (const [index, segment] of entryPoint.routePath.split("/").slice(1).entries()) {
            if (segment.startsWith("[[...")) { matchKind = "optional-catch-all"; parameters[segment.slice(5, -2)] = actual.slice(index).map(decodeURIComponent); }
            else if (segment.startsWith("[...")) { matchKind = "catch-all"; parameters[segment.slice(4, -1)] = actual.slice(index).map(decodeURIComponent); }
            else if (segment.startsWith("[")) { if (matchKind === "static") matchKind = "dynamic"; parameters[segment.slice(1, -1)] = decodeURIComponent(actual[index]); }
          }
          request.status = "matched";
          request.target = { entryPoint: { ...entryPoint }, matchKind, parameters };
        }
      }
    }
    requests.push(request);
  }
  return requests.sort((a, b) => a.location.filePath.localeCompare(b.location.filePath) || a.location.startOffset - b.location.startOffset);
}
