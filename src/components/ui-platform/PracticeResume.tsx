"use client";

import { useEffect, useState } from "react";
import { Crosshair } from "lucide-react";
import { practiceTopics } from "./PracticeDashboard";
import { LocalPracticeLink } from "./LocalPracticeLink";

export const LAST_PRACTICE_KEY = "vulnlab:last-practice";

export function PracticeResume() {
  const [last, setLast] = useState<string | null>(null);
  useEffect(() => {
    const restore = () => {
      try { setLast(localStorage.getItem(LAST_PRACTICE_KEY)); } catch { /* Storage is optional. */ }
    };
    const frame = requestAnimationFrame(restore);
    window.addEventListener("focus", restore);
    window.addEventListener("storage", restore);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("focus", restore);
      window.removeEventListener("storage", restore);
    };
  }, []);
  const index = practiceTopics.findIndex(topic => topic.id === last);
  const current = practiceTopics[Math.max(index, 0)];
  const next = practiceTopics.slice(Math.max(index, 0) + 1);
  return <>
    <div className="vl-feature"><span className="vl-icon"><Crosshair size={22}/></span><div><h3>{current.title}</h3><p>{index < 0 ? "첫 번째 실습부터 차근차근 시작해보세요." : "마지막으로 연 실습입니다. 이어서 연습해보세요."}</p></div></div>
    <div className="vl-actions"><LocalPracticeLink className="vl-button" href={`${current.url}${current.url.includes("?") ? "&" : "?"}mode=guided`} target="_blank" rel="noopener noreferrer">{index < 0 ? "첫 실습 시작하기" : `${current.title} 이어하기`} ↗</LocalPracticeLink></div>
    {next.length > 0 && <div className="vl-resume-next"><strong>다음 실습</strong><div className="vl-actions">{next.map(topic => <LocalPracticeLink key={topic.id} className="vl-text-link" href={`${topic.url}${topic.url.includes("?") ? "&" : "?"}mode=guided`} target="_blank" rel="noopener noreferrer">{topic.title} →</LocalPracticeLink>)}</div></div>}
    <p className="vl-small">마지막으로 연 주제는 이 브라우저에 저장됩니다. 실습 내부 단계는 새로 시작합니다.</p>
  </>;
}
