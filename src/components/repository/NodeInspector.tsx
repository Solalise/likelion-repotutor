import { Braces, FileCode2, GitBranch, LocateFixed } from "lucide-react";
import type { CodeEdge, CodeNode } from "@/types/analysis";
import { SourceCodeViewer } from "./SourceCodeViewer";

interface NodeInspectorProps {
  node?: CodeNode;
  edges: CodeEdge[];
  allNodes: CodeNode[];
}

export function NodeInspector({ node, edges, allNodes }: NodeInspectorProps) {
  if (!node) {
    return <div className="empty-inspector"><LocateFixed size={26} /><p>기술 그래프에서 노드를 선택하면<br />분석 정보를 확인할 수 있어요.</p></div>;
  }
  const outgoing = edges.filter((edge) => edge.source === node.id).flatMap((edge) => {
    const target = allNodes.find((item) => item.id === edge.target);
    return target ? [{ edge, target }] : [];
  });
  return (
    <div className="inspector-content">
      <div className={`node-type-badge ${node.type}`}>개발자 정보 · {node.type}</div>
      <h2>{node.name}{node.type !== "file" && "()"}</h2>
      <dl>
        <div><dt><FileCode2 size={14} /> 파일</dt><dd>{node.filePath}</dd></div>
        {node.line && <div><dt><Braces size={14} /> 위치</dt><dd>line {node.line}</dd></div>}
        <div><dt><GitBranch size={14} /> 연결</dt><dd>{outgoing.length}개</dd></div>
      </dl>
      {outgoing.length > 0 && <div className="call-list"><span>실제 AST 관계</span>{outgoing.map(({ edge, target }) => <div key={edge.id}>{edge.relation} → {target.name}{target.type !== "file" && "()"}</div>)}</div>}
      <section className="developer-code-section"><span>소스 코드</span><SourceCodeViewer key={node.id} sourceCode={node.sourceCode} startLine={node.line ?? 1} highlightLine={node.line ?? 1} /></section>
    </div>
  );
}
