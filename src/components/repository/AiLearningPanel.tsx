"use client";

import { useEffect, useState } from "react";
import { AlertCircle, BookOpen, BrainCircuit, FileCode2, Lightbulb, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import type { RepositoryFeature } from "@/types/analysis";
import type { AiLearningResponse } from "@/types/aiLearning";

interface AiLearningPanelProps {
  connectionId: string;
  feature?: RepositoryFeature;
  selectedFunction?: { id: string; name: string; filePath?: string; line?: number };
}

export function AiLearningPanel({ connectionId, feature, selectedFunction }: AiLearningPanelProps) {
  const [targetType, setTargetType] = useState<"feature" | "function">(feature ? "feature" : "function");
  const [result, setResult] = useState<AiLearningResponse>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const target = targetType === "feature"
    ? feature && { id: feature.id, label: feature.title }
    : selectedFunction && { id: selectedFunction.id, label: selectedFunction.name };

  useEffect(() => {
    setResult(undefined);
    setError(undefined);
  }, [target?.id, targetType]);

  async function generate(regenerate = false): Promise<void> {
    if (!target) return;
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/repositories/${encodeURIComponent(connectionId)}/learn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selection: { type: targetType, id: target.id }, regenerate }),
      });
      const payload = await response.json().catch(() => null) as (AiLearningResponse & { message?: string }) | null;
      if (!response.ok || !payload) throw new Error(payload?.message ?? "AI 설명을 생성하지 못했습니다.");
      setResult(payload);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "AI 설명을 생성하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="ai-learning-panel" aria-label="AI 코드 학습">
      <div className="ai-learning-heading">
        <span className="ai-step-number">2</span>
        <div><span><Sparkles size={13} /> AI 코드 튜터</span><strong>AI 설명으로 핵심부터 이해하기</strong></div>
        <div className="ai-target-toggle" role="group" aria-label="학습 대상">
          <button type="button" className={targetType === "feature" ? "active" : ""} disabled={!feature} onClick={() => setTargetType("feature")}>기능 전체</button>
          <button type="button" className={targetType === "function" ? "active" : ""} disabled={!selectedFunction} onClick={() => setTargetType("function")}>선택 함수</button>
        </div>
        <div className="ai-learning-action">
          <span>{target ? `${targetType === "feature" ? "기능" : "함수"}: ${target.label}` : "그래프에서 함수를 선택해 주세요"}</span>
          <button type="button" onClick={() => generate(Boolean(result))} disabled={!target || loading}>
            {loading ? <LoaderCircle className="spin" size={14} /> : result ? <RefreshCw size={14} /> : <BrainCircuit size={14} />}
            {loading ? "설명 생성 중" : result ? "다시 생성" : "AI 설명 생성"}
          </button>
        </div>
      </div>

      {error && <div className="ai-learning-error"><AlertCircle size={15} /><span>{error}</span><button type="button" onClick={() => generate(Boolean(result))}>다시 시도</button></div>}
      {!result && !error && !loading && <div className="ai-learning-empty"><BookOpen size={20} /><span>코드 근거와 줄 번호를 바탕으로 역할, 실행 흐름, 핵심 개념을 설명합니다.</span></div>}
      {loading && <div className="ai-learning-loading"><LoaderCircle className="spin" size={21} /><span>관련 코드만 읽고 학습 설명을 만들고 있어요.</span></div>}
      {result && !loading && (
        <div className="ai-explanation-grid">
          <article className="ai-explanation-summary">
            <div className="ai-result-meta"><span>{result.cached ? "저장된 설명" : "새로 생성된 설명"}</span><small>{result.model}</small></div>
            <h2>{result.explanation.title}</h2>
            <p>{result.explanation.role}</p>
            <div className="ai-beginner-note"><Lightbulb size={15} /><p>{result.explanation.beginnerExplanation}</p></div>
          </article>
          <article><h3>실행 흐름</h3><ol>{result.explanation.executionSteps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ol></article>
          <article><h3>주요 함수와 근거</h3>{result.explanation.keyFunctions.map((item) => <div className="ai-key-function" key={item.name}><code>{item.name}</code><p>{item.role}</p>{item.evidence.map((evidence) => <small key={`${evidence.filePath}:${evidence.startLine}`}><FileCode2 size={11} /> {evidence.filePath} · {evidence.startLine}-{evidence.endLine}줄</small>)}</div>)}</article>
          <article><h3>핵심 개념</h3>{result.explanation.concepts.map((concept) => <div className="ai-concept" key={concept.name}><strong>{concept.name}</strong><p>{concept.explanation}</p></div>)}</article>
          {result.explanation.limitations.length > 0 && <article className="ai-limitations"><h3>확인할 점</h3><ul>{result.explanation.limitations.map((item) => <li key={item}>{item}</li>)}</ul></article>}
        </div>
      )}
    </section>
  );
}
