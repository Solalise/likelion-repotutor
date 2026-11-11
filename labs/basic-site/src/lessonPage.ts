export function requestWorkshop(integrated = false) {
  return `<div class="lab-grid" data-stages="2 3" hidden>${integrated ? "" : `<section class="card"><h2>실습용 게시판</h2><p>목록에는 정상 권한 검사로 볼 수 있는 글만 표시됩니다. 먼저 자신의 비공개 글을 선택하세요.</p><div id="lab-posts" class="post-list" aria-busy="true">목록을 불러오는 중입니다.</div><article id="lab-post"><p>글을 열면 여기에서 내용을 확인할 수 있습니다.</p></article></section>`}
    <section class="card"><h2>HTTP 요청 편집기</h2><p>글을 조회한 실제 GET 요청에서 게시글 ID만 편집할 수 있습니다. 세션 쿠키는 브라우저가 전송하며 도구에 표시하거나 저장하지 않습니다.</p>
    <form id="request-form"><fieldset id="request-fields" disabled><legend>수집한 요청 수정</legend><label>HTTP 메서드<input value="GET" readonly></label><label>게시글 ID<input id="request-id" name="postId" inputmode="numeric" pattern="[0-9]{1,12}" maxlength="12" required autocomplete="off"></label><label>실행할 URL<input id="request-url" readonly></label><p>요청 경로: <code id="request-path">아직 요청이 없습니다.</code></p><button class="primary" type="submit">수정한 요청 실행</button></fieldset></form>
    <h3>마지막 실제 요청과 응답</h3><pre id="request-result" tabindex="0">글을 조회하면 메서드·URL·HTTP 상태·실제 응답 본문이 표시됩니다.</pre><p id="lab-feedback" role="status" aria-live="polite"></p></section></div>`;
}

export function lessonPage(workshop: string, integrated = false) {
  return `<ol class="lab-steps" aria-label="실습 진행 단계">${["개념과 목표", "게시판·정상 요청", "요청 수정·발견", "응답 분석", "코드·방어 비교", "이해도·완료"].map((label, i) => `<li><button type="button" data-stage="${i + 1}" ${i ? "disabled" : 'aria-current="step"'}>${i + 1} · ${label}</button></li>`).join("")}</ol>
    <p class="lesson-notice">학습 기록은 이 화면에서만 유지됩니다. 새로고침하면 단계·공격 결과·퀴즈·완료 상태가 초기화됩니다.</p>
    <p id="lab-progress" role="status" aria-live="polite">1단계 · IDOR 개념과 학습 목표를 확인하세요.</p>
    <section class="card" data-stages="1"><h2>1 · IDOR란 무엇일까요?</h2>
      <p>IDOR(Insecure Direct Object Reference)는 서버가 요청 속 번호로 데이터를 찾으면서, 요청한 사람이 그 데이터를 읽을 권한도 있는지 확인하지 않아 생기는 취약점입니다.</p>
      <p><strong>게시글 ID는 글을 찾는 주소표이고, 사용자 권한은 읽어도 되는지 결정하는 규칙입니다.</strong> 로그인했다고 모든 비공개 글을 읽을 수 있는 것은 아닙니다.</p>
      <ul><li>HTTP 요청에서 글을 지정하는 ID를 찾아봅니다.</li><li>실제 응답의 소유자·공개 여부·본문을 근거로 노출을 판단합니다.</li><li>서버의 권한 검사가 같은 요청을 어떻게 차단하는지 비교합니다.</li></ul>
      <p>HTTP 200은 요청을 처리했다는 뜻이고, HTTP 403은 접근 권한이 없어 거부했다는 뜻입니다. 200만으로 취약점이라고 결론 내릴 수 없습니다.</p>
      <button id="lesson-start" class="primary" type="button">2단계 · 게시판 탐색 시작</button></section>
    ${workshop}
    <section class="card" id="normal-observation" data-stages="2" hidden><h2>2 · 정상 HTTP 요청 관찰</h2><p>${integrated ? "커뮤니티의 게시글 목록에서 자신의 비공개 글을 열어보세요. 화면 이동 중에도 이 가이드의 상태는 유지됩니다. 수집한 정상 요청을 바탕으로 실습 기준 요청을 실제 전송한 뒤 편집기로 진행합니다." : "위 목록에서 자신의 비공개 글을 선택하세요."} 정상 게시판이 실제로 보내는 GET /api/posts/{id}와 HTTP 200 응답을 확인합니다. URL의 ID와 응답의 ownerId를 찾아보세요.</p><pre id="normal-result" tabindex="0">자신의 비공개 글을 열면 실제 정상 요청이 표시됩니다.</pre><button id="edit-start" class="primary" type="button" disabled>3단계 · 수집한 요청 수정하기</button></section>
    <section class="card lab-hints" data-stages="2 3" hidden><h2>막혔을 때만 힌트 보기</h2><button id="hint-next" class="secondary" type="button">다음 힌트 보기</button><ol id="hints" aria-live="polite"></ol></section>
    <section id="lab-analysis" class="card" data-stages="4" hidden><h2>4 · 실제 응답으로 공격 결과 분석</h2><pre id="analysis-response" tabindex="0"></pre><dl id="analysis-facts"></dl><p id="analysis-reason"></p><p>다른 사람의 비공개 본문은 공개 허락을 받지 않은 데이터입니다. 서버가 로그인 여부만 확인하고 글을 읽을 권한을 검사하지 않으면 요청의 번호를 바꾸는 것만으로 비밀이 노출될 수 있습니다.</p><button id="study-code" class="primary" type="button">5단계 · 코드와 방어 방법 비교</button></section>
    <section id="lab-comparison" class="card" hidden data-stages="5"><h2>5 · 정상 권한 검사와 비교</h2><p>같은 로그인 세션과 발견한 게시글 ID로 정상 API에 직접 요청하세요. 취약 요청의 HTTP 200과 정상 요청의 HTTP 403, 본문 반환 여부를 비교합니다.</p><pre id="vulnerable-response" tabindex="0"></pre><button id="compare-request" class="secondary" type="button">같은 ID로 정상 API 요청</button><pre id="comparison-result" tabindex="0">아직 정상 API 비교를 실행하지 않았습니다.</pre><p id="comparison-feedback" role="status" aria-live="polite"></p>
      <h3>실제 구현 비교</h3><p>출처: <code>labs/basic-site/src/features/posts.ts</code> · 서버 시작 시 원본에서 발췌합니다. 코드를 수정하면 서버를 재시작하세요.</p><div id="lesson-code"><p>코드를 불러오는 중입니다.</p></div><button id="retry-code" class="secondary" type="button">코드 다시 불러오기</button>
      <p><code>getVulnerablePost()</code>는 로그인과 글의 존재만 확인합니다. <code>canReadPost()</code> 호출이 빠져 있어 타인의 비공개 글도 반환합니다.</p><p><code>getPost()</code>는 <code>canReadPost()</code>로 공개 글 또는 본인 소유인지 확인합니다. 권한이 없는 비로그인 요청은 401, 로그인한 사용자의 타인 비공개 글 요청은 403으로 거부합니다. 존재하지 않는 글은 404입니다.</p><p>화면에서 버튼을 숨겨도 HTTP 요청은 직접 보낼 수 있습니다. 서버는 매 요청마다 검증된 세션의 사용자로 권한을 판단해야 합니다. ID를 추측하기 어렵게 만드는 것만으로는 권한 검사를 대신할 수 없습니다.</p><button id="quiz-start" class="primary" type="button" disabled>6단계 · 이해도 확인</button></section>
    <section id="lab-quiz" class="card" data-stages="6" hidden><h2>6 · 이해도 확인과 학습 완료</h2><p>세 문제를 모두 맞혀야 합니다. 제출 후 해설을 읽고 다시 풀 수 있습니다.</p><form id="quiz-form"><div id="quiz-questions"></div><button class="primary" type="submit">답안 확인</button></form><p id="quiz-feedback" role="status" aria-live="polite"></p><div id="learning-complete" class="completion" role="status" hidden><h3>학습 완료!</h3><p>실제 IDOR 재현, 정상 API 차단 비교, 이해도 확인을 모두 마쳤습니다. 번호를 아는 것과 읽을 권한이 있는 것은 다르다는 점을 기억하세요.</p></div></section>`;
}
