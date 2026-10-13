"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Braces, ChevronDown, Github, GraduationCap, LoaderCircle, Maximize2, Play, RefreshCw, Search } from "lucide-react";
import { CodeFlow } from "@/components/flow/CodeFlow";
import { LearningFlow } from "@/components/flow/LearningFlow";
import { RepositoryOverviewFlow } from "@/components/flow/RepositoryOverviewFlow";
import { traverseGraph } from "@/lib/graph/dfs";
import { buildRepositoryOverview, findOverviewFeature } from "@/lib/graph/repositoryOverview";
import { discoverRepositoryFeatures, traverseRepositoryFeature } from "@/lib/features/featureDiscovery";
import { buildLearningGraph, buildLearningStages, buildRepositoryLearningGraph, selectLearningStageGraph, summarizeLearningFeature, traverseLearningGraph } from "@/lib/learning/learningGraphBuilder";
import type { RepositoryAnalysis, RepositoryFeature } from "@/types/analysis";
import { FeaturePicker } from "./FeaturePicker";
import { LearningInspector } from "./LearningInspector";
import { NodeInspector } from "./NodeInspector";
import { RepositoryTree } from "./RepositoryTree";
import { RepositoryOverviewInspector } from "./RepositoryOverviewInspector";

type ViewMode = "learning" | "developer";
type DeveloperMode = "overview" | "feature";
type AnalysisRequest = { source: "sample" } | { source: "github"; url: string };

async function fetchAnalysis(request: AnalysisRequest): Promise<RepositoryAnalysis> {
  const params = new URLSearchParams({ source: request.source });
  if (request.source === "github") params.set("url", request.url);
  const response = await fetch(`/api/analyze?${params}`, { cache: "no-store" });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message ?? "저장소를 분석하지 못했습니다.");
  }
  return response.json() as Promise<RepositoryAnalysis>;
}

function preferredNodeId(result: RepositoryAnalysis): string {
  return result.nodes.find((node) => node.name === "LoginPage")?.id
    ?? result.nodes.find((node) => node.type !== "file")?.id
    ?? "";
}

export function RepositoryWorkspace() {
  const [analysis, setAnalysis] = useState<RepositoryAnalysis>();
  const [viewMode, setViewMode] = useState<ViewMode>("learning");
  const [selectedId, setSelectedId] = useState<string>();
  const [focusId, setFocusId] = useState("");
  const [depth, setDepth] = useState(5);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [githubUrl, setGithubUrl] = useState("");
  const [lastRequest, setLastRequest] = useState<AnalysisRequest>({ source: "sample" });
  const [selectedFeatureId, setSelectedFeatureId] = useState<string>();
  const [learningStageIndex, setLearningStageIndex] = useState(0);
  const [learningExpanded, setLearningExpanded] = useState(false);
  const [developerMode, setDeveloperMode] = useState<DeveloperMode>("overview");
  const [expandedOverviewIds, setExpandedOverviewIds] = useState<Set<string>>(() => new Set());
  const [selectedOverviewId, setSelectedOverviewId] = useState<string>();

  function applyAnalysis(result: RepositoryAnalysis): void {
    const discovery = result.source === "github" ? discoverRepositoryFeatures(result) : undefined;
    const firstFeature = discovery?.primary[0] ?? discovery?.limited[0];
    const preferred = firstFeature?.entryNodeId ?? preferredNodeId(result);
    setAnalysis(result);
    setViewMode("learning");
    setSelectedId(preferred);
    setFocusId(preferred);
    setSelectedFeatureId(firstFeature?.id);
    setFocused(result.source === "github" && Boolean(firstFeature));
    setLearningStageIndex(0);
    setLearningExpanded(false);
    setDeveloperMode("overview");
    setExpandedOverviewIds(new Set());
    setSelectedOverviewId(undefined);
  }

  async function runAnalysis(request: AnalysisRequest): Promise<void> {
    setLastRequest(request);
    setLoading(true);
    setError(undefined);
    try {
      applyAnalysis(await fetchAnalysis(request));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "분석 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetchAnalysis({ source: "sample" })
      .then((result) => {
        if (cancelled) return;
        applyAnalysis(result);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "분석 중 오류가 발생했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const isGithub = analysis?.source === "github";
  const featureDiscovery = useMemo(() => analysis && analysis.source === "github"
    ? discoverRepositoryFeatures(analysis)
    : { primary: [], limited: [], hidden: [] }, [analysis]);
  const allFeatures = useMemo(() => [
    ...featureDiscovery.primary,
    ...featureDiscovery.limited,
    ...featureDiscovery.hidden,
  ], [featureDiscovery]);
  const selectedFeature = allFeatures.find((feature) => feature.id === selectedFeatureId);
  const learningGraph = useMemo(() => {
    if (!analysis) return { nodes: [], edges: [] };
    if (analysis.source !== "github") return buildLearningGraph(analysis);
    return buildRepositoryLearningGraph(analysis, selectedFeature?.nodeIds);
  }, [analysis, selectedFeature]);
  const learningStages = useMemo(() => buildLearningStages(learningGraph, selectedFeature?.entryNodeId ?? focusId), [focusId, learningGraph, selectedFeature]);
  const currentLearningStage = learningStages[Math.min(learningStageIndex, Math.max(0, learningStages.length - 1))];
  const learningFeatureSummary = selectedFeature ? summarizeLearningFeature(selectedFeature.title, learningGraph) : undefined;
  const overviewGraph = useMemo(() => analysis && analysis.source === "github"
    ? buildRepositoryOverview(analysis, expandedOverviewIds)
    : { nodes: [], edges: [], truncated: false, hiddenNodeCount: 0 }, [analysis, expandedOverviewIds]);
  const selectedOverviewNode = overviewGraph.nodes.find((node) => node.id === selectedOverviewId);
  const technicalGraph = useMemo(() => {
    if (!analysis) return { nodes: [], edges: [] };
    if (analysis.source === "github" && focused && selectedFeature) {
      return traverseRepositoryFeature(analysis, selectedFeature, depth);
    }
    return focused && focusId ? traverseGraph(focusId, analysis.nodes, analysis.edges, depth) : { nodes: analysis.nodes, edges: analysis.edges };
  }, [analysis, depth, focusId, focused, selectedFeature]);
  const visibleLearningGraph = useMemo(() => {
    if (isGithub && currentLearningStage) return selectLearningStageGraph(learningGraph, currentLearningStage, learningExpanded, depth);
    if (!focusId) return learningGraph;
    return focused ? traverseLearningGraph(learningGraph, focusId, depth) : learningGraph;
  }, [currentLearningStage, depth, focusId, focused, isGithub, learningExpanded, learningGraph]);

  const selectedCodeNode = analysis?.nodes.find((node) => node.id === selectedId);
  const selectedLearningNode = learningGraph.nodes.find((node) => node.id === selectedId);
  const selectedPath = selectedLearningNode?.filePath ?? selectedCodeNode?.filePath;
  const focusOptions = viewMode === "learning"
    ? learningGraph.nodes
    : analysis?.nodes.filter((node) => node.type !== "file") ?? [];

  function changeView(nextMode: ViewMode): void {
    setViewMode(nextMode);
    const currentExists = nextMode === "learning"
      ? learningGraph.nodes.some((node) => node.id === selectedId)
      : analysis!.nodes.some((node) => node.id === selectedId);
    if (!currentExists) {
      const nextId = nextMode === "learning" ? learningGraph.nodes[0]?.id : focusId || preferredNodeId(analysis!);
      setSelectedId(nextId);
    }
  }

  function selectFeature(feature: RepositoryFeature): void {
    setSelectedFeatureId(feature.id);
    setFocusId(feature.entryNodeId);
    setSelectedId(feature.entryNodeId);
    setFocused(true);
    setLearningStageIndex(0);
    setLearningExpanded(false);
    if (viewMode === "developer") setDeveloperMode("feature");
  }

  function selectOverviewNode(nodeId: string): void {
    const node = overviewGraph.nodes.find((item) => item.id === nodeId);
    if (!node) return;
    setSelectedOverviewId(nodeId);
    if (node.codeNodeId) setSelectedId(node.codeNodeId);
    else setSelectedId(undefined);
    if (node.expandable) {
      setExpandedOverviewIds((current) => {
        const next = new Set(current);
        if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
        return next;
      });
    }
  }

  const overviewFeature = findOverviewFeature(selectedOverviewNode, [...featureDiscovery.primary, ...featureDiscovery.limited]);

  function openOverviewFeature(): void {
    if (!overviewFeature) return;
    setSelectedFeatureId(overviewFeature.id);
    setFocusId(overviewFeature.entryNodeId);
    setSelectedId(overviewFeature.entryNodeId);
    setFocused(true);
    setDeveloperMode("feature");
  }

  function selectLearningStage(index: number): void {
    const next = learningStages[index];
    if (!next) return;
    setLearningStageIndex(index);
    setLearningExpanded(false);
    setSelectedId(next.nodeIds[0]);
  }

  function submitGithub(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void runAnalysis({ source: "github", url: githubUrl.trim() });
  }

  const repositoryForm = (
    <section className="github-import-bar">
      <form onSubmit={submitGithub}>
        <Github size={17} />
        <label htmlFor="github-repository-url">GitHub 공개 저장소</label>
        <input
          id="github-repository-url"
          type="url"
          placeholder="https://github.com/owner/repo"
          value={githubUrl}
          onChange={(event) => setGithubUrl(event.target.value)}
          disabled={loading}
          required
        />
        <button type="submit" disabled={loading || !githubUrl.trim()}>
          {loading && lastRequest.source === "github" ? <LoaderCircle className="spin" size={14} /> : <Search size={14} />}
          저장소 분석
        </button>
        <button className="sample-button" type="button" disabled={loading} onClick={() => void runAnalysis({ source: "sample" })}>샘플 보기</button>
      </form>
      <small>공개 저장소만 지원하며 GitHub API 수집 제한이 적용됩니다.</small>
    </section>
  );

  if (!analysis) return (
    <main className="repository-workspace">
      {repositoryForm}
      <div className={`workspace-state ${error ? "error" : ""}`}>
        {error ? <AlertCircle /> : <LoaderCircle className="spin" />}
        <p>{error ?? "샘플 코드를 AST로 분석하고 있어요."}</p>
        {error && <button onClick={() => void runAnalysis(lastRequest)}>다시 시도</button>}
      </div>
    </main>
  );

  const showingOverview = viewMode === "developer" && isGithub && developerMode === "overview";
  const visibleNodeCount = viewMode === "learning" ? visibleLearningGraph.nodes.length : showingOverview ? overviewGraph.nodes.length : technicalGraph.nodes.length;
  const visibleEdgeCount = viewMode === "learning" ? visibleLearningGraph.edges.length : showingOverview ? overviewGraph.edges.length : technicalGraph.edges.length;

  return (
    <main className="repository-workspace">
      {repositoryForm}
      {error && <div className="analysis-alert error"><AlertCircle size={15} /><span>{error}</span><button onClick={() => setError(undefined)}>닫기</button></div>}
      {analysis.collection?.partial && <div className="analysis-alert warning"><AlertCircle size={15} /><span>일부 파일만 분석했습니다. {analysis.collection.notice}</span></div>}
      <section className="repository-feature-header">
        <div className="feature-title-block">
          <span className="eyebrow">{isGithub ? "GITHUB REPOSITORY" : "LOGIN FEATURE"} · {analysis.repository}</span>
          <h1>{isGithub ? "저장소 코드 구조" : "로그인 기능 흐름"}</h1>
          <p>{isGithub ? `기본 브랜치 ${analysis.collection?.defaultBranch ?? "-"}의 실제 소스코드를 AST로 분석했습니다.` : "사용자가 로그인 버튼을 클릭했을 때 어떤 코드가 실행되는지 단계별로 살펴보세요."}</p>
        </div>
        <div className="header-actions">
          <div className="analysis-status"><span /> AST 분석 완료 · 파일 {analysis.stats.files} · 함수 {analysis.stats.functions}{analysis.collection?.cached ? " · 캐시 결과" : ""}</div>
          <div className="view-toggle" role="group" aria-label="그래프 보기 방식">
            <button className={viewMode === "learning" ? "active" : ""} onClick={() => changeView("learning")}><GraduationCap size={15} /> 학습용 보기</button>
            <button className={viewMode === "developer" ? "active" : ""} onClick={() => changeView("developer")}><Braces size={15} /> 개발자 보기</button>
          </div>
        </div>
      </section>

      {isGithub && viewMode === "learning" && <div className="learning-unavailable"><GraduationCap size={14} /> 실제 AST에서 확인된 관계만 쉬운 역할명으로 바꿔 표시합니다. 실행 순서나 조건은 임의로 만들지 않습니다.</div>}

      <section className="workspace-toolbar">
        <div className="current-view-copy">
          <strong>{showingOverview ? "저장소 전체 구조" : selectedFeature?.title ?? (viewMode === "learning" ? "코드 흐름을 쉬운 말로 읽어보세요" : "AST가 추출한 기술 관계를 확인하세요")}</strong>
          <span>{visibleNodeCount}개 단계 · {visibleEdgeCount}개 연결</span>
          {viewMode === "developer" && isGithub && <div className="developer-mode-toggle">
            <button className={developerMode === "overview" ? "active" : ""} onClick={() => setDeveloperMode("overview")}>전체 구조 보기</button>
            <button className={developerMode === "feature" ? "active" : ""} onClick={() => setDeveloperMode("feature")}>기능별 상세 보기</button>
          </div>}
        </div>
        <div className={`focus-controls ${isGithub ? "feature-mode" : ""}`}>
          {isGithub ? (
            <FeaturePicker discovery={featureDiscovery} selectedFeatureId={selectedFeatureId} onSelect={selectFeature} />
          ) : (
            <><Search size={15} />
              <select value={focusId} onChange={(event) => { setFocusId(event.target.value); setSelectedId(event.target.value); }} aria-label="탐색 시작 단계">
                {focusOptions.map((node) => (
                  <option key={node.id} value={node.id}>{"title" in node ? node.title : node.name}</option>
                ))}
              </select>
              <ChevronDown size={14} /></>
          )}
          {!showingOverview && <label>코드 연결 탐색 범위 <input type="number" min={1} max={8} value={depth} onChange={(event) => setDepth(Number(event.target.value))} />단계</label>}
          {showingOverview ? null : viewMode === "learning" && isGithub
            ? <button className="focus-button" onClick={() => setLearningExpanded((value) => !value)} disabled={!currentLearningStage}><Maximize2 size={14} /> {learningExpanded ? "핵심만 보기" : "전체 관계 확장"}</button>
            : <button className="focus-button" onClick={() => setFocused(true)} disabled={isGithub && !selectedFeature}><Play size={14} fill="currentColor" /> 흐름 추적</button>}
          {focused && !showingOverview && !(viewMode === "learning" && isGithub) && <button className="icon-button" onClick={() => setFocused(false)} title="전체 흐름 보기"><RefreshCw size={15} /></button>}
        </div>
      </section>

      {viewMode === "learning" && isGithub && currentLearningStage && (
        <section className="learning-journey" aria-label="기능 학습 단계">
          <div className="learning-journey-intro">
            <span>선택한 기능</span>
            <strong>{selectedFeature?.title ?? "저장소 기능"}</strong>
            <p>{learningFeatureSummary ?? "실제 AST 관계를 단계별로 살펴봅니다."}</p>
          </div>
          <div className="learning-stage-track">
            {learningStages.map((stage, index) => (
              <button key={stage.id} className={index === learningStageIndex ? "active" : index < learningStageIndex ? "done" : ""} onClick={() => selectLearningStage(index)}>
                <span>{index + 1}</span><strong>{stage.title}</strong><small>{stage.nodeIds.length}개 코드</small>
              </button>
            ))}
          </div>
          <div className="learning-stage-navigation">
            <button disabled={learningStageIndex === 0} onClick={() => selectLearningStage(learningStageIndex - 1)}><ArrowLeft size={13} /> 이전</button>
            <div><strong>{currentLearningStage.title}</strong><span>{currentLearningStage.description}</span></div>
            <button disabled={learningStageIndex >= learningStages.length - 1} onClick={() => selectLearningStage(learningStageIndex + 1)}>다음 <ArrowRight size={13} /></button>
          </div>
        </section>
      )}

      <section className="workspace-grid">
        <aside className="tree-panel">
          <div className="panel-heading"><span>저장소 파일</span><small>{analysis.stats.files}</small></div>
          <RepositoryTree files={analysis.files} selectedPath={selectedPath} rootName={analysis.repository} />
          <div className="tree-tip"><GraduationCap size={14} /><p>{isGithub ? "GitHub에서 수집한 파일 중 AST 분석 대상만 표시합니다." : "학습용 보기는 실제 코드 관계에 설명용 단계를 더해 흐름을 쉽게 보여줍니다."}</p></div>
        </aside>
        <div className={`flow-panel ${viewMode}`}>
          <div className="flow-caption">
            <div><strong>{showingOverview ? "프로젝트 → 모듈 → 파일 → 함수" : focused ? selectedFeature?.title ?? "선택한 단계부터 흐름 추적" : viewMode === "learning" ? (isGithub ? "핵심 학습 흐름" : "로그인 학습 흐름") : "기술 코드 그래프"}</strong><span>{showingOverview ? "점선은 폴더·파일 포함 관계이고, 실선은 AST에서 확인된 코드 의존 관계입니다." : selectedFeature?.limited ? "정적 분석에서 연결을 찾지 못해 시작 노드만 표시합니다. 실제 런타임 연결이 있을 수 있습니다." : selectedFeature?.description ?? "카드를 선택하면 오른쪽에서 자세히 설명해 드려요."}</span></div>
            {showingOverview ? overviewGraph.truncated && <span className="filter-chip">요약됨 · {overviewGraph.hiddenNodeCount}개 숨김</span> : focused && <span className="filter-chip">탐색 범위 {depth}단계</span>}
          </div>
          {viewMode === "learning" ? (
            visibleLearningGraph.nodes.length > 0
              ? <LearningFlow learningNodes={visibleLearningGraph.nodes} learningEdges={visibleLearningGraph.edges} selectedId={selectedId} onSelect={setSelectedId} />
              : <div className="flow-empty"><AlertCircle size={22} /><strong>표시할 학습 노드가 없습니다.</strong><span>다른 기능을 선택하거나 개발자 보기에서 분석 결과를 확인해 주세요.</span></div>
          ) : (
            showingOverview
              ? <RepositoryOverviewFlow overviewNodes={overviewGraph.nodes} overviewEdges={overviewGraph.edges} selectedId={selectedOverviewId} onSelect={selectOverviewNode} />
              : technicalGraph.nodes.length > 0
              ? <CodeFlow codeNodes={technicalGraph.nodes} codeEdges={technicalGraph.edges} onSelect={setSelectedId} />
              : <div className="flow-empty"><AlertCircle size={22} /><strong>표시할 기술 노드가 없습니다.</strong><span>선택한 기능에서 AST 관계를 찾지 못했습니다.</span></div>
          )}
        </div>
        <aside className="inspector-panel">
          <div className="panel-heading"><span>{viewMode === "learning" ? "단계 상세 설명" : showingOverview ? "구조 탐색 정보" : "개발자 정보"}</span></div>
          {viewMode === "learning" ? (
            <LearningInspector key={selectedLearningNode?.id ?? "empty"} node={selectedLearningNode} />
          ) : showingOverview && !selectedCodeNode ? (
            <RepositoryOverviewInspector node={selectedOverviewNode} canOpenFeature={Boolean(overviewFeature)} onOpenFeature={openOverviewFeature} />
          ) : (
            <NodeInspector node={selectedCodeNode} edges={analysis.edges} allNodes={analysis.nodes} />
          )}
        </aside>
      </section>
    </main>
  );
}
