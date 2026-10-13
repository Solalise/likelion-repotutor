"use client";

import { ArrowRight, BookOpen, Code2, FileCode2, Lightbulb, LocateFixed, Sparkles } from "lucide-react";
import type { LearningNode } from "@/types/learning";
import { SourceCodeViewer } from "./SourceCodeViewer";

interface LearningInspectorProps {
  node?: LearningNode;
}

export function LearningInspector({ node }: LearningInspectorProps) {
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
      <section className="explanation-section connection">
        <h3><ArrowRight size={14} /> 다른 코드와 왜 연결되나요?</h3>
        <p>{node.connectionReason}</p>
      </section>
      {(node.incomingRelations.length > 0 || node.outgoingRelations.length > 0) && (
        <section className="relation-detail-section">
          {node.incomingRelations.length > 0 && <div><strong>이 코드를 참조하는 코드</strong>{node.incomingRelations.map((item) => <p key={item}>{item}</p>)}</div>}
          {node.outgoingRelations.length > 0 && <div><strong>이 코드가 연결하는 코드</strong>{node.outgoingRelations.map((item) => <p key={item}>{item}</p>)}</div>}
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
          ? "확실함 · AST 관계로 확인된 코드 단계"
          : node.source === "ast"
            ? "제한적 · AST에서 직접 연결을 확인하지 못한 코드"
            : "데모 이해를 위한 보조 학습 단계"}
      </div>
      {node.source === "ast" && <p className="interpretation-note">함수명·파일 경로를 바탕으로 만든 한국어 역할 설명은 학습을 위한 해석이며, 코드 관계와 경로는 실제 AST에서 확인된 사실입니다.</p>}
    </div>
  );
}
