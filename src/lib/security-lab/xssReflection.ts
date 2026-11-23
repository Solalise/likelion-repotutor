import type { XssComparisonResult } from "./xssTypes";
import { safeXssProbe } from "./xssProbe";

export type XssReflectionStatus = "STATIC_ONLY" | "NOT_REFLECTED" | "ENCODED" | "UNENCODED" | "UNAVAILABLE";
export const xssReflectionLabels: Record<XssReflectionStatus, string> = {
  STATIC_ONLY: "정적 분석에서만 의심됨", NOT_REFLECTED: "입력값이 응답에 반영되지 않음",
  ENCODED: "관찰한 HTML 문맥에서 입력값이 안전하게 인코딩되어 반영됨",
  UNENCODED: "입력값이 일부 또는 전체가 인코딩되지 않은 형태로 반영됨", UNAVAILABLE: "요청 실패 또는 분석 불가",
};
type Context = "HTML_TEXT" | "HTML_ATTRIBUTE" | "UNQUOTED_ATTRIBUTE" | "SCRIPT_OR_RAW_TEXT" | "COMMENT" | "UNKNOWN";
export type XssReflection = { status: XssReflectionStatus; reason: string; scriptExecution: "NOT_VERIFIED"; occurrences: { context: Context; encoding: "ENCODED" | "RAW_OR_PARTIAL"; excerpt: string }[] };

/** Bounded lexical observation only; deliberately refuses raw text, comments and foreign markup.
 * No DOMParser, browser, iframe, eval or HTML insertion is used.
 */
function contextBefore(html: string, limit: number): { context: Context; quote?: string } {
  let pos = 0, raw: string | null = null, foreign = 0;
  while (pos < limit) {
    if (raw) {
      const closing = new RegExp(`</${raw}(?=[\\s/>])`, "ig"); closing.lastIndex = pos;
      const close = closing.exec(html)?.index ?? -1;
      if (close < 0 || close >= limit) return { context: "SCRIPT_OR_RAW_TEXT" };
      pos = close; raw = null;
    }
    const start = html.indexOf("<", pos);
    if (start < 0 || start >= limit) return { context: foreign ? "UNKNOWN" : "HTML_TEXT" };
    if (html.startsWith("<!--", start)) {
      const end = html.indexOf("-->", start + 4);
      if (end < 0 || end >= limit) return { context: "COMMENT" };
      pos = end + 3; continue;
    }
    const tag = /^<(\/?)([A-Za-z][\w:-]*)\b/.exec(html.slice(start));
    if (!tag) {
      if (/^<!doctype\s/i.test(html.slice(start))) { const end = html.indexOf(">", start); if (end < 0 || end >= limit) return { context: "UNKNOWN" }; pos = end + 1; continue; }
      return { context: "UNKNOWN" };
    }
    let quote: string | undefined; let end = start + tag[0].length;
    for (; end < limit; end++) {
      const char = html[end];
      if (quote) { if (char === quote) quote = undefined; }
      else if (char === '"' || char === "'") { if (!/=\s*$/.test(html.slice(start, end))) return { context: "UNKNOWN" }; quote = char; }
      else if (char === ">") break;
      else if (char === "<") return { context: "UNKNOWN" };
    }
    if (end >= limit) return { context: foreign ? "UNKNOWN" : quote ? "HTML_ATTRIBUTE" : "UNQUOTED_ATTRIBUTE", quote };
    const name = tag[2].toLowerCase();
    if (["svg", "math"].includes(name)) foreign = Math.max(0, foreign + (tag[1] ? -1 : 1));
    if (!tag[1] && ["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "plaintext"].includes(name)) raw = name;
    pos = end + 1;
  }
  return { context: raw ? "SCRIPT_OR_RAW_TEXT" : foreign ? "UNKNOWN" : "HTML_TEXT" };
}

// Exact punctuation only, including decimal/hex HTML entities; no recursive decode.
const tokens = ["(<|&lt;|&LT;|&#0*60;|&#[xX]0*3[cC];)", "(>|&gt;|&GT;|&#0*62;|&#[xX]0*3[eE];)", "(&|&amp;|&AMP;|&#0*38;|&#[xX]0*26;)", '("|&quot;|&QUOT;|&#0*34;|&#[xX]0*22;)', "('|&apos;|&#0*39;|&#[xX]0*27;)"];
const markerPrefix = safeXssProbe.value.slice(0, safeXssProbe.value.indexOf("<"));
const markerPattern = () => new RegExp(markerPrefix + tokens.join("") + "_END", "g");

export function analyzeXssReflection(result: XssComparisonResult | null, attempted = false): XssReflection {
  const output = (status: XssReflectionStatus, reason: string, occurrences: XssReflection["occurrences"] = []): XssReflection => ({ status, reason, occurrences, scriptExecution: "NOT_VERIFIED" });
  if (!result) return output(attempted ? "UNAVAILABLE" : "STATIC_ONLY", attempted ? "실행 요청 후 완전한 응답 근거를 확인하지 못했습니다. 자동 재시도하지 않습니다." : "HTTP 관찰 전입니다. 정적 후보만 있으며 실제 스크립트 실행 여부는 미검증입니다.");
  const { baseline, test } = result;
  if ([baseline, test].some(e => !e || e.outcome !== "RESPONSE" || e.bodyTruncated || e.body === null || e.statusCode === null || e.statusCode < 200 || e.statusCode >= 300)) return output("UNAVAILABLE", "요청 실패·차단·HTTP 오류·본문 잘림으로 전체 응답을 비교할 수 없습니다.");
  if (!/^text\/html(?:\s*;|$)/i.test(test!.contentType ?? "") || !/^text\/html(?:\s*;|$)/i.test(baseline!.contentType ?? "")) return output("UNAVAILABLE", "HTML Content-Type을 확인하지 못했습니다. JSON·일반 텍스트·XHTML·DOM 실행 문맥은 판정하지 않습니다.");
  if ([baseline, test].some(e => { const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(e!.contentType ?? "")?.[1]; return charset && !/^(utf-8|utf8|us-ascii)$/i.test(charset); })) return output("UNAVAILABLE", "지원하지 않는 응답 문자 인코딩입니다. UTF-8/ASCII 외 문맥은 분석하지 않습니다.");
  if (baseline!.body!.includes(markerPrefix)) return output("UNAVAILABLE", "정상 응답에도 테스트 마커 식별자가 있어 입력에 의한 반영인지 구분할 수 없습니다.");
  const body = test!.body!;
  const matches = [...body.matchAll(markerPattern())];
  if (!matches.length) return output(body.includes(markerPrefix) ? "UNAVAILABLE" : "NOT_REFLECTED", body.includes(markerPrefix) ? "마커가 일부 변형되거나 잘려 반영되었습니다. 안전한 인코딩으로 간주하지 않습니다." : "이번 두 HTTP 응답에서 고정 마커를 찾지 못했습니다. DOM·저장형·다른 입력 경로의 XSS 부재를 뜻하지 않습니다.");
  let unsupported = false;
  const occurrences = matches.slice(0, 20).map(match => {
    const where = contextBefore(body, match.index!);
    const expected = result.request.target.reflectionContext;
    if (!["HTML_TEXT", "HTML_ATTRIBUTE", "UNQUOTED_ATTRIBUTE"].includes(where.context) || expected !== "UNKNOWN" && expected !== where.context) unsupported = true;
    const encoded = match[1] !== "<" && match[3] !== "&" && (where.context === "HTML_TEXT" || where.context === "HTML_ATTRIBUTE" && (where.quote === '"' ? match[4] !== '"' : match[5] !== "'"));
    return { context: where.context, encoding: encoded ? "ENCODED" as const : "RAW_OR_PARTIAL" as const, excerpt: body.slice(Math.max(0, match.index! - 35), Math.min(body.length, match.index! + match[0].length + 35)) };
  });
  if (matches.length > 20 || unsupported) return output("UNAVAILABLE", "반영은 관찰했지만 예상 문맥 불일치 또는 주석·스크립트·외부 네임스페이스·복잡한 HTML 문맥이어서 안전성을 판단할 수 없습니다.", occurrences);
  if (occurrences.some(row => row.encoding === "RAW_OR_PARTIAL")) return output("UNENCODED", "마커의 문맥상 중요한 문자가 원문으로 반영되었습니다. 이것만으로 XSS 실행 또는 취약점을 확정하지 않습니다.", occurrences);
  return output("ENCODED", "관찰한 HTML 텍스트 또는 인용된 속성 문맥의 필요한 이스케이프 처리를 확인했습니다. 서비스 전체 안전성·스크립트 실행 여부는 검증하지 않았습니다.", occurrences);
}

export function xssObservationNote(result: XssComparisonResult): string {
  const reflection = analyzeXssReflection(result);
  return ["사용자 복사 HTTP 관찰 요약 · 서버 미검증 수동 메모", `실행 ID: ${result.runId}`, `분석 SHA: ${result.request.commitSha}`,
    `대상: ${result.request.target.deploymentOrigin}${result.request.target.apiPath} · query/${result.request.target.parameter}`,
    `확정 반영 위치: ${result.request.target.reflectionLocation} · 예상 문맥: ${result.request.target.reflectionContext}`,
    `정상: ${result.baseline?.outcome ?? "미실행"} · HTTP ${result.baseline?.statusCode ?? "없음"}`, `마커: ${result.test?.outcome ?? "미실행"} · HTTP ${result.test?.statusCode ?? "없음"}`,
    `관찰: ${xssReflectionLabels[reflection.status]}`, reflection.reason, "실제 스크립트 실행 여부는 미검증 · XSS 확정 아님 · 원본 HTTP 근거의 영구 저장 아님"].join("\n");
}
