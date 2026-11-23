"use client";
import { XssGoal, XssLesson } from "./XssLesson";
import { XssPracticeConnection } from "./XssPracticeConnection";
import { LocalPracticeLink, ProductionPracticeNotice } from "@/components/ui-platform/LocalPracticeLink";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { courses, steps, type Course } from "@/lib/learn/courses";
import { emptyProgress, parseProgress, progressKey, type Progress } from "@/lib/learn/progress";
import styles from "./learning.module.css";
function Meter({ value, label }: {
    value: number;
    label: string;
}) { return <div className={styles.meter}><div><span>{label}</span><strong>{Math.round(value)}%</strong></div><progress aria-label={label} max={100} value={value}/></div>; }
const courseDescriptions: Record<string, { summary: string; detail: string }> = {
    idor: { summary: "다른 사용자의 데이터 접근", detail: "게시글 접근 권한을 확인하고 보호하는 방법을 배웁니다." },
    sqli: { summary: "SQL 쿼리 조작", detail: "검색 입력으로 생기는 취약점과 안전한 쿼리 작성법을 배웁니다." },
    xss: { summary: "웹페이지에 삽입된 악성 스크립트", detail: "사용자 입력이 코드로 실행되는 원인과 방어 방법을 배웁니다." },
    authz: { summary: "사용자별 기능 접근 권한", detail: "일반 사용자와 관리자의 권한을 구분하는 방법을 배웁니다." },
};

export function LearningDashboard() {
    const [saved, setSaved] = useState<Record<string, Progress>>({});
    useEffect(() => {
        const refresh = () => { const result: Record<string, Progress> = {}; for (const c of courses) {
            try {
                result[c.id] = parseProgress(localStorage.getItem(progressKey(c.id)));
            }
            catch {
                result[c.id] = emptyProgress();
            }
        } setSaved(result); };
        const frame = requestAnimationFrame(refresh);
        window.addEventListener("storage", refresh);
        window.addEventListener("pageshow", refresh);
        // Preserve old /learn#idor links from the unchanged local practice server.
        const topic = window.location.hash.slice(1);
        if (courses.some(c => c.id === topic))
            window.location.replace(`/learn/${topic}`);
        return () => { cancelAnimationFrame(frame); window.removeEventListener("storage", refresh); window.removeEventListener("pageshow", refresh); };
    }, []);
    const count = courses.reduce((sum, c) => sum + (saved[c.id]?.completed.length ?? 0), 0);
    return <main id="main-content" className={`vl-main ${styles.root}`}><ProductionPracticeNotice/><header className={styles.hero}><small>기초 보안 학습</small><h1>웹 보안의 기초,<br />취약점부터 배워보세요</h1><p>IDOR, SQL Injection, XSS, 권한 검증을 배웁니다.<br />예시 코드로 취약점의 원인과 수정 방법을 살펴보고, 퀴즈로 확인해보세요.</p><Meter value={count / 24 * 100} label={`전체 학습 · ${count}/24단계`}/></header><div className={styles.sectionHeading}><h2>학습 과정 선택</h2><span>입문 · 4개 과정 · 순서 없이 시작 가능</span></div><div className={styles.grid}>{courses.map((c, i) => { const p = saved[c.id]; return <Link id={c.id} key={c.id} href={`/learn/${c.id}`} className={styles.course}><small>COURSE 0{i + 1} <span>약 {c.minutes}분</span></small><h2>{c.title}</h2><p>{courseDescriptions[c.id].summary}</p><p className={styles.muted}>{courseDescriptions[c.id].detail}</p><Meter value={(p?.completed.length ?? 0) / 6 * 100} label={`${p?.completed.length ?? 0}/6단계 완료`}/><strong>{p?.completed.length === 6 ? "완료한 과정 복습하기" : p?.completed.length || p?.step ? "이어서 학습하기" : "학습 시작하기"} →</strong></Link>; })}</div><aside className={styles.callout}><strong>학습과 실습은 별도의 과정입니다</strong><p>이곳의 6단계와 퀴즈는 원리를 익히는 기초 과정입니다. 로컬 실습 서버의 기존 6단계 가이드와 진행 상태는 연동되지 않습니다. 학습 내용은 이 브라우저에 저장됩니다.</p></aside></main>;
}
function Highlight({ line }: {
    line: string;
}) { return <>{line.split(/('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\b(?:const|return|if|throw|new|function|string)\b|\/\/.*$)/g).map((part, i) => <span key={i} className={/^['"]/.test(part) ? styles.string : /^(const|return|if|throw|new|function|string)$/.test(part) ? styles.keyword : undefined}>{part}</span>)}</>; }
function Code({ lines, danger = [], label }: {
    lines: string[];
    danger?: number[];
    label: string;
}) { return <section className={styles.codePanel}><h3>{label}</h3><pre tabIndex={0} aria-label={label}><code>{lines.map((line, i) => <span key={i} className={`${styles.codeLine} ${danger.includes(i + 1) ? styles.danger : ""}`}><span className={styles.lineNumber}>{i + 1}</span><span><Highlight line={line}/>{danger.includes(i + 1) && <b className={styles.flag}> ← 취약 지점</b>}</span></span>)}</code></pre></section>; }
function Paragraphs({ items }: {
    items: string[];
}) { return <>{items.map(item => <p key={item}>{item}</p>)}</>; }
export function LearningCourse({ course: c }: {
    course: Course;
}) {
    const [p, setP] = useState<Progress>(emptyProgress);
    const [ready, setReady] = useState(false);
    const [storageError, setStorageError] = useState(false);
    const heading = useRef<HTMLHeadingElement>(null);
    useEffect(() => {
        // Read browser storage after hydration; keep controls disabled until restored.
        const frame = requestAnimationFrame(() => {
            try { setP(parseProgress(localStorage.getItem(progressKey(c.id)))); }
            catch { setStorageError(true); }
            setReady(true);
        });
        return () => cancelAnimationFrame(frame);
    }, [c.id]);
    function save(next: Progress) { setP(next); try {
        localStorage.setItem(progressKey(c.id), JSON.stringify(next));
        setStorageError(false);
    }
    catch {
        setStorageError(true);
    } }
    function go(step: number) { save({ ...p, step, visited: [...new Set([...(p.visited ?? []), p.step, step])] }); requestAnimationFrame(() => { heading.current?.focus(); heading.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); }); }
    const score = c.quizzes.filter((q, i) => p.answers[i] === q.answer).length;
    const complete = p.completed.length === 6;
    return <main id="main-content" className={`vl-main ${styles.root}`}><ProductionPracticeNotice/><Link className={styles.back} href="/learn">← 모든 학습 과정</Link><header className={styles.courseHeader}><small>SECURITY FOUNDATIONS · 약 {c.minutes}분</small><h1>{c.title}</h1><p>{c.subtitle}</p></header>{storageError && <p role="status" className={styles.callout}>브라우저 저장소를 사용할 수 없어 현재 화면에서만 진행 상태가 유지됩니다.</p>}<div className={styles.layout}><aside className={styles.sidebar}><Meter value={p.completed.length / 6 * 100} label={`학습 진행 · ${p.completed.length}/6`}/><nav aria-label="학습 단계">{steps.map((s, i) => <button disabled={!ready} key={s} aria-current={p.step === i ? "step" : undefined} onClick={() => go(i)}><span>{p.completed.includes(i) ? "✓" : `0${i + 1}`}</span><span>{s}<small>{p.completed.includes(i) ? "완료 · 다시 학습 가능" : (p.step === i || p.visited?.includes(i)) ? "학습 중" : "학습 전"}</small></span></button>)}</nav><p>이전 단계와 다음 단계를 자유롭게 탐색하세요. 읽은 단계는 완료 표시하세요. ‘완료하고 다음 단계’는 완료 기록과 이동을 함께 처리합니다.</p></aside><article className={styles.lesson} aria-busy={!ready}><small>STEP {p.step + 1} / 6</small><h2 ref={heading} tabIndex={-1}>{steps[p.step]}</h2>{c.id === "xss" && <><XssGoal step={p.step}/><XssLesson step={p.step} course={c}/></>}
    {c.id !== "xss" && p.step === 0 && <><Paragraphs items={c.concept}/><aside className={styles.callout}><small>쉬운 비유</small><p>{c.analogy}</p></aside><section className={styles.summary}><h3>함께 구분하기</h3><p>{c.distinction}</p></section><p className={styles.question}>생각해 보기 · {c.id === "idor" ? "로그인했다는 사실만으로 모든 게시글을 읽어도 될까요?" : c.id === "sqli" ? "검색어가 명령의 일부가 되면 어떤 조건이 달라질까요?" : c.id === "xss" ? "같은 입력인데 출력 방식에 따라 실행 여부가 달라지는 이유는 무엇일까요?" : "로그인 확인과 관리자 확인은 왜 별개일까요?"}</p></>}
    {c.id !== "xss" && p.step === 1 && <><p>요청은 아래 경계를 순서대로 통과합니다. 입력을 받은 위치와 실제로 권한 또는 해석을 결정하는 위치를 구분해 보세요.</p><ol className={styles.flow} aria-label="정상 요청과 응답 흐름">{c.flow.map((f, i) => <li key={f}><small>0{i + 1}{i < 3 ? " →" : " ↩"}</small><strong>{f}</strong></li>)}</ol><Paragraphs items={c.mechanism}/><div className={styles.compare}><section><h3>정상 동작</h3><p>{c.normal}</p></section><section className={styles.warning}><h3>취약한 동작</h3><p>{c.vulnerable}</p></section></div></>}
    {c.id !== "xss" && p.step === 2 && <><p>{c.scenario}</p><p className={styles.muted}>아래 HTTP·응답은 실습 동작을 설명하는 축약 예시입니다. 실제 쿠키값을 포함하지 않으며 요청을 자동 전송하지 않습니다.</p><div className={styles.compare}>{c.requests.map((r, i) => <section className={styles.http} key={r}><h3>{i === 0 ? "01 · 정상 사용자 요청" : "02 · 변경 요청과 안전 모드 비교"}</h3><pre tabIndex={0}>{r}</pre></section>)}</div><aside className={styles.callout}><strong>무엇이 달라졌나요?</strong><p>{c.impact}</p></aside></>}
    {c.id !== "xss" && p.step === 3 && <><p>로컬 실습 구현의 핵심을 옮긴 TypeScript 축약 예시입니다. 공통 인증·오류 처리와 주변 코드는 생략했습니다. 강조된 줄에서 어떤 검사가 빠지거나 해석 경계가 무너지는지 확인하세요.</p><div className={styles.compare}><Code label="취약 코드" lines={c.bad} danger={c.danger}/><Code label="안전 코드" lines={c.safe}/></div><h3>실행 순서로 읽기</h3><ol className={styles.explanations}>{c.notes.map(n => <li key={n}>{n}</li>)}</ol></>}
    {c.id !== "xss" && p.step === 4 && <><h3>수정할 때의 우선순위</h3><ol className={styles.explanations}>{c.defenses.map(d => <li key={d}>{d}</li>)}</ol><aside className={styles.warning}><h3>흔히 하는 실수</h3><p>{c.mistakes}</p></aside><section className={styles.summary}><h3>수정 전 → 수정 후 확인</h3><p>{c.vulnerable}</p><p>→ {c.normal}</p><h3>개발자 확인 목록</h3><p>{c.verification}</p></section></>}
    {p.step === 5 && <><p>세 문제에 답한 뒤 채점하세요. 모든 문제를 맞히면 이 단계를 완료할 수 있습니다. 오답 해설을 읽고 답을 바꿔 다시 도전할 수 있습니다.</p><form onSubmit={e => { e.preventDefault(); save({ ...p, submitted: true }); }}>{c.quizzes.map((q, i) => <fieldset className={styles.quiz} key={q.question}><legend>{i + 1}. {q.question}</legend>{q.options.map((option, j) => <label key={option}><input type="radio" name={`quiz-${c.id}-${i}`} required checked={p.answers[i] === j} onChange={() => { const answers = [...p.answers]; answers[i] = j; save({ ...p, answers, submitted: false, completed: p.completed.filter(s => s !== 5) }); }}/><span>{option}</span></label>)}{p.submitted && <div className={p.answers[i] === q.answer ? styles.correct : styles.incorrect}><strong>{p.answers[i] === q.answer ? "정답" : `오답 · 정답: ${q.options[q.answer]}`}</strong><p>{q.explanation}</p></div>}</fieldset>)}<button className={styles.primary} disabled={!ready || p.answers.some(a => a === null)} type="submit">{p.submitted ? "다시 채점하기" : "답안 채점하기"}</button></form>{p.submitted && <p role="status" className={styles.summary}>퀴즈 결과: {score}/3 정답 · {score === 3 ? "단계 완료 버튼으로 학습을 마무리하세요." : "오답 해설을 확인하고 다시 도전하세요."}</p>}{c.id === "xss" ? <XssPracticeConnection learningComplete={complete}/> : <aside className={styles.callout}><h3>다음은 로컬 실습입니다</h3><p>이 학습 퀴즈와 실습 서버의 기존 6단계 가이드는 별도 과정입니다. 실습 진행과 인증은 여기의 학습 상태에 영향을 주지 않습니다.</p><p>이 PC에서 labs/basic-site의 README 안내대로 별도 서버를 실행하세요. 기본 주소는 127.0.0.1:4400입니다. 가상 계정으로 로그인한 뒤 정상 입력 → 취약 모드 → 안전 모드 순서로 비교합니다.</p>{complete ? <LocalPracticeLink className={styles.primary} href={c.lab} target="_blank" rel="noopener noreferrer">{c.title} 실습 시작 ↗ (새 탭)</LocalPracticeLink> : <p>여섯 단계를 모두 완료하면 실습 시작 버튼이 표시됩니다. 기존 <Link href="/practice">실습 목록</Link>도 사용할 수 있습니다.</p>}</aside>}</>}
    {c.id === "xss" && <XssGoal step={p.step} summary/>}
    <footer className={styles.footer}><div>{p.step > 0 && <button onClick={() => go(p.step - 1)}>← 이전 단계</button>}<button disabled={!ready || (p.step === 5 && (!p.submitted || score !== 3))} onClick={() => save({ ...p, completed: [...new Set([...p.completed, p.step])] })}>{p.completed.includes(p.step) ? "✓ 완료한 단계" : "이 단계 완료 표시"}</button></div>{p.step < 5 && <button className={styles.primary} disabled={!ready} onClick={() => { save({ ...p, completed: [...new Set([...p.completed, p.step])], step: p.step + 1, visited: [...new Set([...(p.visited ?? []), p.step, p.step + 1])] }); requestAnimationFrame(() => { heading.current?.focus(); heading.current?.scrollIntoView({ block: "start" }); }); }}>완료하고 다음 단계 →</button>}</footer>{complete && <p role="status" className={styles.correct}>✓ {c.title} 기초 학습 완료 · 언제든 복습할 수 있습니다.</p>}
  </article></div></main>;
}
