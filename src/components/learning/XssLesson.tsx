import type { ReactNode } from "react";
import type { Course } from "@/lib/learn/courses";
import styles from "./learning.module.css";

const payload = "<svg onload=alert(1)>";
function Table({ caption, headings, rows }: { caption: string; headings: string[]; rows: ReactNode[][] }) {
  return <div className={styles.tableScroll}><table className={styles.lessonTable}><caption>{caption}</caption><thead><tr>{headings.map(h => <th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>;
}

export const xssStepGuide = [
  { goal: "XSS가 무엇이고, 일반 댓글과 어떻게 다른지 알아봅니다.", takeaway: "댓글에 입력한 글자가 브라우저의 명령으로 실행되면 XSS가 발생할 수 있습니다." },
  { goal: "같은 입력이 글자와 HTML로 처리될 때의 차이를 비교합니다.", takeaway: "입력을 받는 순간보다, 입력을 HTML에 넣어 화면에 출력하는 방식이 중요합니다." },
  { goal: "요청, 서버 응답, 브라우저의 실행 증거를 구분합니다.", takeaway: "200 OK나 SVG 태그가 포함된 응답만으로 XSS 실행을 판단하지 않습니다." },
  { goal: "위험한 코드의 위치를 찾고, 안전한 코드와 줄별로 비교합니다.", takeaway: "원본 입력을 HTML 문자열에 바로 결합하는 부분이 위험합니다. 일반 텍스트 출력에는 안전한 API를 사용하세요." },
  { goal: "방어 방법의 우선순위를 익히고, 같은 공격 입력으로 수정 결과를 확인합니다.", takeaway: "안전한 출력 처리가 우선입니다. CSP는 보조 수단이며 출력 처리를 대신하지 않습니다." },
  { goal: "상황형 퀴즈로 이해도를 확인하고, 실습 환경을 준비합니다.", takeaway: "기초 학습 완료와 실제 실습 완료는 별도입니다. 실제 실행 여부는 실습 브라우저에서 확인합니다." },
];

export function XssGoal({ step, summary = false }: { step: number; summary?: boolean }) {
  return <aside className={summary ? styles.summary : styles.callout}><strong>{summary ? "지금 이해해야 할 것" : "이번 단계에서 배울 것"}</strong><p>{summary ? xssStepGuide[step].takeaway : xssStepGuide[step].goal}</p></aside>;
}

function SameInput() {
  return <><p>두 모드에 같은 입력을 넣습니다: <code>{payload}</code></p><div className={styles.compare}><section className={styles.warning}><h3>취약 모드</h3><p>입력이 SVG 요소로 만들어집니다. onload 이벤트가 실행되면 실습의 실행 감지 신호가 나타납니다.</p></section><section><h3>안전 모드</h3><p>태그 전체가 글자로 표시됩니다. SVG 요소가 만들어지지 않고 실행 감지 신호도 없어야 합니다.</p></section></div></>;
}

export function XssLesson({ step, course: c }: { step: number; course: Course }) {
  if (step === 0) return <>
    {c.concept.map(p => <p key={p}>{p}</p>)}
    <Table caption="먼저 알아둘 용어" headings={["용어", "뜻"]} rows={[
      ["브라우저", "Chrome, Edge처럼 웹페이지를 열어 보여주는 프로그램입니다."],
      ["HTML", "제목·문단·버튼처럼 웹페이지의 구조를 정하는 표시 언어입니다."],
      ["JavaScript", "버튼 클릭 등 웹페이지의 동작을 만드는 프로그래밍 언어입니다."],
    ]}/>
    <div className={styles.compare}><section><h3>일반 댓글</h3><code>안녕하세요</code><p>화면에 인사말만 표시되어야 합니다.</p></section><section className={styles.warning}><h3>코드를 포함한 입력</h3><code>{payload}</code><p>HTML로 처리되면 요소를 만들고 이벤트 코드를 실행할 수 있습니다. 이 화면에서는 문자열로만 표시합니다.</p></section></div>
    <p className={styles.processLine}>댓글 입력 → HTML에 그대로 삽입 → 브라우저가 태그로 해석 → 이벤트 코드 실행 가능</p>
    <Table caption="XSS의 유형 비교" headings={["유형", "입력이 전달되는 방식"]} rows={[
      ["반사형", "요청에 담긴 입력이 서버 응답에 바로 포함됩니다. 예: 검색어를 그대로 보여주는 결과 페이지."],
      ["저장형", "댓글 등에 저장된 입력이 나중에 다른 방문자에게 전달됩니다."],
      ["DOM 기반", "브라우저의 JavaScript가 입력을 위험한 방식으로 화면 구조(DOM)에 넣습니다."],
    ]}/>
    <p>반사형·저장형은 전달 방식, DOM 기반은 처리 위치를 설명하므로 서로 겹칠 수 있습니다.</p>
    <aside className={styles.callout}><strong>이번 실습은 댓글 미리보기입니다</strong><p>댓글을 저장하지 않습니다. 실습용 격리 화면(iframe)에서 실행 신호만 확인하며, 실제 사용자 정보나 세션을 탈취하지 않습니다.</p></aside>
  </>;
  if (step === 1) return <>
    <p>핵심은 사용자 입력이 글자로 남는지, HTML 문법으로 해석되는지입니다. HTML 파싱은 브라우저가 HTML 소스를 읽어 실제 화면 요소를 만드는 과정입니다.</p>
    <ol className={styles.flow}>{c.flow.map((f, i) => <li key={f}><small>0{i + 1}</small><strong>{f}</strong><p>{["사용자가 댓글 내용을 보냅니다.", "서버가 입력을 문서의 댓글 위치에 넣습니다.", "브라우저가 꺾쇠와 태그 문법을 읽습니다.", "요소가 만들어지고 이벤트 코드가 실행될 수 있습니다."][i]}</p></li>)}</ol>
    <p>같은 입력 <code>{"<b>안녕</b>"}</code>을 두 방식으로 처리해봅니다.</p>
    <div className={styles.compare}><section><h3>텍스트로 처리</h3><p>입력 → 텍스트 → 글자로 표시</p><div className={styles.preview}>{"<b>안녕</b>"}</div><p>꺾쇠와 태그 이름도 그대로 보입니다.</p></section><section className={styles.warning}><h3>HTML로 처리</h3><p>입력 → HTML 파싱 → 실제 요소 생성</p><div className={styles.preview}><b>안녕</b></div><p>b 태그가 적용되어 굵게 보입니다.</p></section></div>
    <p>굵은 글씨만으로 XSS 실행이 확인된 것은 아닙니다. 이것은 HTML 해석의 차이를 보여주는 예시입니다.</p>
    <Table caption="HTML 해석에서 코드 실행으로" headings={["용어", "뜻"]} rows={[["DOM", "브라우저가 HTML을 읽어 만든 화면 요소의 구조입니다."], ["SVG", "웹에서 그림을 표현하는 요소입니다. 이 예시에서는 이벤트 실행을 확인하는 데 씁니다."], ["이벤트 핸들러", "요소가 로드되는 등 특정 일이 생겼을 때 실행할 코드입니다. onload가 그 예입니다."]]}/>
    <SameInput/>
  </>;
  if (step === 2) return <>
    <p>{c.scenario}</p><aside className={styles.callout}><strong>교육용 예시 · 실제 요청 기록이 아닙니다</strong><p>아래 요청은 자동 전송되지 않습니다. 응답은 JSON의 document 필드 중 댓글 부분만 발췌한 예시이며, 실행 결과도 예상 동작입니다.</p></aside>
    <Table caption="HTTP 요청 읽기" headings={["표현", "뜻"]} rows={[["POST", "서버에 데이터를 보내는 요청 방식"], ["/api/lab/xss", "실습 서버에서 XSS 미리보기 요청을 처리하는 경로"], ["Content-Type: application/json", "보내는 본문이 JSON 형식이라는 표시"], ["Cookie", "로그인 상태 등을 식별하는 데 쓰는 정보. 예시에는 실제 값을 넣지 않습니다."], ["200 OK", "HTTP 요청을 정상 처리했다는 뜻. 코드 실행 성공을 의미하지 않습니다."], ["mode: vulnerable / safe", "vulnerable은 원본을 HTML에 삽입하고, safe는 HTML 텍스트용 인코딩을 적용합니다."]]}/>
    {[{ title: "01 · 정상 입력 / 취약 모드", mode: "vulnerable", text: "안녕하세요", html: "<div>안녕하세요</div>", result: "글자만 표시됩니다." }, { title: "02 · 공격 입력 / 취약 모드", mode: "vulnerable", text: payload, html: `<div>${payload}</div>`, result: "SVG 요소가 만들어지고 이벤트가 실행될 수 있습니다. 실제 실행 신호를 별도로 확인해야 합니다." }, { title: "03 · 같은 공격 입력 / 안전 모드", mode: "safe", text: payload, html: "<div>&lt;svg onload=alert(1)&gt;</div>", result: "입력 전체가 글자로 보이고 이벤트가 실행되지 않아야 합니다." }].map(example => <section className={styles.summary} key={example.title}><h3>{example.title}</h3><pre className={styles.requestExample}>{`POST /api/lab/xss HTTP/1.1\nContent-Type: application/json\nCookie: <실습 세션 예시>\n\n${JSON.stringify({ mode: example.mode, text: example.text }, null, 2)}\n\nHTTP/1.1 200 OK\nContent-Type: application/json\n${JSON.stringify({ document: example.html, mode: example.mode }, null, 2)}`}</pre><p><strong>브라우저에서 예상되는 결과: </strong>{example.result}</p></section>)}
    <Table caption="어디까지 확인된 증거인가요?" headings={["관찰 내용", "알 수 있는 것"]} rows={[["HTTP 200 OK", "서버가 요청을 처리했습니다. XSS 실행 여부는 모릅니다."], ["응답의 document에 SVG 태그 포함", "위험한 HTML이 만들어졌습니다. 브라우저 실행은 아직 별도입니다."], ["실습 브라우저의 실행 감지 신호", "격리 화면에서 해당 이벤트 코드가 실행된 것을 확인합니다."]]}/>
    <p>{c.impact}</p>
  </>;
  if (step === 3) return <>
    <p>로컬 실습의 문서 생성 원리를 옮긴 학습용 TypeScript 축약 예시입니다. 실제 파일 전체가 아니며 인증·격리·오류 처리는 생략했습니다. 반환한 document 문자열을 브라우저가 HTML로 읽는 상황을 가정합니다.</p>
    <div className={styles.codeStack}>{[{ title: "취약 코드", lines: c.bad, danger: c.danger }, { title: "안전 코드 · HTML 텍스트 위치", lines: c.safe, danger: [] }].map(code => <section className={styles.codePanel} key={code.title}><h3>{code.title}</h3><pre><code>{code.lines.map((line, i) => <span className={`${styles.codeLine} ${code.danger.includes(i + 1) ? styles.danger : ""}`} key={i}><span className={styles.lineNumber}>{i + 1}</span><span>{line || " "}</span></span>)}</code></pre></section>)}</div>
    <h3>취약 코드 해설</h3><ol className={styles.explanations}>{c.notes.slice(0, 3).map(note => <li key={note}>{note}</li>)}</ol>
    <h3>안전 코드 해설</h3><ol className={styles.explanations}><li>1행은 문자열을 받아 문자열을 반환하는 escapeHtml 함수를 정의합니다.</li><li>2~6행은 특수문자를 HTML 인코딩으로 바꿉니다. 새로 만든 &amp;lt;를 다시 바꾸지 않도록 &amp;부터 처리합니다.</li><li>7행은 함수 정의를 끝냅니다. 8행은 입력을 변환하고, 9~10행은 변환된 값만 HTML에 넣습니다. 11행은 문서를 반환합니다.</li></ol>
    <Table caption="HTML 텍스트용 인코딩 (이스케이프)" headings={["원본 문자", "HTML 소스에 넣는 값"]} rows={[["<", "&lt;"], [">", "&gt;"], ["&", "&amp;"], ['"', "&quot;"], ["'", "&#39;"]]}/>
    <p>브라우저는 &amp;lt;를 화면의 &lt; 문자로 표시합니다. 새 태그의 시작으로 해석하지 않습니다. 이 표는 HTML 텍스트 위치용이며, 속성·JavaScript·URL에 그대로 적용하면 안 됩니다.</p>
    <aside className={styles.callout}><strong>일반 댓글을 DOM에 넣을 때</strong><pre className={styles.requestExample}>{"comment.textContent = input;"}</pre><p>댓글용 일반 요소의 textContent는 입력을 글자로 표시합니다. React에서도 기본 문자열 출력을 사용하고, innerHTML로 우회하지 마세요.</p></aside>
  </>;
  if (step === 4) return <>
    <h3>XSS 방어 우선순위</h3><ol className={styles.explanations}>{c.defenses.map(d => <li key={d}>{d}</li>)}</ol>
    <aside className={styles.warning}><h3>주의할 점</h3><p>{c.mistakes}</p></aside>
    <h3>수정 전후에 같은 입력으로 확인하세요</h3><SameInput/>
    <p>{c.verification}</p><p>위험한 출력을 먼저 차단하고 영향 범위를 확인합니다. 저장형 XSS라면 저장된 악성 콘텐츠도 조사해야 합니다. 이번 미리보기는 댓글을 저장하지 않습니다.</p>
    <p className={styles.muted}>방어 원칙 참고: <a href="https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html" target="_blank" rel="noopener noreferrer">OWASP XSS Prevention Cheat Sheet ↗</a></p>
  </>;
  return null;
}
