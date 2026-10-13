import { Boxes, ExternalLink, FileCode2, FolderTree, LocateFixed } from "lucide-react";
import type { RepositoryOverviewNode } from "@/types/overview";

interface RepositoryOverviewInspectorProps {
  node?: RepositoryOverviewNode;
  canOpenFeature: boolean;
  onOpenFeature: () => void;
}

export function RepositoryOverviewInspector({ node, canOpenFeature, onOpenFeature }: RepositoryOverviewInspectorProps) {
  if (!node) return <div className="empty-inspector"><LocateFixed size={26} /><p>모듈이나 파일을 선택하면<br />하위 구조와 분석 정보를 확인할 수 있어요.</p></div>;
  return <div className="inspector-content overview-inspector">
    <div className={`node-type-badge ${node.type}`}>전체 구조 · {node.type}</div>
    <h2>{node.name}</h2>
    <dl>
      <div><dt><FolderTree size={14} /> 경로 / 범위</dt><dd>{node.subtitle}</dd></div>
      {typeof node.fileCount === "number" && <div><dt><FileCode2 size={14} /> 파일</dt><dd>{node.fileCount}개</dd></div>}
      {typeof node.symbolCount === "number" && <div><dt><Boxes size={14} /> 함수·컴포넌트</dt><dd>{node.symbolCount}개</dd></div>}
    </dl>
    {node.expandable && <p className="overview-help">중앙 노드를 선택하면 {node.expanded ? "하위 구조를 접습니다." : "실제 분석된 하위 구조를 펼칩니다."}</p>}
    {canOpenFeature && <button className="open-feature-button" onClick={onOpenFeature}>기능별 상세 그래프로 이동 <ExternalLink size={13} /></button>}
    {!canOpenFeature && node.type !== "project" && <p className="overview-limit">이 항목과 정확히 일치하는 기능 그룹을 찾지 못했습니다. 하위 파일과 함수 정보는 계속 탐색할 수 있습니다.</p>}
  </div>;
}
