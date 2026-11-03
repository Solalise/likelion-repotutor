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
  const nodeMap = new Map(allNodes.map((item) => [item.id, item]));
  const outgoingGroups = new Map<string, { relation: CodeEdge["relation"]; target: CodeNode; occurrences: CodeEdge[] }>();
  for (const edge of edges.filter((item) => item.source === node.id)) {
    const target = nodeMap.get(edge.target);
    if (!target) continue;
    const key = `${edge.relation}:${edge.source}->${edge.target}`;
    const current = outgoingGroups.get(key);
    if (current) current.occurrences.push(edge);
    else outgoingGroups.set(key, { relation: edge.relation, target, occurrences: [edge] });
  }
  const outgoing = [...outgoingGroups.values()];
  return (
    <div className="inspector-content">
      <div className={`node-type-badge ${node.type}`}>개발자 정보 · {node.type}</div>
      <h2>{node.name}{node.type !== "file" && "()"}</h2>
      <dl>
        <div><dt><FileCode2 size={14} /> 파일</dt><dd>{node.filePath}</dd></div>
        {node.line && <div><dt><Braces size={14} /> 위치</dt><dd>line {node.line}</dd></div>}
        <div><dt><GitBranch size={14} /> 연결</dt><dd>{outgoing.length}개</dd></div>
      </dl>
      {outgoing.length > 0 && <div className="call-list"><span>실제 AST 관계</span>{outgoing.map(({ relation, target, occurrences }) => (
        <div key={`${relation}:${target.id}`}>
          {relation} → {target.name}{target.type !== "file" && "()"}{occurrences.length > 1 ? ` · ${occurrences.length}회` : ""}
          {occurrences.map((edge) => <small key={edge.id} title={edge.evidence}>
            {edge.line ? `line ${edge.line}` : "위치 정보 없음"}{edge.confidence === "inferred" ? " · 추정" : " · 확인됨"}{edge.evidence ? ` · ${edge.evidence}` : ""}
          </small>)}
        </div>
      ))}</div>}
      <section className="developer-code-section"><span>소스 코드</span><SourceCodeViewer key={node.id} sourceCode={node.sourceCode} startLine={node.line ?? 1} highlightLine={node.line ?? 1} /></section>
    </div>
  );
}
