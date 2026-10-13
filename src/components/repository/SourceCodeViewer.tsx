"use client";

import { useMemo, useState } from "react";

interface SourceCodeViewerProps {
  sourceCode?: string;
  startLine?: number;
  highlightLine?: number;
  initialLineCount?: number;
}

export function SourceCodeViewer({ sourceCode, startLine = 1, highlightLine = startLine, initialLineCount = 12 }: SourceCodeViewerProps) {
  const [expanded, setExpanded] = useState(false);
  const lines = useMemo(() => sourceCode?.split("\n") ?? [], [sourceCode]);
  if (!sourceCode) return <div className="code-unavailable">분석 결과에 표시할 소스 코드가 없습니다.</div>;
  const visible = expanded ? lines : lines.slice(0, initialLineCount);
  return <>
    <div className="learning-code-block">
      {visible.map((line, index) => {
        const lineNumber = startLine + index;
        return <div key={`${lineNumber}:${line}`} className={lineNumber === highlightLine ? "highlight" : ""}><span>{lineNumber}</span><code>{line || " "}</code></div>;
      })}
    </div>
    {lines.length > initialLineCount && <button className="code-expand-button" onClick={() => setExpanded((value) => !value)}>{expanded ? "핵심 부분만 보기" : `코드 더 보기 (${lines.length - initialLineCount}줄)`}</button>}
  </>;
}
