"use client";

import { useEffect, useState } from "react";
import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";
import type { BehaviorFeaturesResponse, BehaviorGraphResponse, BehaviorNodeDetail, BehaviorCfgResponse } from "@/types/behaviorQuery";
import { BehaviorGraph, kindLabels } from "./BehaviorGraph";
import { behaviorNodeTitle } from "./behaviorPresentation";
import { queryBehavior, type BehaviorSource } from "./behaviorClient";

function State({ text, busy = false }: { text: string; busy?: boolean }) {
  return <div className="behavior-empty" role="status">{busy ? <LoaderCircle className="spin" size={21} /> : <AlertCircle size={21} />}<p>{text}</p></div>;
}
function Facts({ title, items, total }: { title: string; items: Array<Record<string, unknown>>; total: number }) {
  return total > 0 && <details className="behavior-facts"><summary>{title} · {total}개{total > items.length ? ` (처음 ${items.length}개)` : ""}</summary>{items.map((item, index) => <pre key={index}>{JSON.stringify(item, null, 2)}</pre>)}</details>;
}

export function BehaviorWorkspace({ source }: { source: BehaviorSource }) {
  const sourceKey = JSON.stringify(source);
  const [features, setFeatures] = useState<BehaviorFeaturesResponse>();
  const [featureId, setFeatureId] = useState<string>();
  const [loadedGraph, setGraph] = useState<BehaviorGraphResponse>();
  const [nodeId, setNodeId] = useState<string>();
  const [loadedDetail, setDetail] = useState<BehaviorNodeDetail>();
  const [cfg, setCfg] = useState<BehaviorCfgResponse>();
  const [cfgWanted, setCfgWanted] = useState(false);
  const [statementId, setStatementId] = useState<string>();
  const [codeOffset, setCodeOffset] = useState(0);
  const [error, setError] = useState<string>();
  const [reload, setReload] = useState(0);
  const [listBusy, setListBusy] = useState(true);
  const [flowBusy, setFlowBusy] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [cfgBusy, setCfgBusy] = useState(false);

  function fail(reason: unknown) {
    // Do not leave previously fetched source visible after a denied/unverifiable request.
    setError(reason instanceof Error ? reason.message : "흐름을 조회하지 못했습니다.");
    setFeatures(undefined); setGraph(undefined); setDetail(undefined); setCfg(undefined); setFeatureId(undefined); setNodeId(undefined);
  }
  useEffect(() => {
    const controller = new AbortController();
    queryBehavior<BehaviorFeaturesResponse>(JSON.parse(sourceKey) as BehaviorSource, { view: "features" }, controller.signal)
      .then(setFeatures).catch(reason => { if (!controller.signal.aborted) fail(reason); })
      .finally(() => { if (!controller.signal.aborted) setListBusy(false); });
    return () => controller.abort();
  }, [sourceKey, reload]);

  const analysisId = features?.snapshot.analysisId;
  useEffect(() => {
    if (!analysisId || !featureId) return;
    const controller = new AbortController();
    queryBehavior<BehaviorGraphResponse>(JSON.parse(sourceKey) as BehaviorSource, { view: "flow", analysisId, featureId }, controller.signal)
      .then(setGraph).catch(reason => { if (!controller.signal.aborted) fail(reason); })
      .finally(() => { if (!controller.signal.aborted) setFlowBusy(false); });
    return () => controller.abort();
  }, [analysisId, featureId, sourceKey]);

  useEffect(() => {
    if (!analysisId || !featureId || !nodeId) return;
    const controller = new AbortController();
    queryBehavior<BehaviorNodeDetail>(JSON.parse(sourceKey) as BehaviorSource, { view: "node", analysisId, featureId, nodeId, codeOffset: String(codeOffset) }, controller.signal)
      .then(setDetail).catch(reason => { if (!controller.signal.aborted) fail(reason); })
      .finally(() => { if (!controller.signal.aborted) setDetailBusy(false); });
    return () => controller.abort();
  }, [analysisId, featureId, nodeId, codeOffset, sourceKey]);

  useEffect(() => {
    if (!cfgWanted || !analysisId || !featureId || !nodeId) return;
    const controller = new AbortController();
    queryBehavior<BehaviorCfgResponse>(JSON.parse(sourceKey) as BehaviorSource, { view: "cfg", analysisId, featureId, nodeId }, controller.signal)
      .then(setCfg).catch(reason => { if (!controller.signal.aborted) fail(reason); })
      .finally(() => { if (!controller.signal.aborted) setCfgBusy(false); });
    return () => controller.abort();
  }, [cfgWanted, analysisId, featureId, nodeId, sourceKey]);

  const graph = loadedGraph?.featureId === featureId && loadedGraph?.snapshot.analysisId === analysisId ? loadedGraph : undefined;
  const detail = loadedDetail?.featureId === featureId && loadedDetail?.node.id === nodeId ? loadedDetail : undefined;
  const selectedFeature = features?.features.find(feature => feature.id === featureId);
  const statement = cfg?.statements.find(item => item.id === cfg.nodes.find(node => node.id === statementId)?.statementId);
  return <section className="behavior-workspace" aria-label="BehaviorFlow 동작 흐름">
    <div className="behavior-intro"><div><strong>코드 근거로 보는 동작 흐름</strong><p>정적 코드 관계를 표시합니다. 화살표와 화면 배치는 실제 실행 순서·성공을 보장하지 않습니다.</p></div><button className="focus-button" onClick={() => { setFeatures(undefined); setFeatureId(undefined); setGraph(undefined); setDetail(undefined); setCfg(undefined); setNodeId(undefined); setError(undefined); setListBusy(true); setReload(value => value + 1); }}><RefreshCw size={14} /> 목록 새로고침</button></div>
    {source.source === "sample" && <div className="analysis-alert warning">샘플 저장소의 실제 AST 분석입니다. 연결한 GitHub 저장소의 결과가 아닙니다.</div>}
    {error && <div className="analysis-alert error" role="alert">{error} 기존 저장소 분석 버튼으로 재분석하거나 목록을 새로고침해 주세요.</div>}
    {features?.snapshot.sourcePartial && <div className="analysis-alert warning">원본 파일 수집이 부분 완료되었습니다. 누락된 연결이 있을 수 있습니다.</div>}
    <div className="behavior-columns">
      <aside className="behavior-features" aria-label="동작 흐름 기능 목록"><div className="panel-heading"><span>기능 목록</span><small>{features?.features.length ?? 0}</small></div>
        {listBusy ? <State busy text="기능 요약을 불러오고 있어요." /> : !features?.features.length ? <State text={error ? "목록을 새로고침해 주세요." : "확인된 페이지·API 진입점이 없습니다."} /> : features.features.map(feature => <button key={feature.id} className={`behavior-feature ${feature.id === featureId ? "active" : ""}`} aria-pressed={feature.id === featureId} onClick={() => { if (featureId === feature.id) return; setGraph(undefined); setFlowBusy(true); setCfgWanted(false); setFeatureId(feature.id); setNodeId(undefined); setDetail(undefined); setCfg(undefined); setStatementId(undefined); }}>
          <strong>{feature.name}</strong><span>{feature.entryPoint.method ?? (feature.entryPoint.kind === "page" ? "페이지" : "API")} · {feature.entryPoint.routePath}</span>
          <small>{feature.status} · {feature.flowStatus === "not-generated" ? "not-generated · 선택 시 흐름 조회" : "캐시된 흐름"}</small>
          <small>미해결 {feature.unresolved.count}개 · {feature.unresolved.basis === "source-scope" ? "발견 범위 기준" : "흐름 기준"}</small>
          {feature.truncation.analysis && <small>truncated · 분석 잘림</small>}
        </button>)}
      </aside>
      <div className="behavior-center"><div className="panel-heading"><span>{cfg ? "선택 함수 내부 CFG" : selectedFeature?.name ?? "기능의 코드 동작 흐름"}</span>{cfg && <button onClick={() => { setCfg(undefined); setCfgWanted(false); setStatementId(undefined); }}>기능 흐름으로</button>}</div>
        {graph && <div className="behavior-notices" role="status"><span>{graph.status} · 서버 초기 표시 데이터 {graph.nodes.length}노드 / 조회 가능 {graph.available.nodes}노드 · 미지원 {graph.unsupportedRegions}구간</span>
          {graph.truncation.analysis && <p><strong>truncated · 원본 분석이 잘렸습니다.</strong> {graph.truncation.reasons.join(", ")} · 누락 수는 알 수 없으며 화면 확장으로 복구되지 않습니다.</p>}
          {graph.truncation.projection && <p>화면 제한으로 노드 {graph.truncation.knownHiddenNodes}개·관계 {graph.truncation.knownHiddenEdges}개를 숨겼습니다. 이번 화면은 초기 흐름만 표시합니다.</p>}
          <span>미해결 {Object.values(graph.unresolved).reduce((a, b) => a + b, 0)}개 · 점선: 참조·코드 포함 또는 미확인 관계</span>
          {cfg && <p>함수 내부의 정적 경로입니다. Yes/No는 조건 경로이며 실제 선택 결과가 아닙니다. {cfg.nextOffset !== null && "CFG 첫 페이지만 표시합니다."} {cfg.hiddenEdges > 0 && `미표시 관계 ${cfg.hiddenEdges}개`}</p>}
        </div>}
        <div className="behavior-canvas">{flowBusy ? <State busy text="선택한 기능의 초기 흐름을 생성하고 있어요." /> : graph?.nodes.length ? <BehaviorGraph graph={graph} cfg={cfg} detail={detail} selectedId={cfg ? statementId : nodeId} onSelect={id => {
          if (cfg) { setStatementId(id); return; }
          if (id === nodeId) return;
          setDetail(undefined); setDetailBusy(true); setCodeOffset(0); setNodeId(id); setCfg(undefined); setCfgWanted(false); setStatementId(undefined);
        }} /> : <State text={featureId ? "표시할 확인된 흐름이 없습니다." : "왼쪽에서 기능을 선택해 주세요."} />}</div>
      </div>
      <aside className="behavior-inspector" aria-label="선택 노드 정보"><div className="panel-heading">선택 노드 정보</div>
        {detailBusy ? <State busy text="선택한 노드의 코드 근거를 조회하고 있어요." /> : detail ? <div className="behavior-detail">
          <small>{kindLabels[detail.node.kind] ?? detail.node.kind}</small><h2>{behaviorNodeTitle(detail.node, detail, graph)}</h2><span className="filter-chip">{detail.node.confidence} · {graph?.status}</span>
          <p>{detail.node.origin === "metadata" ? "확인된 분석 범위의 코드 위치입니다. 코드 포함 관계를 실행 호출로 해석하지 마세요." : "AST에서 추출한 코드 관계입니다. 런타임 실행은 관측하지 않았습니다."}</p>
          {detail.code ? <><p className="behavior-path">{detail.code.filePath}<br />{detail.code.startLine}:{detail.code.startColumn}–{detail.code.endLine}:{detail.code.endColumn}</p><pre className="behavior-source"><code>{detail.code.text}</code></pre>
            <div className="behavior-code-paging">{codeOffset > 0 && <button onClick={() => { setDetail(undefined); setDetailBusy(true); setCodeOffset(0); }}>처음 코드</button>}{detail.code.nextOffset !== null && <button onClick={() => { setDetail(undefined); setDetailBusy(true); setCodeOffset(detail.code!.nextOffset!); }}>다음 코드 범위</button>}</div></> : <p>확인된 코드 위치가 없습니다.</p>}
          {detail.reasons.length > 0 && <p>분석 한계: {detail.reasons.join(", ")}</p>}
          {detail.cfg.available && <button className="focus-button" disabled={cfgBusy} onClick={() => { if (cfgWanted) return; setCfgBusy(true); setCfgWanted(true); }}>{cfgBusy ? "CFG 조회 중…" : "함수 내부 조건·경로 보기"}</button>}
          {statement && <section><h3>선택한 내부 문장 · {statement.kind}</h3><p>{statement.condition ?? statement.unsupportedReason ?? "정적 문장 위치"}</p><pre>{JSON.stringify(statement.location, null, 2)}</pre></section>}
          <Facts title="HTTP·DB·응답 및 조건 문맥" items={detail.facts.items} total={detail.facts.total} />
          <Facts title="관련 함수 호출" items={detail.calls.items} total={detail.calls.total} />
          <Facts title="이벤트 바인딩" items={detail.bindings.items} total={detail.bindings.total} />
          <details className="behavior-facts"><summary>코드 근거 · {detail.evidence.total}개 (현재 {detail.evidence.items.length}개)</summary>{detail.evidence.items.map(item => <p key={item.index}>{item.kind} · {item.filePath}:{item.startLine ?? "위치 미확인"}{item.excerpt && <code>{item.excerpt}</code>}</p>)}</details>
        </div> : <State text="노드를 클릭하면 코드와 분석 상태를 확인할 수 있어요." />}
      </aside>
    </div>
  </section>;
}
