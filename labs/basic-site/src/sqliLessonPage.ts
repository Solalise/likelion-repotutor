import { lessonSteps, httpRequestEditor } from "./lessonPage.ts";

export const sqliStages = ["개념과 목표", "정상 검색 요청 관찰", "요청 수정 및 실습", "검색 결과 분석", "코드 및 방어 방식 비교", "퀴즈 및 학습 완료"] as const;

export function sqliLessonPage() {
  return `<div id="integrated-sqli" data-learning-panel>
    ${lessonSteps(sqliStages, 6)}
    <p class="lesson-notice">학습 기록은 이 화면에서만 유지됩니다. 새로고침·가이드 이탈·로그인 변경 시 초기화됩니다. 커뮤니티에서 새로 검색하면 검색 이후 단계의 기록과 판정도 초기화됩니다.</p>
    <p id="sqli-progress" role="status" aria-live="polite">1단계 · 개념과 학습 목표를 확인하세요.</p>
    <section class="card" data-stages="1"><h2>1 · SQL Injection이란?</h2>
      <p>SQL은 데이터베이스에서 데이터를 찾을 때 쓰는 명령입니다. SQL Injection은 사용자가 입력한 검색어가 단순한 검색 값이 아니라 <strong>SQL 명령의 일부</strong>로 해석되어, 원래 의도한 검색 조건이 달라지는 문제입니다.</p>
      <h3>검색어는 어디로 전달될까요?</h3><p>커뮤니티 검색창에 단어를 입력하면 브라우저가 <code>GET /api/search?q=검색어</code> 요청을 보냅니다. 서버는 검색어를 받아 SQLite에 조회하고, 결과를 HTTP 응답으로 돌려줍니다.</p>
      <h3>문자열 결합과 파라미터 바인딩</h3><p>안전하지 않은 문자열 결합은 SQL 명령문 안에 입력을 그대로 붙입니다. 이때 입력이 명령의 구조에 영향을 줄 수 있습니다. <strong>파라미터 바인딩</strong>은 SQL 명령과 검색 값을 따로 전달하여 입력을 데이터로 처리합니다.</p>
      <ul><li>일반 검색에서 실제로 전송한 요청과 응답을 관찰합니다.</li><li>입력한 검색어가 요청 URL에 어떻게 담기는지 확인합니다.</li><li>교육용·정상 검색의 결과와 실제 SQL 코드, 방어 방식을 비교합니다.</li></ul>
      <button id="sqli-start" class="primary" type="button">2단계 · 정상 검색 관찰 시작</button></section>
    <section class="card" data-stages="2" hidden><h2>2 · 정상 검색 요청 관찰</h2>
      <p>일반 커뮤니티의 <strong>게시글 검색</strong>에서 원하는 단어를 직접 검색하세요. 이 가이드는 검색을 대신 실행하지 않습니다. 실제 정상 검색 응답을 확인해야 이 단계가 완료됩니다. 결과가 0개여도 정상적인 검색 응답이면 확인할 수 있습니다.</p>
      <pre id="sqli-search-record" tabindex="0">아직 관찰된 검색 요청이 없습니다</pre>
      <p id="sqli-search-feedback" role="status" aria-live="polite">검색 요청을 기다리고 있습니다. 2단계는 아직 완료되지 않았습니다.</p>
      <div id="sqli-search-results"></div>
      <p>검색 데이터는 게시판 글과 별도인 가상 데이터이며, 정상 API는 공개 글만 반환합니다.</p>
      <button id="sqli-edit-start" class="primary" type="button" disabled>3단계 · 수집한 요청 편집</button></section>
    <section class="card" data-stages="3" hidden><h2>3 · 요청 편집 및 교육용 API 실습</h2>
      <p>2단계에서 실제로 수집한 검색어를 수정하여 교육용 API로 전송합니다. GET 메서드와 API 경로는 고정입니다. 로그인과 서버의 SQLI 활성화 설정이 필요합니다. URL 미리보기는 아직 전송된 요청이 아닙니다.</p>
      <details><summary>기준이 된 실제 정상 검색 요청</summary><pre id="sqli-editor-source" tabindex="0">아직 수집한 요청이 없습니다.</pre></details>
      ${httpRequestEditor({ prefix: "sqli-request", inputSuffix: "query", label: "검색어", attributes: 'name="q" maxlength="200" autocomplete="off"', button: "교육용 API로 요청 전송" })}
      <h3>마지막 실제 교육용 요청과 응답</h3><pre id="sqli-replay-record" tabindex="0">아직 교육용 API에 요청하지 않았습니다.</pre>
      <p id="sqli-replay-feedback" role="status" aria-live="polite"></p>
      <button id="sqli-hint-next" class="secondary" type="button">다음 힌트 보기</button><ol id="sqli-hints" aria-live="polite"></ol>
      <button id="sqli-analysis-start" class="primary" type="button" disabled>4단계 · 실제 결과 비교</button></section>
    <section class="card" data-stages="4" hidden><h2>4 · 실제 검색 결과 비교</h2>
      <p>마지막으로 전송한 교육용 요청과 <strong>동일한 검색어</strong>를 정상 API에 보내 비교합니다. 편집창만 수정해도 이전 응답이 바뀌지는 않습니다. 비교가 정상 완료되어야 4단계 완료입니다. 조건 우회 재현 여부는 별도로 판정합니다.</p>
      <h3>교육용 API · 실제 응답</h3><pre id="sqli-education-record" tabindex="0">아직 비교할 응답이 없습니다.</pre><div id="sqli-education-results"></div>
      <button id="sqli-compare" class="secondary" type="button" disabled>같은 검색어로 정상 API 비교</button>
      <h3>정상 API · 실제 응답</h3><pre id="sqli-comparison-record" tabindex="0">아직 정상 API 비교를 실행하지 않았습니다.</pre><div id="sqli-comparison-results"></div>
      <p id="sqli-comparison-feedback" role="status" aria-live="polite"></p>
      <p id="sqli-reproduction-state" role="status" aria-live="polite">재현 여부: 아직 비교하지 않아 판정하지 않았습니다.</p>
      <button id="sqli-code-start" class="primary" type="button" disabled>5단계 · 실제 코드와 방어 방식 비교</button></section>
    <section class="card" data-stages="5" hidden><h2>5 · 실제 코드와 방어 방식 비교</h2>
      <p>아래 발췌는 서버가 사용하는 원본 파일에서 읽습니다. 교육용 경로는 입력을 SQL 문자열에 결합하고, 일반 검색 경로는 <code>?</code> 자리표시자와 파라미터 바인딩을 사용합니다.</p>
      <p><strong>3~4단계 응답과 연결:</strong> 여기에는 해당 단계에서 받은 실제 교육용·정상 응답 요약이 표시됩니다. 실제 응답에 없는 결과는 추가하지 않습니다.</p>
      <dl id="sqli-code-evidence"></dl>
      <p>문자열 결합에서는 사용자가 넣은 따옴표가 SQL 문자열을 끝내고 조건식이 되도록 쿼리 구조를 바꿀 수 있습니다. 파라미터 바인딩은 SQL 문장과 검색값을 따로 전달하므로 같은 입력도 SQL 구문이 아니라 데이터로 처리됩니다.</p>
      <p>이 예제의 정상 검색은 공개 범위 조건을 적용하고 검색 패턴을 별도로 바인딩합니다. 교육용 검색은 같은 가상 데이터베이스의 제한된 단일 SELECT에서만 입력을 문자열에 결합합니다.</p>
      <h3>원본 코드 발췌</h3><p id="sqli-code-source">코드 자료를 요청하기 전입니다.</p><button id="sqli-code-retry" class="secondary" type="button">실제 코드 불러오기</button>
      <pre id="sqli-code-snippet" tabindex="0">실제 소스에서 발췌한 코드가 여기에 표시됩니다.</pre><p id="sqli-code-feedback" role="status" aria-live="polite"></p>
      <button id="sqli-code-confirm" class="primary" type="button" disabled>코드 비교를 확인했습니다</button>
      <button id="sqli-quiz-start" class="primary" type="button" disabled>6단계 · 이해도 퀴즈 시작</button></section>
    <section class="card" data-stages="6" hidden><h2>6 · 이해도 퀴즈 및 학습 완료</h2><p>세 문제에 모두 답하고 제출하세요. 오답에는 해설이 표시되며 답을 고쳐 다시 시도할 수 있습니다.</p>
      <form id="sqli-quiz-form"><div id="sqli-quiz-questions"></div><button class="primary" type="submit">답안 확인</button></form>
      <p id="sqli-quiz-feedback" role="status" aria-live="polite"></p>
      <div id="sqli-learning-complete" class="completion" role="status" hidden><h3>SQL Injection 학습 완료</h3><p>정상 요청 관찰, 교육용 요청, 동일 입력 비교, 실제 코드 확인, 퀴즈를 모두 마쳤습니다.</p><p id="sqli-completion-reproduction"></p></div>
    </section>
  </div>`;
}
