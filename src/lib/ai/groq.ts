import "server-only";
import type { AiLearningExplanation } from "@/types/aiLearning";
import type { LearningContext } from "./learningContext";
import {
  buildLearningPrompt,
  LearningExplanationValidationError,
  materializeLearningEvidence,
  recoverLearningExplanation,
  validateLearningExplanation,
} from "./learningExplanation";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-oss-20b";
const DEFAULT_TIMEOUT_MS = 25_000;

interface GroqPayload {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string };
}

export class GroqApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterSeconds?: number,
    public readonly internalCode?: string,
  ) {
    super(message);
    this.name = "GroqApiError";
  }
}

export function groqModel(): string {
  return process.env.GROQ_MODEL?.trim() || DEFAULT_MODEL;
}

export async function generateLearningExplanation(context: LearningContext): Promise<{
  explanation: AiLearningExplanation;
  model: string;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}> {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new GroqApiError("Groq API 설정이 필요합니다.", 503);
  const model = groqModel();
  const controller = new AbortController();
  const configuredTimeout = Number(process.env.GROQ_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout >= 1_000
    ? Math.min(configuredTimeout, 60_000) : DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const requestCompletion = async (prompt: string): Promise<unknown> => {
      const response = await fetch(GROQ_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        signal: controller.signal,
        cache: "no-store",
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_completion_tokens: 1_800,
          ...(model.startsWith("openai/gpt-oss-") ? { reasoning_effort: "low", include_reasoning: false } : {}),
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const payload = await response.json().catch(() => ({})) as GroqPayload;
      if (!response.ok) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined;
        if (response.status === 429) throw new GroqApiError("AI 요청이 많습니다. 잠시 후 다시 시도해 주세요.", 429, wait, "RATE_LIMITED");
        throw new GroqApiError(`AI 설명 생성에 실패했습니다. (Groq ${response.status})`, response.status >= 500 ? 502 : 500, undefined, "UPSTREAM_ERROR");
      }
      usage.inputTokens += payload.usage?.prompt_tokens ?? 0;
      usage.outputTokens += payload.usage?.completion_tokens ?? 0;
      usage.totalTokens += payload.usage?.total_tokens ?? 0;
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new GroqApiError("AI가 빈 응답을 반환했습니다.", 502, undefined, "EMPTY_RESPONSE");
      try { return JSON.parse(content) as unknown; }
      catch { throw new LearningExplanationValidationError("SHAPE", "response is not JSON"); }
    };
    const validateOrRecover = (decoded: unknown): AiLearningExplanation => {
      const grounded = materializeLearningEvidence(decoded, context);
      try { return validateLearningExplanation(grounded, context); }
      catch (error: unknown) {
        if (!(error instanceof LearningExplanationValidationError)) throw error;
        return recoverLearningExplanation(grounded, context);
      }
    };

    let explanation: AiLearningExplanation;
    try {
      explanation = validateOrRecover(await requestCompletion(buildLearningPrompt(context)));
    } catch (validationError: unknown) {
      if (!(validationError instanceof LearningExplanationValidationError)) throw validationError;
      throw new GroqApiError(
        "AI 응답에서 검증 가능한 코드 근거를 찾지 못했습니다. 다른 기능이나 함수를 선택해 주세요.",
        502,
        undefined,
        `INVALID_RESPONSE_${validationError.code}`,
      );
    }
    return {
      explanation,
      model,
      usage: {
        inputTokens: usage.inputTokens || undefined,
        outputTokens: usage.outputTokens || undefined,
        totalTokens: usage.totalTokens || undefined,
      },
    };
  } catch (error: unknown) {
    if (error instanceof GroqApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new GroqApiError("AI 응답 시간이 초과되었습니다. 다시 시도해 주세요.", 504);
    throw new GroqApiError("AI 서비스에 연결할 수 없습니다.", 502);
  } finally {
    clearTimeout(timeout);
  }
}
