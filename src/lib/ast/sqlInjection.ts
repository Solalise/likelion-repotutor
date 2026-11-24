import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import type { RepositoryEntryPoint } from "@/types/analysis";
import type { SqlInjectionAnalysis, SqlInjectionEvidence } from "@/types/security";
import { objectFieldValue, resolveLocalValue, sqlQueryField } from "./localValueFlow";
import { functionSyntax } from "./prismaClientResolver";
import type { ScanDiagnostic, ScanCoverage } from "@/types/scanCoverage";
import { nextInput, type NextInputs } from "./nextInputs";

export type Context = { entries: RepositoryEntryPoint[]; resolveOwner: (node: Node) => string | undefined; nextInputs?: NextInputs;
  resolveTarget?: (node: Node) => string | undefined; definitions?: Map<string, Node>;
  callers?: Map<string, import("ts-morph").CallExpression[]>; diagnostics?: ScanDiagnostic[] };
export type Value = { sources: SqlInjectionEvidence[]; steps: SqlInjectionEvidence[]; dynamic: boolean; composed: boolean; uncertain: boolean };
const empty = (): Value => ({ sources: [], steps: [], dynamic: false, composed: false, uncertain: false });
const unknown = (): Value => ({ ...empty(), dynamic: true, uncertain: true });
const filePath = (node: Node) => node.getSourceFile().getFilePath().replace(/^\//, "");
export const evidence = (node: Node, description: string): SqlInjectionEvidence => ({
  filePath: filePath(node), line: node.getStartLineNumber(), code: node.getText().slice(0, 600), description,
});
function combine(values: Value[]): Value {
  return {
    sources: values.flatMap(value => value.sources).slice(0, 8), steps: values.flatMap(value => value.steps).slice(0, 12),
    dynamic: values.some(value => value.dynamic), composed: values.some(value => value.composed), uncertain: values.some(value => value.uncertain),
  };
}
export function declarations(node: Node): Node[] {
  const symbol = node.getSymbol();
  return (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? [];
}
export function importOrigin(node: Node): { library: string; name: string } | undefined {
  // Inspect the local import first: external packages are deliberately not downloaded.
  for (const declaration of node.getSymbol()?.getDeclarations() ?? []) {
    const statement = declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
    if (statement) return { library: statement.getModuleSpecifierValue(), name: Node.isImportSpecifier(declaration) ? declaration.getName() : "default" };
  }
}
const supportedLibrary = /^(?:pg|mysql2?(?:\/promise)?|sqlite3|better-sqlite3|sequelize|@prisma\/client)$/;

/** Prove only simple imported SQL constructors/factories and immutable aliases. */
function clientLibrary(node: Node, depth = 0, seen = new Set<Node>()): string | undefined {
  if (depth > 12 || seen.has(node)) return;
  seen = new Set(seen).add(node);
  if (Node.isAwaitExpression(node) || Node.isParenthesizedExpression(node) || Node.isAsExpression(node)
    || Node.isNonNullExpression(node)) return clientLibrary(node.getExpression(), depth + 1, seen);
  if (Node.isIdentifier(node)) {
    for (const declaration of declarations(node)) {
      if (Node.isVariableDeclaration(declaration)
        && declaration.getFirstAncestorByKind(SyntaxKind.VariableDeclarationList)?.getDeclarationKind() === "const") {
        const value = declaration.getInitializer();
        if (value) return clientLibrary(value, depth + 1, seen);
      }
    }
    return;
  }
  if (Node.isNewExpression(node) || Node.isCallExpression(node)) {
    const expression = node.getExpression();
    const name = Node.isPropertyAccessExpression(expression) ? expression.getName() : expression.getText();
    const origin = importOrigin(Node.isPropertyAccessExpression(expression) ? expression.getExpression() : expression);
    if (origin && supportedLibrary.test(origin.library)) {
      const importedName = Node.isPropertyAccessExpression(expression) ? name : origin.name;
      if (Node.isNewExpression(node) && (
        origin.library === "pg" && ["Pool", "Client"].includes(importedName)
        || origin.library === "@prisma/client" && importedName === "PrismaClient"
        || origin.library === "sqlite3" && importedName === "Database"
        || origin.library === "better-sqlite3" && importedName === "default"
        || origin.library === "sequelize" && ["Sequelize", "default"].includes(importedName))) return origin.library;
      if (Node.isCallExpression(node) && (
        /^mysql/.test(origin.library) && ["createPool", "createConnection"].includes(importedName)
        || origin.library === "better-sqlite3" && importedName === "default")) return origin.library;
    }
    if (Node.isCallExpression(node) && Node.isPropertyAccessExpression(expression) && expression.getName() === "connect") {
      return clientLibrary(expression.getExpression(), depth + 1, seen);
    }
  }
}

function supportedMethod(library: string, method: string): boolean {
  if (library === "pg" || library === "sequelize") return method === "query";
  if (/^mysql/.test(library)) return ["query", "execute"].includes(method);
  if (library === "sqlite3") return ["exec", "prepare", "run", "all", "get"].includes(method);
  if (library === "better-sqlite3") return ["exec", "prepare"].includes(method);
  return library === "@prisma/client" && ["$queryRawUnsafe", "$executeRawUnsafe", "$queryRaw", "$executeRaw"].includes(method);
}

function requestParameter(node: Node, context: Context, index: number): boolean {
  if (!Node.isIdentifier(node)) return false;
  return declarations(node).some(declaration => {
    if (!Node.isParameterDeclaration(declaration)) return false;
    const fn = declaration.getParent();
    if (!Node.isFunctionDeclaration(fn) && !Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn) && !Node.isMethodDeclaration(fn)) return false;
    return fn.getParameters()[index] === declaration && context.entries.some(entry => entry.kind === "api" && entry.nodeId === context.resolveOwner(declaration));
  });
}

export function requestInput(node: Node, context: Context): SqlInjectionEvidence | undefined {
  const modern = nextInput(node, context.nextInputs); if (modern) return modern;
  if (Node.isPropertyAccessExpression(node) && (
    ["url", "nextUrl", "headers", "cookies"].includes(node.getName()) && requestParameter(node.getExpression(), context, 0)
    || node.getName() === "params" && requestParameter(node.getExpression(), context, 1))) return evidence(node, "API 진입점의 요청 입력 읽기");
  if (Node.isCallExpression(node)) {
    const member = node.getExpression();
    if (Node.isPropertyAccessExpression(member) && ["json", "text", "formData"].includes(member.getName())
      && requestParameter(member.getExpression(), context, 0)) return evidence(node, "API 요청 본문을 읽는 호출");
  }
}

export function createCoverage(sources: Array<{ sourceFile: SourceFile }>, context: Context,
  extra?: (node: Node) => SqlInjectionEvidence | undefined): ScanCoverage {
  const inputs = sources.flatMap(({ sourceFile }) => sourceFile.getDescendants().flatMap(node => {
    const point = requestInput(node, context) ?? extra?.(node);
    return point ? [point] : [];
  }));
  return { status: sources.length ? "completed" : "unsupported", inputs, sinks: [], connectedSinks: 0, suspectedCandidates: 0, diagnostics: [] };
}

export function finishCoverage(coverage: ScanCoverage, findings: Array<{ relationship: string }>, truncated: boolean) {
  coverage.connectedSinks = findings.filter(f => f.relationship === "input-flow-observed").length;
  coverage.suspectedCandidates = findings.filter(f => f.relationship === "suspected").length;
  if (truncated || coverage.diagnostics.length) coverage.status = "partial";
}

export function mutatedLocals(sourceFile: SourceFile): Set<Node> {
  const result = new Set<Node>();
  for (const expression of sourceFile.getDescendants()) {
    let target: Node | undefined;
    if (Node.isBinaryExpression(expression)
      && expression.getOperatorToken().getKind() >= SyntaxKind.FirstAssignment
      && expression.getOperatorToken().getKind() <= SyntaxKind.LastAssignment) target = expression.getLeft();
    if ((Node.isPrefixUnaryExpression(expression) || Node.isPostfixUnaryExpression(expression))
      && [SyntaxKind.PlusPlusToken, SyntaxKind.MinusMinusToken].includes(expression.getOperatorToken())) target = expression.getOperand();
    while (target && (Node.isPropertyAccessExpression(target) || Node.isElementAccessExpression(target))) target = target.getExpression();
    if (target && Node.isIdentifier(target)) for (const declaration of declarations(target)) result.add(declaration);
  }
  return result;
}

export function traceValue(root: Node, sink: Node, context: Context, mutations: Set<Node>, extension?: {
  inspect: (node: Node, next: (node: Node) => Value) => Value | undefined;
  variableDescription?: string;
}): Value {
  let budget = 256;
  let callDepth = 0;
  const bindings = new Map<Node, Value>();
  const changes = new Map<SourceFile, Set<Node>>([[sink.getSourceFile(), mutations]]);
  const changed = (node: Node) => {
    const file = node.getSourceFile();
    if (!changes.has(file)) changes.set(file, mutatedLocals(file));
    return changes.get(file)!.has(node);
  };
  function boundary(node: Node, message: string) {
    const item = { ...evidence(node, message), message, kind: "unsupported" as const };
    if (context.diagnostics && context.diagnostics.length < 200 && !context.diagnostics.some(d => d.filePath === item.filePath && d.line === item.line && d.message === message)) context.diagnostics.push(item);
  }
  function trace(node: Node, depth = 0, seen = new Set<Node>()): Value {
    if (--budget <= 0 || depth > 20 || seen.has(node)) { boundary(node, "입력 추적 예산·깊이 또는 순환 경계 도달"); return unknown(); }
    seen = new Set(seen).add(node);
    const next = (value: Node) => trace(value, depth + 1, seen);
    const inspected = extension?.inspect(node, next);
    if (inspected) return inspected;
    const modern = nextInput(node, context.nextInputs);
    if (modern) return { ...empty(), dynamic: true, sources: [modern] };
    if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node) || Node.isNumericLiteral(node)
      || node.getKind() === SyntaxKind.TrueKeyword || node.getKind() === SyntaxKind.FalseKeyword || node.getKind() === SyntaxKind.NullKeyword) return empty();
    if (Node.isAwaitExpression(node) || Node.isParenthesizedExpression(node) || Node.isAsExpression(node)
      || Node.isTypeAssertion(node) || Node.isNonNullExpression(node)) return next(node.getExpression());
    if (Node.isPropertyAccessExpression(node)) {
      const receiver = node.getExpression();
      const name = node.getName();
      const confirmed = requestParameter(receiver, context, 0) && ["url", "nextUrl", "headers", "cookies"].includes(name)
        || requestParameter(receiver, context, 1) && name === "params";
      if (confirmed) return { ...empty(), dynamic: true, sources: [evidence(node, "API 진입점의 요청 입력 읽기")] };
      if (["body", "query", "params", "headers", "cookies"].includes(name) && /^(req|request|ctx|context)$/.test(receiver.getText())) {
        return { ...unknown(), sources: [evidence(node, "요청 입력 형태이나 진입점/프레임워크 의미는 미확정")] };
      }
      return next(receiver);
    }
    if (Node.isElementAccessExpression(node)) {
      const result = combine([next(node.getExpression()), ...(node.getArgumentExpression() ? [next(node.getArgumentExpression()!)] : [])]);
      return { ...result, uncertain: true };
    }
    if (Node.isTemplateExpression(node)) {
      const result = combine(node.getTemplateSpans().map(span => next(span.getExpression())));
      return { ...result, composed: result.dynamic };
    }
    if (Node.isBinaryExpression(node)) {
      const result = combine([next(node.getLeft()), next(node.getRight())]);
      return { ...result, composed: result.composed || node.getOperatorToken().getKind() === SyntaxKind.PlusToken && result.dynamic,
        uncertain: result.uncertain || node.getOperatorToken().getKind() !== SyntaxKind.PlusToken };
    }
    if (Node.isConditionalExpression(node)) return { ...combine([next(node.getWhenTrue()), next(node.getWhenFalse())]), uncertain: true };
    if (Node.isArrayLiteralExpression(node)) return combine(node.getElements().map(next));
    if (Node.isIdentifier(node)) {
      const defs = declarations(node);
      if (defs.length !== 1) return unknown();
      const declaration = defs[0];
      if (Node.isParameterDeclaration(declaration)) {
        if (changed(declaration)) { boundary(node, "가변 함수 매개변수의 입력 연결 미확정"); return unknown(); }
        const bound = bindings.get(declaration);
        if (bound) return bound;
        const fn = functionSyntax(declaration.getParent()), owner = context.resolveOwner(declaration);
        const callers = owner ? context.callers?.get(owner) : undefined;
        if (fn && callers?.length && callers.length <= 8 && callDepth < 4
          && !declaration.isRestParameter()) {
          callDepth++;
          const values = callers.map(call => {
            const arg = call.getArguments()[fn.getParameters().indexOf(declaration)];
            if (!arg || Node.isSpreadElement(arg)) return unknown();
            const value = next(arg);
            return { ...value, steps: [...value.steps, evidence(call, "확정 호출의 인수 → 함수 매개변수"), evidence(declaration, "입력 인수를 받는 매개변수")].slice(0, 12) };
          });
          callDepth--;
          return combine(values);
        }
        boundary(node, "함수 매개변수의 확정 호출·인수 연결 미지원 또는 한도 도달");
        return unknown();
      }
      if (Node.isVariableDeclaration(declaration)) {
        const flow = resolveLocalValue(node, node, context.resolveOwner);
        if (!flow) return unknown();
        const result = combine(flow.values.map(next));
        return { ...result, dynamic: result.dynamic || flow.unresolved,
          composed: result.composed || flow.composed, uncertain: result.uncertain || flow.uncertain || flow.unresolved,
          steps: [...result.steps, ...flow.writes.map(write => evidence(write, extension?.variableDescription
            ?? "지역 변수 초기화·재대입에서 SQL 인수로 연결"))].slice(0, 12) };
      }
      const variable = Node.isVariableDeclaration(declaration) ? declaration : Node.isBindingElement(declaration)
        ? declaration.getFirstAncestorByKind(SyntaxKind.VariableDeclaration) : undefined;
      if (!variable || variable.getSourceFile() !== sink.getSourceFile() || variable.getStart() >= sink.getStart()
        || context.resolveOwner(variable) !== context.resolveOwner(sink)) return unknown();
      const initializer = variable.getInitializer();
      if (!initializer) return unknown();
      const result = next(initializer);
      // Mutable definitions/destructuring may have writes or transformations not modeled here.
      const mutable = variable.getFirstAncestorByKind(SyntaxKind.VariableDeclarationList)?.getDeclarationKind() !== "const";
      return { ...result, dynamic: result.dynamic || mutable || mutations.has(declaration) || mutations.has(variable),
        steps: [...result.steps, evidence(declaration, extension?.variableDescription ?? "지역 변수 초기화에서 SQL 인수로 연결")].slice(0, 12),
        uncertain: result.uncertain || mutable || mutations.has(declaration) || mutations.has(variable) || Node.isBindingElement(declaration) && (Boolean(declaration.getDotDotDotToken() || declaration.getInitializer()) || !Node.isIdentifier(declaration.getNameNode())) };
    }
    if (Node.isNewExpression(node) && node.getExpression().getText() === "URL" && !importOrigin(node.getExpression())) {
      const result = combine(node.getArguments()?.map(next) ?? []);
      return { ...result, uncertain: result.uncertain || declarations(node.getExpression()).some(declaration => declaration.getSourceFile() === node.getSourceFile()) };
    }
    if (Node.isTaggedTemplateExpression(node)) return { ...next(node.getTemplate()), dynamic: true, uncertain: true };
    if (Node.isCallExpression(node)) {
      const expression = node.getExpression();
      const target = context.resolveTarget?.(expression), definition = target && context.definitions?.get(target);
      const fn = definition && functionSyntax(definition);
      if (fn && callDepth < 4) {
        const body = fn.getBody();
        const statements = body && Node.isBlock(body) ? body.getStatements() : [];
        const returns = statements.filter(Node.isReturnStatement);
        // Only straight-line const declarations and one final return. No implicit proof across guards/loops/try.
        const simple = body && (!Node.isBlock(body) || returns.length === 1 && statements.at(-1) === returns[0]
          && statements.every(s => Node.isReturnStatement(s) || Node.isVariableStatement(s) && s.getDeclarationKind() === "const"));
        const value = body && !Node.isBlock(body) ? body : returns[0]?.getExpression();
        if (simple && value && fn.getParameters().every(p => !p.isRestParameter() && !p.getInitializer() && !changed(p))
          && !node.getArguments().some(Node.isSpreadElement)) {
          const args = node.getArguments().map(next), previous = new Map(bindings);
          fn.getParameters().forEach((p, i) => bindings.set(p, args[i] ?? unknown()));
          callDepth++;
          const result = next(value);
          callDepth--; bindings.clear(); previous.forEach((v, k) => bindings.set(k, v));
          return { ...result, steps: [...result.steps, evidence(value, "확정 함수의 단일 반환값"), evidence(node, "반환값 → 호출 결과 연결")].slice(0, 12) };
        }
        boundary(node, "조건·반복·예외 또는 기본/가변 인수가 있는 함수 반환 추적은 미지원");
      }
      if (Node.isPropertyAccessExpression(expression)) {
        const receiver = expression.getExpression();
        const method = expression.getName();
        if (["json", "text", "formData"].includes(method) && requestParameter(receiver, context, 0)) {
          return { ...empty(), dynamic: true, sources: [evidence(node, "API 요청 본문을 읽는 호출")] };
        }
        const result = combine([next(receiver), ...node.getArguments().map(next)]);
        if (!["get", "getAll", "toString"].includes(method)) boundary(node, "메서드 호출의 변환·검증 의미 미지원");
        return { ...result, dynamic: true, uncertain: result.uncertain || !["get", "getAll", "toString"].includes(method),
          steps: [...result.steps, evidence(node, "입력에서 호출 결과로의 연결; 변환/검증 의미는 제한적으로만 분석")].slice(0, 12) };
      }
      boundary(node, "호출 결과 의미 미확정: 사용자 정의·외부 래퍼 또는 추적 한도");
      return { ...combine(node.getArguments().map(next)), dynamic: true, uncertain: true };
    }
    return unknown();
  }
  return trace(root);
}

function traceQueryArgument(node: Node, sink: Node, context: Context, mutations: Set<Node>): Value {
  const key = sqlQueryField(node);
  if (!key) return traceValue(node, sink, context, mutations);
  const flow = resolveLocalValue(node, node, context.resolveOwner, key);
  if (flow) {
    const result = combine(flow.values.map(value => traceValue(value, sink, context, mutations)));
    return { ...result, dynamic: result.dynamic || flow.unresolved,
      composed: result.composed || flow.composed, uncertain: result.uncertain || flow.uncertain || flow.unresolved,
      steps: [...result.steps, ...flow.writes.map(write => evidence(write, `SQL 쿼리 객체의 ${key} 초기화·속성 변경`))].slice(0, 12) };
  }
  const value = objectFieldValue(node, key);
  return value ? traceValue(value, sink, context, mutations)
    : { ...unknown(), steps: [evidence(node, "SQL 쿼리 객체의 문자열 필드 또는 변경 경로 미확정")] };
}

function safePrismaSql(node: Node, sink: Node, mutations: Set<Node>, depth = 0): boolean {
  if (depth > 12) return false;
  if (Node.isParenthesizedExpression(node) || Node.isAsExpression(node) || Node.isNonNullExpression(node)) {
    return safePrismaSql(node.getExpression(), sink, mutations, depth + 1);
  }
  if (Node.isIdentifier(node)) {
    const defs = declarations(node);
    const declaration = defs.length === 1 ? defs[0] : undefined;
    if (!declaration || !Node.isVariableDeclaration(declaration) || mutations.has(declaration)
      || declaration.getSourceFile() !== sink.getSourceFile() || declaration.getStart() >= sink.getStart()
      || declaration.getFirstAncestorByKind(SyntaxKind.VariableDeclarationList)?.getDeclarationKind() !== "const") return false;
    const value = declaration.getInitializer();
    return value ? safePrismaSql(value, sink, mutations, depth + 1) : false;
  }
  if (!Node.isTaggedTemplateExpression(node)) return false;
  const tag = node.getTag();
  return Node.isPropertyAccessExpression(tag) && tag.getName() === "sql"
    && importOrigin(tag.getExpression())?.library === "@prisma/client"
    && !node.getDescendantsOfKind(SyntaxKind.CallExpression).some(inner => {
      const expression = inner.getExpression();
      return Node.isPropertyAccessExpression(expression) && expression.getName() === "raw";
    });
}

/** Additive source-only pass: no DB, network, generated queries or code execution. */
export function collectSqlInjection(sources: Array<{ path: string; sourceFile: SourceFile }>, context: Context): SqlInjectionAnalysis {
  const coverage = createCoverage(sources, context);
  let connectedSinks = 0;
  context = { ...context, diagnostics: coverage.diagnostics };
  const result: SqlInjectionAnalysis = { version: "sqli-static-v1", findings: [], truncated: false, limitations: [
    "수집된 JS/TS 파일의 단순 지역 변수 초기화만 추적합니다. 수집되지 않은 파일과 다른 언어는 분석하지 않습니다.",
    "확정 호출의 최대 4단계·호출자 8개와 단순 반환을 추적합니다. 복잡한 별칭·객체 변경, 분기별 검증·사용자 정의 래퍼는 완전히 해석하지 않습니다.",
    "입력 흐름 관찰은 정적 구문 근거이며 실행 가능성·실제 공격 성공·검증 부재를 확정하지 않습니다.",
    "정적 쿼리와 별도 값 인수, 보간 없는 문자열, Prisma의 매개변수화된 태그 템플릿은 취약점으로 표시하지 않습니다. 미탐 가능성이 있습니다.",
    "최대 100개 후보를 표시합니다. 후보가 없어도 안전성을 보증하지 않습니다.",
  ] };
  for (const { path, sourceFile } of sources) {
    const mutations = mutatedLocals(sourceFile);
    for (const tagged of sourceFile.getDescendantsOfKind(SyntaxKind.TaggedTemplateExpression)) {
      const tag = tagged.getTag();
      if (!Node.isPropertyAccessExpression(tag) || !["$queryRaw", "$executeRaw"].includes(tag.getName()) || clientLibrary(tag.getExpression()) !== "@prisma/client") continue;
      coverage.sinks.push(evidence(tagged, "Prisma 매개변수 태그 SQL 실행 지점"));
      const template = tagged.getTemplate();
      if (Node.isTemplateExpression(template) && template.getTemplateSpans().some(span => {
        const value = traceValue(span.getExpression(), tagged, context, mutations);
        return value.sources.length && !value.uncertain;
      })) connectedSinks++;
      if (tagged.getDescendantsOfKind(SyntaxKind.CallExpression).some(call => {
        const member = call.getExpression();
        return Node.isPropertyAccessExpression(member) && member.getName() === "raw";
      })) coverage.diagnostics.push({ ...evidence(tagged, "Prisma raw 태그 조각"), kind: "unsupported", message: "Prisma.raw가 포함된 태그 SQL 조각의 전체 의미는 미지원입니다. 안전한 매개변수화로 확정하지 않습니다." });
    }
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const member = call.getExpression();
    if (!Node.isPropertyAccessExpression(member)) continue;
    const method = member.getName();
    if (!["query", "execute", "exec", "prepare", "run", "all", "get", "$queryRawUnsafe", "$executeRawUnsafe", "$queryRaw", "$executeRaw"].includes(method)) continue;
    const argument = call.getArguments()[0];
    if (!argument) continue;
    const query = argument;
    const library = clientLibrary(member.getExpression());
    const traced = traceQueryArgument(query, call, context, mutations);
    const sqlShape = [query.getText(), ...traced.steps.map(step => step.code)].some(code => /\b(?:SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|DROP)\b/i.test(code));
    if (library && supportedMethod(library, method) || method.startsWith("$") || sqlShape) {
      coverage.sinks.push(evidence(call, "SQL 실행 지점 (안전한 바인딩 포함)"));
      const boundObject = sqlQueryField(query) === "text" ? resolveLocalValue(query, query, context.resolveOwner, "values")?.values ?? [objectFieldValue(query, "values")].filter((node): node is Node => Boolean(node)) : [];
      const values = [traced, ...[...call.getArguments().slice(1), ...boundObject].map(arg => traceValue(arg, call, context, mutations))];
      if (values.some(value => value.sources.length && !value.uncertain)) connectedSinks++;
    }
    // Prisma.sql's tagged parameters are bound values, not string concatenation.
    // Explicit raw fragments nested inside the template are left as review candidates.
    if (safePrismaSql(query, call, mutations)) continue;
    if (!traced.dynamic) continue;
    if (library && !supportedMethod(library, method)) continue;
    const raw = method.startsWith("$");
    if (!library && !raw && !sqlShape) continue;
    // Non-SQL library methods and static parameter bindings must not become findings.
    if (library && !sqlShape && !raw && ["get", "all", "run"].includes(method) && !/sqlite/.test(library)) continue;
    if (result.findings.length >= 100) { result.truncated = true; continue; }
    const observed = traced.sources.length > 0 && !traced.uncertain;
    const flow = observed && Boolean(library);
    const uniqueEvidence = [...traced.sources, ...traced.steps, evidence(call, library ? `SQL 실행 API 후보 (${library})` : "SQL 실행 형태; 클라이언트 선언 미확정")]
      .filter((item, index, items) => items.findIndex(other => other.filePath === item.filePath && other.line === item.line && other.description === item.description) === index).slice(0, 16);
    result.findings.push({
      id: `sqli:${path}:${call.getStart()}`, type: "SQL_INJECTION",
      severity: flow ? "HIGH" : traced.sources.length ? "MEDIUM" : "LOW",
      confidence: flow ? "HIGH" : traced.sources.length && library ? "MEDIUM" : "LOW",
      relationship: flow ? "input-flow-observed" : "suspected", filePath: path,
      line: call.getStartLineNumber(), endLine: call.getEndLineNumber(), sink: member.getText(), clientLibrary: library,
      code: call.getText().slice(0, 2400), evidence: uniqueEvidence,
      reason: traced.composed
        ? "동적 값이 문자열 결합 또는 템플릿 보간을 통해 SQL 실행 인수에 포함됩니다. 값과 쿼리 문법의 경계가 분리되지 않을 수 있습니다."
        : "동적 값이 SQL/raw 실행 인수로 전달됩니다. 사용자 제어 여부와 값 바인딩·검증의 유효성을 확인해야 합니다.",
      remediation: "입력값을 SQL 문자열에 결합하지 말고 드라이버의 매개변수 바인딩을 사용하세요(pg: $1과 values, mysql: ?와 값 배열). Prisma는 안전한 태그 템플릿을 사용하세요. 테이블·컬럼명은 허용 목록으로 고정하세요. 입력 검증만으로 바인딩을 대체하지 마세요.",
      limitations: [
        ...(!library ? ["SQL 클라이언트의 라이브러리 출처를 확인하지 못했습니다. 같은 이름의 일반 메서드일 수 있습니다."] : []),
        ...(!traced.sources.length ? ["실제 HTTP 입력과의 연결을 확인하지 못했습니다. 함수 인수·설정·다른 파일에서 온 값일 수 있습니다."] : []),
        ...(traced.uncertain ? ["변환 호출·가변 변수·구조 분해·분기 또는 추적 한계가 있어 전체 입력 흐름을 확정할 수 없습니다."] : []),
        "검증·이스케이프 및 도달 가능성을 증명하지 않습니다. 실행 시 라이브러리가 이 인수를 거부할 수도 있습니다.",
      ], runtimeExploitation: "not-tested",
    });
    }
  }
  finishCoverage(coverage, result.findings, result.truncated);
  coverage.connectedSinks = connectedSinks;
  result.coverage = coverage;
  return result;
}
