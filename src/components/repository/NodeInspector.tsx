import { Braces, FileCode2, GitBranch, LocateFixed } from "lucide-react";
import type { CodeEdge, CodeNode } from "@/types/analysis";

interface NodeInspectorProps {
  node?: CodeNode;
  edges: CodeEdge[];
  allNodes: CodeNode[];
}

export function NodeInspector({ node, edges, allNodes }: NodeInspectorProps) {
  if (!node) {
    return <div className="empty-inspector"><LocateFixed size={26} /><p>기술 그래프에서 노드를 선택하면<br />분석 정보를 확인할 수 있어요.</p></div>;
  }
  const targets = edges.filter((edge) => edge.source === node.id).map((edge) => allNodes.find((item) => item.id === edge.target)).filter(Boolean) as CodeNode[];
  return (
    <div className="inspector-content">
      <div className={`node-type-badge ${node.type}`}>개발자 정보 · {node.type}</div>
      <h2>{node.name}{node.type !== "file" && "()"}</h2>
      <dl>
        <div><dt><FileCode2 size={14} /> 파일</dt><dd>{node.filePath}</dd></div>
        {node.line && <div><dt><Braces size={14} /> 위치</dt><dd>line {node.line}</dd></div>}
        <div><dt><GitBranch size={14} /> 연결</dt><dd>{targets.length}개</dd></div>
      </dl>
      {targets.length > 0 && <div className="call-list"><span>호출 / 참조</span>{targets.map((target) => <div key={target.id}>{target.name}{target.type !== "file" && "()"}</div>)}</div>}
      <div className="ai-preview"><span>AI 설명</span><p>다음 단계에서 이 노드와 DFS로 찾은 관련 코드만 AI에 전달해 학습 설명을 생성합니다.</p></div>
    </div>
  );
}
