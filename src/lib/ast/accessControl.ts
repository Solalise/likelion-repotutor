import { createHash } from "node:crypto";
import { Node, SyntaxKind, type CallExpression, type SourceFile } from "ts-morph";
import type { RepositoryAnalysis, RepositoryEntryPoint } from "@/types/analysis";
import type { FunctionControlFlow } from "@/types/controlFlow";
import type { AccessControlAnalysis, AccessControlFinding, AccessCheckEvidence, SqlInjectionEvidence } from "@/types/security";
import { declarations, evidence, importOrigin, mutatedLocals, traceValue, type Value } from "./sqlInjection";
import { objectFieldValue, resolveLocalValue } from "./localValueFlow";
import { functionSyntax } from "./prismaClientResolver";

export const ACCESS_ANALYSIS_VERSION = "access-control-static-v1" as const;
export const ACCESS_ANALYSIS_LIMITS = { findings: 100, visitsPerEntry: 64, callDepth: 8, contexts: 200, checks: 24, tracesPerEntry: 160 } as const;
type Sources = Array<{ path: string; sourceFile: SourceFile }>;
type Bindings = Map<Node, Node>;
type Visit = { owner: string; bindings: Bindings; path: CallExpression[] };
type Context = { analysis: RepositoryAnalysis; definitions: Map<string, Node>; resolveOwner: (node: Node) => string | undefined };
type Facts = { calls: CallExpression[]; conditions: Node[]; comparisons: Node[] };
const ownerKey = /^(?:ownerId|authorId|userId|accountId|tenantId|organizationId)$/i;
const idKey = /^(?:id|.*Id|.*_id)$/;
const privileged = /(?:^|\/)(?:admin|management|permissions|roles)(?:\/|$)/i;
const authName = /^(?:auth|getServerSession|getSession|currentUser|requireUser|requireUserId|requireAuth|requireSession)$/;
const checkName = /auth|permission|access|owner|role|admin|guard|policy/i;
const limits = [
  "수집된 JS/TS와 기존 Next App Route Handler·확정 호출·Prisma DB 메타데이터만 사용합니다. 다른 언어·ORM·RLS·DB 트리거·배포 설정은 완전히 분석하지 않습니다.",
  "검사 구문 관찰은 정책의 정확성·전체 경로 보호·실제 실행을 증명하지 않습니다. 반환값 무시·예외 처리·비동기 호출·동적 객체·복잡한 별칭은 미확인으로 남깁니다.",
  "역할 요구는 비즈니스 정책입니다. 관리자 경로·모델 이름은 민감도 단서일 뿐 필수 역할이나 취약점을 확정하지 않습니다.",
  "소유권 비교가 조회 뒤에 있을 수 있습니다. 조회 전 필터와 조회 후 응답 차단을 구분하고 반환·예외·부작용 경로를 직접 확인해야 합니다.",
  "최대 100개 후보, 진입점별 64개 함수 경로·8단계·160회 입력 추적, 200개 DB 문맥을 분석합니다. 누락·실패·후보 없음은 안전 보증이 아닙니다.",
];
export function failedAccessControlAnalysis(): AccessControlAnalysis { return { version: ACCESS_ANALYSIS_VERSION, status: "failed", findings: [], boundaries: [], truncated: false, limitations: [...limits, "접근 제어 분석에 실패했습니다. SQLi/XSS 및 기존 분석 결과는 유지합니다. 저장소를 다시 분석하고 접근 정책은 수동 확인하세요."] }; }

/** Additive pass over the SAME AST, CFG, request traces and source-proven DB contexts. */
export function collectAccessControl(sources: Sources, ctx: Context): AccessControlAnalysis {
  const { analysis, definitions } = ctx;
  const result: AccessControlAnalysis = { version: ACCESS_ANALYSIS_VERSION, status: "completed", findings: [], boundaries: [], truncated: false, limitations: [...limits] };
  const functions = new Map(analysis.files.flatMap(file => file.functions).map(fn => [fn.id, fn]));
  const flows = new Map((analysis.functionControlFlows ?? []).map(flow => [flow.ownerFunctionId, flow]));
  const facts = new Map<string, Facts>(), callsByKey = new Map<string, CallExpression>();
  const changes = new Map<SourceFile, Set<Node>>();
  const key = (node: Node) => `${node.getSourceFile().getFilePath().replace(/^\//, "")}:${node.getStart()}:${node.getEnd()}`;
  const locationKey = (location: { filePath: string; startOffset: number; endOffset: number }) => `${location.filePath}:${location.startOffset}:${location.endOffset}`;
  for (const { sourceFile } of sources) for (const node of sourceFile.getDescendants()) {
    const owner = ctx.resolveOwner(node); if (!owner) continue;
    const f = facts.get(owner) ?? { calls: [], conditions: [], comparisons: [] }; facts.set(owner, f);
    if (Node.isCallExpression(node)) { f.calls.push(node); callsByKey.set(key(node), node); }
    if (Node.isIfStatement(node)) f.conditions.push(node.getExpression());
    if (Node.isConditionalExpression(node)) f.conditions.push(node.getCondition());
    if (Node.isBinaryExpression(node) && [SyntaxKind.EqualsEqualsEqualsToken, SyntaxKind.ExclamationEqualsEqualsToken, SyntaxKind.EqualsEqualsToken, SyntaxKind.ExclamationEqualsToken].includes(node.getOperatorToken().getKind())) f.comparisons.push(node);
  }
  const mutationSet = (node: Node) => { const file = node.getSourceFile(); if (!changes.has(file)) changes.set(file, mutatedLocals(file)); return changes.get(file)!; };
  function boundary(node: Node, message: string) {
    if (result.boundaries.length < 100 && !result.boundaries.some(e => e.filePath === node.getSourceFile().getFilePath().replace(/^\//, "") && e.line === node.getStartLineNumber() && e.description === message)) result.boundaries.push(evidence(node, message));
    result.status = "partial";
  }
  function unwrap(node: Node): Node { while (Node.isAwaitExpression(node) || Node.isParenthesizedExpression(node) || Node.isAsExpression(node) || Node.isNonNullExpression(node) || Node.isTypeAssertion(node)) node = node.getExpression(); return node; }
  function resolve(node: Node, bindings: Bindings, depth = 0): Node {
    node = unwrap(node); if (depth > 12 || !Node.isIdentifier(node)) return node;
    const defs = declarations(node); if (defs.length !== 1) return node;
    const declaration = defs[0]; if (mutationSet(node).has(declaration)) return node;
    if (Node.isParameterDeclaration(declaration)) { const argument = bindings.get(declaration); return argument ? resolve(argument, bindings, depth + 1) : node; }
    if (Node.isVariableDeclaration(declaration)) {
      const flow = resolveLocalValue(node, node, ctx.resolveOwner);
      if (flow && !flow.uncertain && !flow.unresolved && flow.values.length === 1) return resolve(flow.values[0], bindings, depth + 1);
    }
    return node;
  }
  function knownAuth(call: CallExpression): boolean {
    const expression = call.getExpression(), origin = importOrigin(expression);
    const typeOnly = expression.getSymbol()?.getDeclarations().some(d => Node.isImportSpecifier(d) && (d.isTypeOnly() || d.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)?.isTypeOnly()));
    return !typeOnly && Boolean(origin && (/^next-auth(?:\/.*)?$/.test(origin.library) && ["auth", "getServerSession", "getSession"].includes(origin.name) || origin.library === "@clerk/nextjs/server" && ["auth", "currentUser"].includes(origin.name)));
  }
  function identity(node: Node, bindings: Bindings, depth = 0): boolean {
    node = resolve(node, bindings); if (depth > 12) return false;
    if (Node.isPropertyAccessExpression(node)) return identity(node.getExpression(), bindings, depth + 1);
    return Node.isCallExpression(node) && knownAuth(node);
  }
  const principalId = (node: Node, bindings: Bindings) => { node = resolve(node, bindings); return Node.isPropertyAccessExpression(node) && /^(id|userId|sub)$/.test(node.getName()) && identity(node.getExpression(), bindings); };
  function bind(call: CallExpression, target: string, previous: Bindings): Bindings {
    const fn = definitions.get(target), syntax = fn && functionSyntax(fn), next = new Map(previous);
    if (!syntax) return next;
    for (const [i, parameter] of syntax.getParameters().entries()) { next.delete(parameter); const arg = call.getArguments()[i]; if (arg && !parameter.isRestParameter() && !call.getArguments().some(Node.isSpreadElement) && Node.isIdentifier(parameter.getNameNode())) next.set(parameter, arg); }
    return next;
  }
  function reachable(entry: RepositoryEntryPoint): Visit[] {
    const visits: Visit[] = [];
    function visit(owner: string, bindings: Bindings, path: CallExpression[], stack: Set<string>) {
      const definition = definitions.get(owner); if (!definition) return;
      if (stack.has(owner) || path.length > ACCESS_ANALYSIS_LIMITS.callDepth || visits.length >= ACCESS_ANALYSIS_LIMITS.visitsPerEntry) { boundary(definition, "재귀·호출 깊이·방문 예산 경계: 이후 검사 코드는 미확인"); return; }
      visits.push({ owner, bindings, path }); const nextStack = new Set(stack).add(owner);
      if (flows.get(owner)?.status !== "supported") boundary(definition, "함수 CFG가 부분 지원/미지원: 조건·차단 효과와 이후 경로는 미확인");
      for (const site of flows.get(owner)?.callSites ?? []) {
        if (site.targetResolution !== "resolved" || !site.targetNodeId || site.inUnsupportedRegion) continue;
        const call = callsByKey.get(locationKey(site.location)); if (!call) continue;
        const statement = flows.get(owner)?.statements.find(s => s.id === site.statementId); if (statement?.reachability === "unreachable-in-model") continue;
        visit(site.targetNodeId, bind(call, site.targetNodeId, bindings), [...path, call], nextStack);
      }
    }
    visit(entry.nodeId, new Map(), [], new Set()); return visits;
  }
  const adjacency = new Map<FunctionControlFlow, Map<string, string[]>>();
  function canReach(flow: FunctionControlFlow, starts: string[], targets: Set<string>, avoid?: string): boolean | undefined {
    if (flow.nodes.length > 2500 || flow.edges.length > 10000) return undefined;
    let edges = adjacency.get(flow);
    if (!edges) { edges = new Map(); for (const edge of flow.edges) { const next = edges.get(edge.source) ?? []; next.push(edge.target); edges.set(edge.source, next); } adjacency.set(flow, edges); }
    const nodes = new Map(flow.nodes.map(n => [n.id,n])), queue = [...starts], seen = new Set(starts);
    for (let i = 0; i < queue.length; i++) { const id = queue[i]; if (avoid !== undefined && nodes.get(id)?.statementId === avoid) continue; if (targets.has(id)) return true; for (const next of edges.get(id) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); } }
    return false;
  }
  function guards(flow: FunctionControlFlow | undefined, condition: Node, target: Node | "exits"): boolean {
    if (!flow || flow.status !== "supported") return false;
    const statement = flow.statements.find(s => s.condition?.location.startOffset === condition.getStart()); if (!statement) return false;
    const targetStatement = target === "exits" ? undefined : flow.statements.filter(s => s.location.startOffset <= target.getStart() && s.location.endOffset >= target.getEnd()).sort((a,b) => (a.location.endOffset-a.location.startOffset)-(b.location.endOffset-b.location.startOffset))[0];
    const targets = new Set(target === "exits" ? [flow.exits.normal, flow.exits.return] : flow.nodes.filter(n => n.statementId === targetStatement?.id).map(n => n.id));
    if (!targets.size || canReach(flow, [flow.entryNodeId], targets) !== true || canReach(flow, [flow.entryNodeId], targets, statement.id) !== false) return false;
    const conditionNodes = new Set(flow.nodes.filter(n => n.statementId === statement.id).map(n => n.id));
    const yes = flow.edges.filter(e => conditionNodes.has(e.source) && e.kind === "true").map(e => e.target), no = flow.edges.filter(e => conditionNodes.has(e.source) && e.kind === "false").map(e => e.target);
    const fromYes = canReach(flow, yes, targets), fromNo = canReach(flow, no, targets);
    return fromYes !== undefined && fromNo !== undefined && fromYes !== fromNo;
  }
  function beforeSibling(flow: FunctionControlFlow | undefined, call: CallExpression, target: Node): boolean {
    if (!flow || flow.status !== "supported" || call.getStart() >= target.getStart() || call.getAncestors().some(Node.isTryStatement)) return false;
    const callSite = flow.callSites.find(c => c.location.startOffset === call.getStart()), targetSite = flow.callSites.find(c => c.location.startOffset === target.getStart());
    if (!callSite || !targetSite) return false;
    const targets = new Set(flow.nodes.filter(n => n.statementId === targetSite.statementId).map(n => n.id));
    return targets.size > 0 && canReach(flow, [flow.entryNodeId], targets) === true && canReach(flow, [flow.entryNodeId], targets, callSite.statementId) === false;
  }
  function control(condition: Node, visit: Visit, targets: Map<string, Node>): AccessCheckEvidence["control"] {
    const direct = targets.get(visit.owner);
    if (direct) return guards(flows.get(visit.owner), condition, direct) ? "guard-before-operation" : condition.getStart() > direct.getStart() ? "after-operation" : "conditional-or-unused";
    const bridge = visit.path.at(-1), parent = bridge && ctx.resolveOwner(bridge), parentTarget = parent && targets.get(parent);
    if (bridge && parent && parentTarget && guards(flows.get(visit.owner), condition, "exits")) {
      const definition = definitions.get(visit.owner), syntax = definition && functionSyntax(definition);
      const awaited = Boolean(bridge.getParent() && Node.isAwaitExpression(bridge.getParent()!));
      if (syntax && (!syntax.isAsync() || awaited) && beforeSibling(flows.get(parent), bridge, parentTarget)) return "guard-before-operation";
      if (bridge.getStart() > parentTarget.getStart()) return "after-operation";
    }
    return "conditional-or-unused";
  }
  function checkKind(expression: Node, bindings: Bindings, sink?: CallExpression): AccessCheckEvidence["kind"] | undefined {
    expression = resolve(expression, bindings);
    if (Node.isPrefixUnaryExpression(expression)) return checkKind(expression.getOperand(), bindings, sink);
    if (Node.isPropertyAccessExpression(expression) && identity(expression, bindings)) return "authentication";
    if (Node.isBinaryExpression(expression)) {
      if ([SyntaxKind.AmpersandAmpersandToken, SyntaxKind.BarBarToken].includes(expression.getOperatorToken().getKind())) return checkKind(expression.getLeft(), bindings, sink) ?? checkKind(expression.getRight(), bindings, sink);
      if (![SyntaxKind.EqualsEqualsEqualsToken, SyntaxKind.ExclamationEqualsEqualsToken, SyntaxKind.EqualsEqualsToken, SyntaxKind.ExclamationEqualsToken].includes(expression.getOperatorToken().getKind())) return;
      for (const [a,b] of [[expression.getLeft(), expression.getRight()], [expression.getRight(), expression.getLeft()]]) {
        const value = resolve(a, bindings), other = resolve(b, bindings);
        if (Node.isPropertyAccessExpression(value) && /^(role|roles)$/.test(value.getName()) && identity(value.getExpression(), bindings) && Node.isStringLiteral(other)) return "role";
        if (sink && Node.isPropertyAccessExpression(value) && ownerKey.test(value.getName()) && resolve(value.getExpression(), bindings) === sink && principalId(other, bindings)) return "ownership";
        if (identity(value, bindings) && [SyntaxKind.NullKeyword, SyntaxKind.UndefinedKeyword].includes(other.getKind())) return "authentication";
      }
    }
    if (Node.isCallExpression(expression)) {
      const member = expression.getExpression();
      if (Node.isPropertyAccessExpression(member) && member.getName() === "includes" && Node.isArrayLiteralExpression(member.getExpression()) && expression.getArguments().some(arg => { const p = resolve(arg, bindings); return Node.isPropertyAccessExpression(p) && p.getName() === "role" && identity(p.getExpression(), bindings); })) return "role";
    }
  }
  function collectChecks(visits: Visit[], targets: Map<string, Node>, sink?: CallExpression): AccessCheckEvidence[] {
    const checks: AccessCheckEvidence[] = [];
    for (const visit of visits) {
      const f = facts.get(visit.owner); if (!f) continue;
      for (const condition of [...f.conditions, ...f.comparisons]) {
        if (flows.get(visit.owner)?.statements.some(s => s.reachability === "unreachable-in-model" && s.location.startOffset <= condition.getStart() && s.location.endOffset >= condition.getEnd())) continue;
        const kind = checkKind(condition, visit.bindings, sink); if (!kind) continue;
        const c = control(condition, visit, targets);
        if (!checks.some(e => e.functionId === visit.owner && e.line === condition.getStartLineNumber() && e.kind === kind)) checks.push({ ...evidence(condition, `${kind === "ownership" ? "동일 DB 조회 객체와 인증 사용자 식별자 비교" : kind === "role" ? "인증 사용자 역할 비교" : "인증 사용자 존재 확인"} 구문 관찰 · 정책 효과는 별도 검토`), kind, relation: "confirmed", control: c, functionId: visit.owner });
      }
      for (const call of f.calls) {
        const expression = call.getExpression(), name = Node.isPropertyAccessExpression(expression) ? expression.getName() : expression.getText();
        const callSite = flows.get(visit.owner)?.callSites.find(s => s.location.startOffset === call.getStart());
        if (knownAuth(call)) checks.push({ ...evidence(call, "인증 라이브러리에서 세션/사용자를 읽는 호출 · 객체/역할 인가 자체가 아님"), kind: "authentication", relation: "confirmed", control: "conditional-or-unused", functionId: visit.owner });
        else if (authName.test(name) || checkName.test(name) && !callSite?.targetNodeId) {
          checks.push({ ...evidence(call, "인증·인가 관련 이름의 호출이나 구현·반환 계약은 미확인"), kind: "external-check", relation: "inferred", control: "unresolved", functionId: visit.owner });
          if (!callSite?.targetNodeId) boundary(call, "외부·미수집·미해결 인증/인가 호출: 검사 부재로 단정하지 않음");
        }
      }
    }
    return checks.slice(0, ACCESS_ANALYSIS_LIMITS.checks);
  }
  function middleware(entry: RepositoryEntryPoint): AccessCheckEvidence[] {
    return sources.filter(s => /^(?:src\/)?(?:middleware|proxy)\.[jt]s$/.test(s.path)).flatMap(({ sourceFile }) => {
      const config = sourceFile.getVariableDeclaration("config")?.getInitializer(), matcher = config && objectFieldValue(config, "matcher");
      const patterns = matcher && Node.isArrayLiteralExpression(matcher) ? matcher.getElements().filter(Node.isStringLiteral).map(n => n.getLiteralValue()) : matcher && Node.isStringLiteral(matcher) ? [matcher.getLiteralValue()] : [];
      if (patterns.length && !patterns.some(p => p === entry.routePath || p.includes(":") || p.includes("(") || p.includes("*"))) return [];
      boundary(sourceFile, "전역 middleware/proxy의 matcher·호출·거부 경로 및 배포 적용은 미확인");
      return [{ ...evidence(sourceFile, "전역 middleware/proxy 코드 존재 · 해당 API 적용·보호 효과는 추정"), kind: "middleware" as const, relation: "inferred" as const, control: "unresolved" as const }];
    }).slice(0, 4);
  }
  function push(type: AccessControlFinding["type"], owner: string, sink: Node, entry: RepositoryEntryPoint | undefined, checks: AccessCheckEvidence[], inputs: SqlInjectionEvidence[], path: CallExpression[], relation: "confirmed" | "inferred", uncertain: boolean, extra: string[]) {
    if (result.findings.length >= ACCESS_ANALYSIS_LIMITS.findings) { result.truncated = true; result.status = "partial"; return; }
    const fn = functions.get(owner); if (!fn) return;
    const protection = checks.some(c => c.kind === (type === "IDOR" ? "ownership" : "role") && c.relation === "confirmed");
    const digest = createHash("sha256").update(JSON.stringify([type, entry, key(sink), path.map(key)])).digest("hex").slice(0,24);
    const id = `${type.toLowerCase()}:${ACCESS_ANALYSIS_VERSION}:${digest}`; if (result.findings.some(f => f.id === id)) return;
    result.findings.push({ id, type, ownerFunctionId: owner, functionName: fn.name, filePath: fn.filePath, line: sink.getStartLineNumber(), endLine: sink.getEndLineNumber(), code: sink.getText().slice(0,2400), sink: Node.isCallExpression(sink) ? sink.getExpression().getText() : fn.name,
      api: entry?.method ? { path: entry.routePath, method: entry.method, filePath: entry.filePath, relation: "confirmed" } : null,
      operationRelation: relation, reviewState: protection ? "CHECKS_OBSERVED" : "UNCONFIRMED", severity: relation === "confirmed" ? "MEDIUM" : "LOW", confidence: relation === "confirmed" && inputs.length && !uncertain ? "HIGH" : relation === "confirmed" ? "MEDIUM" : "LOW", relationship: inputs.length && !uncertain ? "input-flow-observed" : "suspected",
      inputSources: inputs.slice(0,8), checks, callPath: path.slice(0,8).map(call => evidence(call, "기존 CFG에서 확정된 함수 호출 경로 · 실행/인가 효과는 별도")),
      evidence: [...inputs, evidence(sink, relation === "confirmed" ? "기존 메타데이터에서 서버 작업/DB 접근 관계 확인" : "클라이언트 UI 또는 민감 경로 이름의 검토 단서; 정책 의미 추정")].slice(0,16),
      reason: type === "IDOR" ? protection ? "요청 식별자의 DB 접근과 소유권 검사 구문을 함께 관찰했습니다. 모든 반환·수정·예외 경로와 실제 소유 관계는 직접 확인해야 합니다." : "요청 식별자로 DB 객체에 접근하지만 수집 범위에서 동일 객체의 소유권 검사를 확정하지 못했습니다. 외부 검사·RLS·공개 리소스 정책이 있을 수 있어 취약점으로 확정하지 않습니다."
        : protection ? "역할 검사 코드와 관련 작업을 관찰했습니다. 허용/거부 방향·필요 역할·호출 반환값·모든 서버 경로의 적용을 검토해야 합니다." : "민감 작업 또는 클라이언트 역할 제한 단서가 있으나 서버 역할 정책의 적용을 확정하지 못했습니다. 민감도와 필요한 역할 자체도 사용자 검토 대상입니다.",
      remediation: "서버에서 인증 사용자와 리소스/작업별 정책을 확인하고 DB 범위를 제한하세요. 클라이언트 UI 제한이나 사용자 입력 ownerId/role을 인가 근거로 신뢰하지 마세요. 기존 정책·미들웨어·DB RLS를 먼저 확인하세요.",
      limitations: [...extra, ...(uncertain ? ["입력 전달·동적 where·별칭·호출 경로에 미확정 구간이 있습니다."] : []), "검사 구문 존재·조건 분기 관찰은 안전성·실제 실행·검사 부재의 증명이 아닙니다."],
      manualChecks: ["해당 API가 공개 리소스인지와 실제 허용 역할·소유권 정책을 확인하세요.", "권한 함수의 반환값 사용·await·거부 방향·예외/우회 경로를 확인하세요.", "조회 후 검사라면 검사 이전 응답·로깅·부작용과 모든 반환 경로를 확인하세요.", "미수집 코드·middleware matcher·DB RLS/tenant scope·배포 커밋을 확인하세요.", "격리 환경의 계정 A/B 또는 역할별 HTTP 결과를 수동 비교하세요."], assessment: "STATIC_REVIEW_ONLY", runtimeExploitation: "not-tested" });
  }
  const entryVisits = new Map<string, Visit[]>(); let contexts = 0;
  for (const entry of (analysis.entryPoints ?? []).filter(e => e.kind === "api" && e.framework === "next-app")) {
    const visits = reachable(entry); entryVisits.set(entry.nodeId, visits); let traces = 0; let madeAuth = false;
    for (const site of analysis.databaseAccess?.sites ?? []) for (const server of site.serverContexts.filter(s => s.status === "confirmed" && s.entryPoint.nodeId === entry.nodeId)) {
      if (++contexts > ACCESS_ANALYSIS_LIMITS.contexts) { result.truncated = true; result.status = "partial"; break; }
      if (site.operationType === "transaction" || site.context?.reachability === "unreachable-in-model") continue;
      const call = callsByKey.get(locationKey(site.location)); if (!call) continue;
      const path = server.callPath.map(step => callsByKey.get(locationKey(step.location))).filter((c): c is CallExpression => Boolean(c));
      let bindings: Bindings = new Map(); for (const step of server.callPath) { const c = callsByKey.get(locationKey(step.location)); if (c && step.kind === "call") bindings = bind(c, step.targetFunctionId, bindings); }
      const targets = new Map<string, Node>(path.map(c => [ctx.resolveOwner(c)!,c])); targets.set(site.ownerFunctionId, call);
      const checks = [...collectChecks(visits, targets, call), ...middleware(entry)].slice(0,24);
      const root = call.getArguments()[0], args = root && resolve(root, bindings), whereRaw = args && objectFieldValue(args, "where"), where = whereRaw && resolve(whereRaw, bindings);
      let dynamic = false; const ids: Node[] = [], filters: Node[] = [];
      function idValues(node: Node, depth = 0) {
        node = resolve(node, bindings);
        if (depth > 5) { dynamic = true; return; }
        if (Node.isArrayLiteralExpression(node)) { for (const value of node.getElements().slice(0,12)) idValues(value, depth + 1); return; }
        if (Node.isObjectLiteralExpression(node)) {
          for (const prop of node.getProperties()) {
            if (Node.isPropertyAssignment(prop) && !Node.isComputedPropertyName(prop.getNameNode()) && /^(equals|in|notIn|not|lt|lte|gt|gte)$/.test(prop.getName())) { const value = prop.getInitializer(); if (value) idValues(value, depth + 1); }
            else dynamic = true;
          }
          return;
        }
        ids.push(node);
      }
      function inspectWhere(node: Node, depth = 0) {
        node = resolve(node, bindings); if (depth > 5 || !Node.isObjectLiteralExpression(node)) { dynamic = true; return; }
        for (const prop of node.getProperties()) {
          if (!Node.isPropertyAssignment(prop) && !Node.isShorthandPropertyAssignment(prop)) { dynamic = true; continue; }
          if (Node.isComputedPropertyName(prop.getNameNode())) { dynamic = true; continue; }
          const name = prop.getName().replace(/^['"]|['"]$/g,""), value = Node.isPropertyAssignment(prop) ? prop.getInitializer() : prop.getNameNode(); if (!value) continue;
          if (["OR", "NOT"].includes(name)) { dynamic = true; const v = resolve(value, bindings); if (Node.isArrayLiteralExpression(v)) v.getElements().slice(0,12).forEach(item=>inspectWhere(item, depth + 1)); else inspectWhere(v, depth + 1); continue; }
          if (ownerKey.test(name) && principalId(value, bindings)) filters.push(prop);
          if (idKey.test(name)) {
            // Keep shorthand identifiers intact for their value-symbol/parameter binding.
            if (Node.isShorthandPropertyAssignment(prop)) ids.push(value); else idValues(value);
          }
          if (name === "AND" && Node.isArrayLiteralExpression(value)) value.getElements().forEach(v => inspectWhere(v, depth + 1));
          else if (Node.isObjectLiteralExpression(resolve(value, bindings))) inspectWhere(value, depth + 1);
        }
      }
      if (where) inspectWhere(where); else if (whereRaw || args && !Node.isObjectLiteralExpression(args)) dynamic = true;
      if (dynamic) boundary(call, "동적/복합 where의 식별자·소유 범위를 완전히 해석하지 못함 · 검사 부재로 단정하지 않음");
      const values: Value[] = [];
      for (const id of ids.slice(0,12)) {
        if (++traces > ACCESS_ANALYSIS_LIMITS.tracesPerEntry) { boundary(call, "입력 추적 예산 경계: 추가 식별자 흐름 미확인"); dynamic = true; break; }
        let bindingsLeft = 24;
        const inspect = (node: Node): Value | undefined => {
          if (!Node.isIdentifier(node) || --bindingsLeft < 0) return;
          const shorthand = node.getParent();
          if (shorthand && Node.isShorthandPropertyAssignment(shorthand)) {
            const defs = shorthand.getValueSymbol()?.getDeclarations() ?? [];
            if (defs.length === 1 && Node.isVariableDeclaration(defs[0]) && !mutationSet(node).has(defs[0])) {
              const initializer = defs[0].getInitializer();
              if (initializer) return traceValue(initializer, call, { entries: analysis.entryPoints ?? [], resolveOwner: ctx.resolveOwner }, mutationSet(initializer), { inspect });
            }
            if (defs.length === 1 && Node.isParameterDeclaration(defs[0])) {
              const arg = bindings.get(defs[0]);
              if (arg) return traceValue(arg, arg, { entries: analysis.entryPoints ?? [], resolveOwner: ctx.resolveOwner }, mutationSet(arg), { inspect });
            }
          }
          const defs = declarations(node); if (defs.length !== 1 || !Node.isParameterDeclaration(defs[0]) || mutationSet(node).has(defs[0])) return;
          const arg = bindings.get(defs[0]); if (!arg || arg === node) return;
          const v = traceValue(arg, arg, { entries: analysis.entryPoints ?? [], resolveOwner: ctx.resolveOwner }, mutationSet(arg), { inspect });
          return { ...v, steps: [...v.steps, evidence(node, "기존 확정 호출의 단순 인수→매개변수 연결")].slice(0,12) };
        };
        values.push(traceValue(id, call, { entries: analysis.entryPoints ?? [], resolveOwner: ctx.resolveOwner }, mutationSet(id), { inspect, variableDescription: "요청 식별자의 지역 값 연결" }));
      }
      if (filters.length && !dynamic) checks.push(...filters.slice(0,4).map(node => ({ ...evidence(node, "where 소유/tenant 범위와 인증 사용자 ID 연결 구문 · 실제 정책은 미검증"), kind: "ownership" as const, relation: "confirmed" as const, control: "query-filter" as const, functionId: site.ownerFunctionId })));
      const inputs = values.flatMap(v => v.sources).filter((e,i,all) => all.findIndex(o => o.filePath === e.filePath && o.line === e.line && o.code === e.code) === i), uncertain = dynamic || values.some(v => v.uncertain) || path.length !== server.callPath.length;
      if (inputs.length) push("IDOR", site.ownerFunctionId, call, entry, checks, inputs, path, "confirmed", uncertain, ["지원하는 where의 ID 계열 필드와 실제 DB 메타데이터를 연결했습니다. ID 사용 자체를 취약점으로 판단하지 않습니다."]);
      if (privileged.test(entry.routePath) || site.operationType === "write" && (/^(?:role|permission|user|account)$/i.test(site.model ?? "") || /Many$/.test(site.operation ?? ""))) { push("AUTHORIZATION", site.ownerFunctionId, call, entry, checks, inputs, path, "confirmed", uncertain, ["서버 작업은 확인했으나 경로·모델 이름으로 추정한 민감도와 필요한 역할은 확정하지 않습니다."]); madeAuth = true; }
    }
    if (!madeAuth && privileged.test(entry.routePath)) { const definition = definitions.get(entry.nodeId); if (definition) push("AUTHORIZATION", entry.nodeId, definition, entry, [...collectChecks(visits, new Map()), ...middleware(entry)].slice(0,24), [], [], "inferred", true, ["민감 API 경로 이름 단서만 있습니다. 해당 기능의 실제 민감도·필수 역할·DB 작업은 미확인입니다."]); }
  }
  // Unsupported DBs/wrappers are boundaries, not invented input→DB or authorization facts.
  for (const site of analysis.databaseAccess?.sites ?? []) if (site.status === "unresolved") { const call = callsByKey.get(locationKey(site.location)); if (call) boundary(call, `DB 접근/서버 호출 미확인 (${site.reason ?? "unknown"}) · 다른 ORM/동적 래퍼는 수동 확인`); }
  for (const { path, sourceFile } of sources) {
    if (/(?:^|\/)app\/.*route\.[jt]s$/.test(path) && !(analysis.entryPoints ?? []).some(e => e.kind === "api" && e.filePath === path)) boundary(sourceFile, "Route Handler export/고차 래퍼 연결을 확정하지 못해 API 경로·메서드를 자동 전달하지 않음");
    const client = sourceFile.getStatements().some(s => Node.isExpressionStatement(s) && Node.isStringLiteral(s.getExpression()) && s.getExpression().getText().replace(/['"]/g,"") === "use client"); if (!client) continue;
    for (const fn of analysis.files.find(f => f.path === path)?.functions ?? []) {
      const f = facts.get(fn.id); if (!f) continue;
      const roles = f.comparisons.filter(n => Node.isBinaryExpression(n) && [n.getLeft(), n.getRight()].some(p => Node.isPropertyAccessExpression(p) && p.getName() === "role")); if (!roles.length) continue;
      const children = new Set([fn.id, ...(analysis.files.find(f => f.path === path)?.functions.filter(child => child.parentId === fn.id).map(child => child.id) ?? [])]);
      const requests = (analysis.httpRequests ?? []).filter(r => children.has(r.ownerFunctionId) && (privileged.test(r.path ?? "") || ["POST", "PUT", "PATCH", "DELETE"].includes(r.method ?? "")));
      for (const request of requests.slice(0,4)) {
        const serverEntry = request.status === "matched" ? request.target?.entryPoint : undefined;
        const serverChecks = serverEntry ? collectChecks(entryVisits.get(serverEntry.nodeId) ?? [], new Map()) : [];
        if (serverChecks.some(c => c.kind === "role" && c.relation === "confirmed")) continue;
        const uiCheck: AccessCheckEvidence = { ...evidence(roles[0], "클라이언트 역할 비교와 관련 HTTP 호출 단서 · 서버 인가 효과 아님"), kind: "role", relation: "inferred", control: "conditional-or-unused", functionId: fn.id };
        push("AUTHORIZATION", fn.id, roles[0], serverEntry, [uiCheck, ...serverChecks].slice(0,24), [], [], "inferred", true, ["관찰 범위에서 클라이언트 역할 제한만 확인했습니다. 서버 검사 부재·실제 이벤트 실행·HTTP 전달은 확정하지 않습니다."]);
      }
    }
  }
  return result;
}
