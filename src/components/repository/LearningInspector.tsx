"use client";

import { ArrowRight, BookOpen, Code2, FileCode2, Lightbulb, LocateFixed, Sparkles } from "lucide-react";
import type { LearningNode } from "@/types/learning";
import { SourceCodeViewer } from "./SourceCodeViewer";

interface LearningInspectorProps {
  node?: LearningNode;
  onExplain?: () => void;
}

export function LearningInspector({ node, onExplain }: LearningInspectorProps) {
  if (!node) {
    return (
      <div className="empty-inspector">
        <LocateFixed size={26} />
        <p>코드 흐름에서 단계를 선택하면<br />쉬운 설명을 확인할 수 있어요.</p>
      </div>
    );
  }

  return (
    <div className="learning-inspector-content">
      <div className="learning-inspector-kicker"><Sparkles size={12} /> 선택한 단계</div>
      <h2>{node.title}</h2>
      {node.technicalName && <code className="technical-name">{node.technicalName}()</code>}
      <div className="inspector-meta">
        <span>{node.category === "ui-action" ? "화면 동작" : node.category === "database" ? "데이터 조회" : node.category}</span>
        {node.filePath && <p><FileCode2 size={13} /> {node.filePath}{node.line ? ` · line ${node.line}` : ""}</p>}
      </div>

      <section className="explanation-section">
        <h3><BookOpen size={14} /> 이 단계는 무엇을 하나요?</h3>
        <p>{node.description}</p>
      </section>
      <section className="explanation-section purpose">
        <h3><Lightbulb size={14} /> 왜 필요한가요?</h3>
        <p>{node.purpose}</p>
      </section>
      {node.source === "ast" && <section className="explanation-section role-evidence">
        <h3><BookOpen size={14} /> 확인된 사실과 역할 해석</h3>
        <p><strong>{node.roleConfidence === "confirmed" ? "정적 근거가 있는 역할" : node.roleConfidence === "inferred" ? "추정한 역할" : "역할 판단 근거 부족"}</strong> · {node.roleBasis ?? "원본 코드 확인이 필요합니다."}</p>
        {node.facts?.length ? <ul>{node.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul> : <p>추가로 확인된 구조 정보가 없습니다.</p>}
        <small>관계의 정적 확인과 역할 해석은 별개입니다. 실행 결과와 순서를 보장하지 않습니다.</small>
      </section>}
      {onExplain && <button className="focus-button" onClick={onExplain}><Sparkles size={14} /> 기존 AI 설명으로 이동</button>}
      <section className="explanation-section connection">
        <h3><ArrowRight size={14} /> 다른 코드와 왜 연결되나요?</h3>
        <p>{node.connectionReason}</p>
      </section>
      {(node.incomingRelations.length > 0 || node.outgoingRelations.length > 0) && (
        <section className="relation-detail-section">
          {node.incomingRelations.length > 0 && <RelationGroup title="이전 연결 · 이 함수를 사용하는 코드" relations={node.incomingRelations} />}
          {node.outgoingRelations.length > 0 && <RelationGroup title="다음 연결 · 이 함수가 사용하는 코드" relations={node.outgoingRelations} />}
          <small>화살표는 AST 관계 방향이며 실제 실행 순서를 보장하지 않습니다.</small>
        </section>
      )}
      {node.codeSnippet && (
        <section className="code-section">
          <h3><Code2 size={14} /> 핵심 소스 코드</h3>
          <SourceCodeViewer sourceCode={node.codeSnippet} startLine={node.line} highlightLine={node.line} />
        </section>
      )}
      {!node.codeSnippet && <div className="code-unavailable">이 노드에서 표시할 함수 또는 컴포넌트 본문을 확보하지 못했습니다.</div>}
      {node.nextStep && node.source === "demo" && (
        <section className="next-step-section">
          <span>다음 단계</span>
          <p>{node.nextStep}</p>
          <ArrowRight size={15} />
        </section>
      )}
      {node.relatedFiles.length > 0 && (
        <section className="related-files-section">
          <span>관련 파일</span>
          {node.relatedFiles.map((file) => <code key={file}>{file}</code>)}
        </section>
      )}
      <div className={`source-note ${node.source}`}>
        {node.source === "ast" && node.confidence === "confirmed"
          ? "정적 관계 확인 · 실제 실행 여부와 순서는 보장하지 않습니다."
          : node.source === "ast"
            ? "제한적 · 연결 근거가 없거나 추정 관계를 포함한 코드"
            : "데모 이해를 위한 보조 학습 단계"}
      </div>
      {node.source === "ast" && <p className="interpretation-note">코드와 위치는 AST 분석 원본입니다. 역할 근거와 관계별 신뢰도를 구분해 읽어 주세요. 이전·다음은 관계 방향이며 시간 순서가 아닙니다. 함수 참조·전달은 콜백 실행을 의미하지 않습니다.</p>}
    </div>
  );
}

function RelationGroup({ title, relations }: { title: string; relations: string[] }) {
  const visible = relations.slice(0, 3);
  const remaining = relations.slice(3);
  return <div>
    <strong>{title}</strong>
    {visible.map((item) => <p key={item}>{item}</p>)}
    {remaining.length > 0 && <details><summary>나머지 관계 {remaining.length}개</summary>{remaining.map((item) => <p key={item}>{item}</p>)}</details>}
  </div>;
}
