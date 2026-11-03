import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireUserId } from "@/lib/auth/currentUser";
import { buildLearningContext, type LearningContextSelection } from "@/lib/ai/learningContext";
import { generateLearningExplanation, GroqApiError, groqModel } from "@/lib/ai/groq";
import { learningCacheKey, LEARNING_PROMPT_VERSION, validateLearningExplanation } from "@/lib/ai/learningExplanation";
import { consumeLearningRequest } from "@/lib/ai/learningRateLimit";
import { db } from "@/lib/db";
import { discoverRepositoryFeatures } from "@/lib/features/featureDiscovery";
import { getGithubAnalysisCache, githubAnalysisCacheKey } from "@/lib/repository/githubAnalysisCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext { params: Promise<{ connectionId: string }> }
interface LearnBody {
  selection?: { type?: "function" | "feature"; id?: string };
  regenerate?: boolean;
}

function responseStatus(error: unknown): number {
  return error instanceof GroqApiError ? error.status : 500;
}

export async function POST(request: Request, context: RouteContext) {
  let userId: string;
  try { userId = await requireUserId(); }
  catch { return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 }); }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 4_096) {
    return NextResponse.json({ message: "요청이 너무 큽니다." }, { status: 413 });
  }
  let body: LearnBody;
  try { body = await request.json() as LearnBody; }
  catch { return NextResponse.json({ message: "올바른 요청 형식이 아닙니다." }, { status: 400 }); }
  const selectionType = body.selection?.type;
  const selectionId = body.selection?.id?.trim();
  if ((selectionType !== "function" && selectionType !== "feature") || !selectionId || selectionId.length > 500) {
    return NextResponse.json({ message: "학습할 함수 또는 기능을 선택해 주세요." }, { status: 400 });
  }

  const { connectionId } = await context.params;
  const connection = await db.userRepository.findFirst({
    where: { id: connectionId, userId, active: true },
    include: { repository: true, installation: true },
  });
  if (!connection || connection.installation.suspendedAt) {
    return NextResponse.json({ message: "접근 가능한 연결 저장소를 찾을 수 없습니다." }, { status: 404 });
  }
  const latestRun = await db.analysisRun.findFirst({
    where: { repositoryId: connection.repositoryId, requestedByUserId: userId, status: "COMPLETED", commitSha: { not: null } },
    orderBy: { completedAt: "desc" },
  });
  if (!latestRun?.commitSha) {
    return NextResponse.json({ message: "먼저 저장소 분석을 완료해 주세요." }, { status: 409 });
  }
  const namespace = `installation:${connection.installation.installationId}`;
  const analysis = getGithubAnalysisCache(githubAnalysisCacheKey(namespace, connection.repository.fullName, latestRun.commitSha));
  if (!analysis) {
    return NextResponse.json({ message: "분석 캐시가 만료되었습니다. 저장소를 다시 분석해 주세요." }, { status: 409 });
  }

  let selection: LearningContextSelection;
  if (selectionType === "feature") {
    const discovery = discoverRepositoryFeatures(analysis);
    const feature = [...discovery.primary, ...discovery.limited, ...discovery.hidden].find((item) => item.id === selectionId);
    if (!feature) return NextResponse.json({ message: "선택한 기능을 분석 결과에서 찾을 수 없습니다." }, { status: 400 });
    selection = { type: "feature", feature };
  } else {
    selection = { type: "function", functionId: selectionId };
  }

  let learningContext;
  try { learningContext = buildLearningContext(analysis, selection); }
  catch { return NextResponse.json({ message: "선택한 학습 대상을 분석 결과에서 찾을 수 없습니다." }, { status: 400 }); }
  if (learningContext.code.length === 0) {
    return NextResponse.json({ message: "설명에 사용할 코드 근거가 없습니다." }, { status: 422 });
  }
  const model = groqModel();
  const cacheKey = learningCacheKey({
    repositoryId: connection.repositoryId,
    commitSha: latestRun.commitSha,
    selectionType,
    selectionId,
    promptVersion: LEARNING_PROMPT_VERSION,
    model,
  });
  if (!body.regenerate) {
    const cached = await db.learningRecord.findUnique({ where: { userId_cacheKey: { userId, cacheKey } } });
    if (cached) {
      try {
        const explanation = validateLearningExplanation(cached.result, learningContext);
        return NextResponse.json({
          explanation, cached: true, model: cached.model, createdAt: cached.updatedAt.toISOString(),
          usage: { inputTokens: cached.inputTokens ?? undefined, outputTokens: cached.outputTokens ?? undefined, totalTokens: cached.totalTokens ?? undefined },
        });
      } catch { /* Ignore an obsolete or invalid cached shape. */ }
    }
  }

  const rate = consumeLearningRequest(userId);
  if (!rate.allowed) {
    return NextResponse.json(
      { message: `AI 설명은 잠시 후 다시 생성할 수 있습니다. (${rate.retryAfterSeconds}초)` },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }
  try {
    const generated = await generateLearningExplanation(learningContext);
    const record = await db.learningRecord.upsert({
      where: { userId_cacheKey: { userId, cacheKey } },
      create: {
        userId, repositoryId: connection.repositoryId, commitSha: latestRun.commitSha,
        selectionType, selectionId, selectionName: learningContext.selection.name,
        promptVersion: LEARNING_PROMPT_VERSION, model: generated.model, cacheKey,
        result: generated.explanation as unknown as Prisma.InputJsonValue,
        inputTokens: generated.usage.inputTokens, outputTokens: generated.usage.outputTokens, totalTokens: generated.usage.totalTokens,
      },
      update: {
        selectionName: learningContext.selection.name,
        result: generated.explanation as unknown as Prisma.InputJsonValue,
        inputTokens: generated.usage.inputTokens, outputTokens: generated.usage.outputTokens, totalTokens: generated.usage.totalTokens,
      },
    });
    return NextResponse.json({ explanation: generated.explanation, cached: false, model: generated.model, createdAt: record.updatedAt.toISOString(), usage: generated.usage });
  } catch (error: unknown) {
    const status = responseStatus(error);
    const headers = error instanceof GroqApiError && error.retryAfterSeconds
      ? { "Retry-After": String(error.retryAfterSeconds) } : undefined;
    const message = error instanceof GroqApiError ? error.message : "AI 설명 생성 중 오류가 발생했습니다.";
    return NextResponse.json({ message }, { status, headers });
  }
}
