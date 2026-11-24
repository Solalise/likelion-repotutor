"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { courses } from "@/lib/learn/courses";
import { parseProgress, progressKey } from "@/lib/learn/progress";
import styles from "./Dashboard.module.css";
export function LearningRecommendation() {
  const [item, setItem] = useState<{ id: string; title: string; label: string }>();
  useEffect(() => {
    const restore = () => {
      try {
        const entries = courses.map(course => ({ course, progress: parseProgress(localStorage.getItem(progressKey(course.id))) }));
        const active = entries.find(({ progress }) => progress.completed.length > 0 && progress.completed.length < 6);
        const next = active ?? entries.find(({ progress }) => progress.completed.length < 6) ?? entries[0];
        if (next) setItem({ id: next.course.id, title: next.course.title, label: active ? "진행 중인 학습 이어하기" : entries.every(({ progress }) => progress.completed.length === 6) ? "학습 완료 · 복습 추천" : "다음 학습 추천" });
      } catch { setItem(undefined); }
    };
    restore(); window.addEventListener("storage", restore); window.addEventListener("focus", restore);
    return () => { window.removeEventListener("storage", restore); window.removeEventListener("focus", restore); };
  }, []);
  return <><small>학습 추천</small><strong>{item?.title ?? "기초 보안 학습"}</strong><Link className={styles.learningLink} href={item ? `/learn/${item.id}` : "/learn"}>{item?.label ?? "학습 주제 살펴보기"} →</Link></>;
}
