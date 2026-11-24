import ts from "typescript";
import { createHash } from "node:crypto";
import type { RepositoryAnalysis } from "@/types/analysis";
import type { GuideBundle } from "@/lib/security-lab/reviewGuide";
import { buildReviewGuides } from "@/lib/security-lab/reviewGuide";
import { presentGuideBundle } from "@/lib/ai/guideDisplaySteps";
import { containsCredentialMaterial } from "@/lib/security-lab/manualAccess";

export const ANALYSIS_STORAGE_VERSION = 1;

/** Keep bounded evidence, never literal values, comments or environment access. */
export function storedCode(code: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.JSX, code.slice(0, 1800));
  const hidden = new Set([ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail,
    ts.SyntaxKind.NumericLiteral, ts.SyntaxKind.JsxText, ts.SyntaxKind.RegularExpressionLiteral,
    ts.SyntaxKind.SingleLineCommentTrivia, ts.SyntaxKind.MultiLineCommentTrivia]);
  let result = "";
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    const text = scanner.getTokenText();
    result += hidden.has(token) ? text.replace(/[^\r\n]/g, " ").replace(/^ +/, "[비공개 값 생략]") : text;
  }
  return safeText(result);
}

function safeText(value: string): string {
  return containsCredentialMaterial(value)
    || /\b(?:process\.env|import\.meta\.env|Deno\.env)|\b(?:gh[pousr]_[\w]+|github_pat_[\w]+|gsk_[\w]+|sk-[\w-]+|AKIA[\w]+)|-----BEGIN .*PRIVATE KEY-----/i.test(value)
    ? "[비공개 정보 생략]" : value;
}

/** Only server-produced structures enter this function. Strip all complete source copies. */
function clean(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    if (key === "sourceCode") return "";
    if (/^(?:code|evidence|expression|query)$|Expression$/.test(key)) return storedCode(value);
    const safe = safeText(value);
    // References must keep equality across IDs, edge endpoints and guide citations.
    // Never turn distinct sensitive identities into a shared display placeholder.
    if (safe !== value && /^(?:id|path|filePath|location|source|target)$|Ids?$/.test(key)) {
      return `private-ref:${createHash("sha256").update(value).digest("hex")}`;
    }
    return safe;
  }
  if (Array.isArray(value)) return value.map(item => clean(item, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([name]) => !["packageManifests", "savedReviewGuides", "analyzedAt"].includes(name))
    .map(([name, item]) => [name, clean(item, name)]));
  return value;
}

export function storedGuide(bundle: GuideBundle): GuideBundle {
  return clean(bundle) as GuideBundle;
}

export function serializeAnalysis(analysis: RepositoryAnalysis) {
  return { version: ANALYSIS_STORAGE_VERSION, analysis: clean(analysis) as RepositoryAnalysis,
    baseGuide: storedGuide(presentGuideBundle({ guides: buildReviewGuides(analysis), origin: "fallback", reason: "저장된 기본 가이드" })) };
}

export function restoreAnalysis(run: { analysisResult?: unknown; reviewGuide?: unknown; completedAt?: Date | null; commitSha?: string | null }, repository: string): RepositoryAnalysis | null {
  const stored = run.analysisResult as ReturnType<typeof serializeAnalysis> | null;
  if (!stored || stored.version !== ANALYSIS_STORAGE_VERSION) return null;
  const analysis = stored.analysis;
  if (!analysis || analysis.repository !== repository || analysis.source !== "github" || !run.commitSha
    || analysis.collection?.commitSha !== run.commitSha || !Array.isArray(analysis.files)
    || !Array.isArray(analysis.nodes) || !Array.isArray(analysis.edges) || !analysis.stats) return null;
  return { ...analysis, analyzedAt: run.completedAt?.toISOString(), savedReviewGuides: (run.reviewGuide as GuideBundle | null) ?? stored.baseGuide };
}
