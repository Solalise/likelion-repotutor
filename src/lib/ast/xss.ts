import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import type { ServerResponseAnalysis } from "@/types/response";
import type { XssAnalysis, XssFinding } from "@/types/security";
import { declarations, evidence, importOrigin, mutatedLocals, traceValue, type Context, type Value } from "./sqlInjection";
import { resolveLocalValue } from "./localValueFlow";

type Sink = { node: Node; value: Node; name: string; kind: XssFinding["sinkKind"]; environment: XssFinding["environment"]; proven: boolean };
type Protection = { kind: "sanitized" | "escaped"; call: Node; value: Node };
const blank = (): Value => ({ sources: [], steps: [], dynamic: false, composed: false, uncertain: false });
const isGlobal = (node: Node, name: string) => Node.isIdentifier(node) && node.getText() === name
  && declarations(node).every(declaration => declaration.getSourceFile().isDeclarationFile());

function unwrap(node: Node): Node {
  while (Node.isParenthesizedExpression(node) || Node.isAsExpression(node) || Node.isNonNullExpression(node)
    || Node.isAwaitExpression(node) || Node.isTypeAssertion(node)) node = node.getExpression();
  return node;
}

/** Resolve a single established local reaching value, never execute a wrapper. */
function local(node: Node, sink: Node, context: Context, mutations: Set<Node>, depth = 0): Node {
  node = unwrap(node);
  if (depth > 16 || !Node.isIdentifier(node)) return node;
  const defs = declarations(node), declaration = defs.length === 1 ? defs[0] : undefined;
  if (!declaration || !Node.isVariableDeclaration(declaration)
    || declaration.getSourceFile() !== sink.getSourceFile() || declaration.getStart() >= sink.getStart()
    || context.resolveOwner(declaration) !== context.resolveOwner(sink)) return node;
  const flow = resolveLocalValue(node, node, context.resolveOwner);
  if (!flow || flow.uncertain || flow.unresolved || flow.values.length !== 1) return node;
  return local(flow.values[0], sink, context, mutations, depth + 1);
}

function domElement(node: Node, sink: Node, context: Context): boolean {
  // A property write (including this sink's innerHTML write) does not rebind a const element.
  node = local(node, sink, context, new Set<Node>());
  if (Node.isPropertyAccessExpression(node) && ["body", "documentElement"].includes(node.getName())
    && isGlobal(node.getExpression(), "document")) return true;
  if (!Node.isCallExpression(node)) return false;
  const expression = node.getExpression();
  return Node.isPropertyAccessExpression(expression) && ["getElementById", "querySelector", "createElement"].includes(expression.getName())
    && isGlobal(expression.getExpression(), "document");
}

function browserSource(node: Node, sink: Node, context: Context, mutations: Set<Node>, next?: (node: Node) => Value): Value | undefined {
  if (next && Node.isNewExpression(node) && isGlobal(node.getExpression(), "URLSearchParams")) {
    const values = node.getArguments().map(next);
    return { ...blank(), sources: values.flatMap(value => value.sources).slice(0, 8),
      steps: values.flatMap(value => value.steps).slice(0, 12), dynamic: values.some(value => value.dynamic),
      uncertain: values.some(value => value.uncertain) };
  }
  if (!Node.isPropertyAccessExpression(node)) return;
  const receiver = local(node.getExpression(), sink, context, mutations);
  if (["search", "hash", "href"].includes(node.getName()) && (
    isGlobal(receiver, "location") || Node.isPropertyAccessExpression(receiver) && receiver.getName() === "location"
    && (isGlobal(receiver.getExpression(), "window") || isGlobal(receiver.getExpression(), "document")))) {
    return { ...blank(), dynamic: true, sources: [evidence(node, "브라우저 URL 입력 읽기")] };
  }
  if (node.getName() === "value" && domElement(receiver, sink, context)) {
    return { ...blank(), dynamic: true, sources: [evidence(node, "DOM 입력 요소의 value 읽기")] };
  }
}

function importedBinding(node: Node, depth = 0): ReturnType<typeof importOrigin> {
  if (depth > 12) return;
  const origin = importOrigin(node);
  if (origin) return origin;
  if (Node.isIdentifier(node)) {
    const declaration = declarations(node)[0];
    if (declaration && Node.isVariableDeclaration(declaration)
      && declaration.getFirstAncestorByKind(SyntaxKind.VariableDeclarationList)?.getDeclarationKind() === "const") {
      const value = declaration.getInitializer();
      if (value) return importedBinding(unwrap(value), depth + 1);
    }
  }
}

/** Known configuration/hook writes disable library trust across collected files. */
function changedSanitizers(sources: Array<{ sourceFile: SourceFile }>): Set<string> {
  const changed = new Set<string>();
  for (const { sourceFile } of sources) for (const node of sourceFile.getDescendants()) {
    let target: Node | undefined;
    if (Node.isCallExpression(node)) {
      const expression = node.getExpression();
      if (Node.isPropertyAccessExpression(expression) && ["setConfig", "addHook", "setOptions"].includes(expression.getName())) target = expression.getExpression();
    }
    if (Node.isBinaryExpression(node) && node.getOperatorToken().getKind() >= SyntaxKind.FirstAssignment
      && node.getOperatorToken().getKind() <= SyntaxKind.LastAssignment) target = node.getLeft();
    while (target && (Node.isPropertyAccessExpression(target) || Node.isElementAccessExpression(target))) target = target.getExpression();
    const origin = target && importedBinding(target);
    if (origin) changed.add(origin.library);
  }
  return changed;
}

function protection(node: Node, changed: Set<string>): Protection | undefined {
  node = unwrap(node);
  if (!Node.isCallExpression(node) || node.getArguments().length !== 1) return;
  const expression = node.getExpression();
  if (Node.isPropertyAccessExpression(expression) && expression.getName() === "sanitize") {
    const origin = importOrigin(expression.getExpression());
    if (origin && origin.name === "default" && ["dompurify", "isomorphic-dompurify"].includes(origin.library) && !changed.has(origin.library)) {
      return { kind: "sanitized", call: node, value: node.getArguments()[0] };
    }
  }
  const origin = importOrigin(expression);
  if (!origin || origin.name !== "default" || changed.has(origin.library)) return;
  if (origin.library === "sanitize-html") return { kind: "sanitized", call: node, value: node.getArguments()[0] };
  if (["escape-html", "lodash/escape", "lodash.escape"].includes(origin.library)) return { kind: "escaped", call: node, value: node.getArguments()[0] };
}

// Escaping/sanitizing HTML is not a proof for JS, CSS, URL or attribute contexts.
function htmlText(prefix: string): boolean {
  if (/<\/?\s*(?:script|style)\b|<!--|<!\[CDATA\[/i.test(prefix)) return false;
  let tag = false;
  let quote = "";
  for (const character of prefix) {
    if (!tag) { if (character === "<") tag = true; continue; }
    if (quote) { if (character === quote) quote = ""; continue; }
    if (character === "'" || character === '"') quote = character;
    else if (character === ">") tag = false;
  }
  return !tag && !quote;
}

function objectKey(node: Node): string | undefined {
  if (!Node.isPropertyAssignment(node) && !Node.isShorthandPropertyAssignment(node)) return;
  const name = node.getNameNode();
  if (Node.isComputedPropertyName(name)) return;
  return Node.isStringLiteral(name) ? name.getLiteralValue() : name.getText();
}

function protectionsFor(root: Node, sink: Sink, context: Context, mutations: Set<Node>, changed: Set<string>): Map<Node, Protection> {
  const found = new Map<Node, Protection>();
  let budget = 128;
  function visit(input: Node, inText: boolean, depth = 0): void {
    if (--budget < 0 || depth > 16) return;
    const node = local(input, sink.node, context, mutations);
    const safe = protection(node, changed);
    if (safe && inText) { found.set(safe.call, safe); return; }
    if (Node.isTemplateExpression(node)) {
      let prefix = node.getHead().getLiteralText();
      let known = inText;
      for (const span of node.getTemplateSpans()) {
        visit(span.getExpression(), known && htmlText(prefix), depth + 1);
        const value = local(span.getExpression(), sink.node, context, mutations);
        const literal = Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value) ? value.getLiteralText() : undefined;
        if (literal !== undefined) prefix += literal;
        else if (!found.has(value)) known = false;
        prefix += span.getLiteral().getLiteralText();
      }
    }
    if (Node.isBinaryExpression(node) && node.getOperatorToken().getKind() === SyntaxKind.PlusToken) {
      // Only a fully literal left prefix establishes the right operand's HTML context.
      visit(node.getLeft(), inText, depth + 1);
      const left = local(node.getLeft(), sink.node, context, mutations);
      const prefix = Node.isStringLiteral(left) || Node.isNoSubstitutionTemplateLiteral(left) ? left.getLiteralText() : undefined;
      visit(node.getRight(), inText && prefix !== undefined && htmlText(prefix), depth + 1);
    }
  }
  visit(root, true);
  return found;
}

function headerKind(options: Node | undefined, sink: Node, context: Context, mutations: Set<Node>): "html" | "other" | "unknown" {
  if (!options) return "other"; // Response's default string-body content type is text/plain.
  options = local(options, sink, context, mutations);
  if (!Node.isObjectLiteralExpression(options) || options.getProperties().some(property => Node.isSpreadAssignment(property)
    || Node.isComputedPropertyName(property.getNameNode()))) return "unknown";
  if (options.getProperties().filter(property => objectKey(property) === "headers").length > 1) return "unknown";
  const headers = options.getProperty("headers");
  if (!headers) return "other";
  if (!Node.isPropertyAssignment(headers) || !headers.getInitializer()) return "unknown";
  const object = local(headers.getInitializer()!, sink, context, mutations);
  if (!Node.isObjectLiteralExpression(object) || object.getProperties().some(property => Node.isSpreadAssignment(property)
    || Node.isComputedPropertyName(property.getNameNode()))) return "unknown";
  const keys = object.getProperties().map(property => objectKey(property)?.toLowerCase());
  if (keys.includes(undefined) || new Set(keys).size !== keys.length) return "unknown";
  for (const property of object.getProperties()) {
    if (!Node.isPropertyAssignment(property)) return "unknown";
    const key = property.getName().replace(/^['"]|['"]$/g, "").toLowerCase();
    if (key !== "content-type") continue;
    const value = property.getInitializer();
    if (!value || !Node.isStringLiteral(value)) return "unknown";
    return /^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(value.getLiteralValue()) ? "html" : "other";
  }
  return "other";
}

function sinks(sourceFile: SourceFile, context: Context, mutations: Set<Node>, responses: ServerResponseAnalysis): Sink[] {
  const result: Sink[] = [];
  let clientFile = false;
  for (const statement of sourceFile.getStatements()) {
    if (!Node.isExpressionStatement(statement)) break;
    const expression = statement.getExpression();
    if (!Node.isStringLiteral(expression)) break;
    if (expression.getLiteralValue() === "use client") clientFile = true;
  }
  for (const node of sourceFile.getDescendants()) {
    if (Node.isBinaryExpression(node) && (node.getOperatorToken().getKind() === SyntaxKind.EqualsToken
      || node.getOperatorToken().getKind() === SyntaxKind.PlusEqualsToken)) {
      const left = node.getLeft();
      if (Node.isPropertyAccessExpression(left) && ["innerHTML", "outerHTML"].includes(left.getName())) {
        const proven = domElement(left.getExpression(), node, context);
        result.push({ node, value: node.getRight(), name: left.getText(), kind: "dom-html", environment: proven ? "client" : "unknown", proven });
      }
    }
    if (Node.isCallExpression(node)) {
      const member = node.getExpression();
      if (!Node.isPropertyAccessExpression(member)) continue;
      if (member.getName() === "insertAdjacentHTML" && node.getArguments()[1]) {
        const proven = domElement(member.getExpression(), node, context);
        result.push({ node, value: node.getArguments()[1], name: member.getText(), kind: "dom-html", environment: proven ? "client" : "unknown", proven });
      }
      if (["send", "end"].includes(member.getName()) && node.getArguments()[0] && /^(res|response)$/.test(member.getExpression().getText())) {
        const value = local(node.getArguments()[0], node, context, mutations);
        if (!Node.isObjectLiteralExpression(value) && !Node.isArrayLiteralExpression(value)) result.push({
          node, value: node.getArguments()[0], name: member.getText(), kind: "server-html", environment: "server", proven: false,
        });
      }
    }
    if (Node.isJsxAttribute(node) && node.getNameNode().getText() === "dangerouslySetInnerHTML") {
      const initializer = node.getInitializer();
      const expression = initializer && Node.isJsxExpression(initializer) ? initializer.getExpression() : undefined;
      if (!expression) continue;
      const object = local(expression, node, context, mutations);
      if (!Node.isObjectLiteralExpression(object)) { result.push({ node, value: expression, name: "dangerouslySetInnerHTML", kind: "react-html", environment: "unknown", proven: false }); continue; }
      const property = object.getProperty("__html");
      const value = property && (Node.isPropertyAssignment(property) ? property.getInitializer() : Node.isShorthandPropertyAssignment(property) ? property.getNameNode() : undefined);
      if (!value) continue;
      const parent = node.getFirstAncestor(ancestor => Node.isJsxOpeningElement(ancestor) || Node.isJsxSelfClosingElement(ancestor));
      const tag = Node.isJsxOpeningElement(parent) || Node.isJsxSelfClosingElement(parent) ? parent.getTagNameNode().getText() : "";
      const intrinsic = /^[a-z][a-z0-9]*$/.test(tag);
      result.push({ node, value, name: "dangerouslySetInnerHTML.__html", kind: "react-html", environment: clientFile ? "client" : "unknown",
        proven: intrinsic && !object.getProperties().some(property => Node.isSpreadAssignment(property) || Node.isComputedPropertyName(property.getNameNode()))
          && object.getProperties().filter(property => objectKey(property) === "__html").length === 1
          && (Node.isJsxOpeningElement(parent) || Node.isJsxSelfClosingElement(parent)) && !parent.getAttributes().some(Node.isJsxSpreadAttribute)
          && parent.getAttributes().filter(attribute => Node.isJsxAttribute(attribute) && attribute.getNameNode().getText() === "dangerouslySetInnerHTML").length === 1 });
    }
    if (Node.isNewExpression(node) && node.getArguments()[0]) {
      const expression = node.getExpression();
      const creation = responses.creations.find(site => site.location.startOffset === node.getStart()
        && site.location.filePath === sourceFile.getFilePath().replace(/^\//, "") && site.constructorResolution === "confirmed");
      const known = Boolean(creation)
        || isGlobal(expression, "Response") || importOrigin(expression)?.library === "next/server" && importOrigin(expression)?.name === "NextResponse";
      if (!known) continue;
      const kind = headerKind(node.getArguments()[1], node, context, mutations);
      const owner = context.resolveOwner(node);
      const server = context.entries.some(entry => entry.kind === "api" && entry.nodeId === owner)
        || responses.serverContexts.some(item => item.ownerFunctionId === owner);
      const parent = node.getParent();
      const returned = Boolean(creation && responses.returns.some(item => item.responseSiteId === creation.id && item.resolution === "confirmed"))
        || Boolean(parent && Node.isReturnStatement(parent) && parent.getExpression() === node)
        || Boolean(parent && Node.isArrowFunction(parent) && parent.getBody() === node);
      if (kind !== "other") result.push({ node, value: node.getArguments()[0], name: `new ${expression.getText()} (HTML 응답)`, kind: "server-html", environment: server ? "server" : "unknown", proven: kind === "html" && server && returned });
    }
  }
  return result;
}

/** Source-only HTML-output pass. No HTML evaluation, network calls or code execution. */
export function collectXss(sources: Array<{ path: string; sourceFile: SourceFile }>, context: Context & { responses: ServerResponseAnalysis }): XssAnalysis {
  const result: XssAnalysis = { version: "xss-static-v1", findings: [], truncated: false, limitations: [
    "수집한 JS/TS의 지역 초기화와 지원하는 요청·브라우저 입력만 추적합니다. 함수 간 전달과 런타임 실행은 증명하지 않습니다.",
    "안전 처리 관찰은 확인한 import·기본 설정·HTML 텍스트 문맥에 한정됩니다. 패키지 버전·외부 파일의 설정 변경·간접 변경은 보증하지 않습니다.",
    "JS/CSS/URL/속성 문맥, 사용자 정의 정화 함수, 외부 EJS/Pug/Handlebars 파일과 사용자 정의 템플릿 태그는 안전성을 확정하지 않습니다.",
    "서버 res.send/end, 동적 응답 헤더, 사용자 컴포넌트 및 JSX spread는 실제 HTML 출력 의미가 미확정일 수 있습니다.",
    "textContent, 일반 JSX 텍스트 보간 및 명시적 비 HTML Response는 후보로 수집하지 않습니다. 후보 없음은 안전 보증이 아닙니다.",
    "안전 처리 관찰을 포함하여 최대 100개 출력 지점을 표시합니다. 공격 성공 여부는 테스트하지 않습니다.",
  ] };
  const changed = changedSanitizers(sources);
  for (const { path, sourceFile } of sources) {
    const mutations = mutatedLocals(sourceFile);
    for (const sink of sinks(sourceFile, context, mutations, context.responses)) {
      const inspectSource = (node: Node, next: (node: Node) => Value) => browserSource(node, sink.node, context, mutations, next);
      const raw = traceValue(sink.value, sink.node, context, mutations, { inspect: inspectSource, variableDescription: "지역 변수 초기화에서 HTML 출력으로 연결" });
      if (!raw.dynamic) continue;
      const protectedCalls = protectionsFor(sink.value, sink, context, mutations, changed);
      const traced = traceValue(sink.value, sink.node, context, mutations, {
        variableDescription: "지역 변수 초기화에서 HTML 출력으로 연결",
        inspect: (node, next) => {
          const safe = protectedCalls.get(node);
          if (safe) {
            const input = next(safe.value);
            return { ...blank(), steps: [...input.sources, ...input.steps, evidence(node, safe.kind === "sanitized" ? "출처가 확인된 기본 HTML 정화 처리" : "HTML 텍스트 문맥의 출력 이스케이프 처리")] };
          }
          return inspectSource(node, next);
        },
      });
      const safe = !traced.dynamic && !traced.uncertain && protectedCalls.size > 0 && sink.proven;
      if (result.findings.length >= 100) { result.truncated = true; continue; }
      const input = safe ? raw.sources : traced.sources;
      const observed = input.length > 0 && !(safe ? raw.uncertain : traced.uncertain) && sink.proven;
      const proofs = [...protectedCalls.values()];
      result.findings.push({
        id: `xss:${path}:${sink.node.getStart()}`, type: "XSS", filePath: path,
        line: sink.node.getStartLineNumber(), endLine: sink.node.getEndLineNumber(), code: sink.node.getText().slice(0, 2400),
        severity: safe ? "LOW" : observed ? "HIGH" : input.length ? "MEDIUM" : "LOW",
        confidence: observed || safe ? "HIGH" : input.length ? "MEDIUM" : "LOW",
        relationship: observed ? "input-flow-observed" : "suspected", disposition: safe ? "protected" : "candidate",
        protection: safe ? proofs.some(proof => proof.kind === "sanitized") ? "sanitized" : "escaped" : "unverified",
        environment: sink.environment, sinkKind: sink.kind, sink: sink.name, inputSources: input,
        evidence: [...input, ...traced.steps, ...proofs.map(proof => evidence(proof.call, "HTML 문맥에서 확인한 보호 처리; 다른 입력 경로까지 안전하다는 의미는 아님")), evidence(sink.node, "HTML 출력 지점")]
          .filter((item, index, items) => items.findIndex(other => other.filePath === item.filePath && other.line === item.line && other.description === item.description) === index).slice(0, 20),
        reason: safe ? "지원하는 HTML 텍스트 문맥에서 출처가 확인된 정화 또는 이스케이프를 거친 값의 출력을 관찰했습니다. 취약점 후보와 구분합니다."
          : "동적 값이 HTML로 해석되는 출력 인수에 연결됩니다. 입력이 공격자 제어라면 브라우저가 태그나 실행 가능한 내용을 해석할 가능성이 있어 검토가 필요합니다.",
        remediation: "일반 텍스트는 textContent 또는 React의 일반 텍스트 보간으로 출력하세요. HTML이 필요하면 유지 관리되는 정화 라이브러리를 안전한 설정으로 사용하고 출력 문맥에 맞게 인코딩하세요. CSP는 추가 방어이며 정화를 대체하지 않습니다.",
        limitations: [
          ...(!sink.proven ? ["실제 DOM/React/서버 HTML 출력 대상 또는 헤더를 확정하지 못했습니다."] : []),
          ...(!input.length ? ["지원하는 사용자 입력 출처와의 연결을 확인하지 못했습니다."] : []),
          ...(traced.uncertain ? ["가변 값·변환·분기 또는 추적 한계로 입력 연결이나 정화 효과가 미확정입니다."] : []),
          "사용자 정의 정화 함수나 이름만 같은 함수는 안전하다고 가정하지 않습니다. 실제 실행·공격 성공은 확인하지 않았습니다.",
        ], runtimeExploitation: "not-tested",
      });
    }
  }
  return result;
}
