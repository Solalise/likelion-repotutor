import type { PracticeMode } from "./modes.ts";

export type PracticeKind = "idor" | "sqli" | "xss" | "authz";

/** Both modes render the same service. Only the assistance surface differs. */
export function practiceSite(kind: PracticeKind, enabled: boolean, mode: PracticeMode = "free", postId?: number) {
  const base = kind === "idor" || kind === "sqli" ? `/?lab=${kind}&amp;` : `/lab/${kind}?`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>동네 이야기</title><link rel="stylesheet" href="/assets/site.css"><script type="module" src="/assets/practice-site.js"></script></head>
  <body data-practice-site="${kind}" data-practice-mode="${mode}" data-enabled="${enabled}"${postId === undefined ? "" : ` data-post-id="${postId}"`}>
  <header class="topbar"><a class="brand" href="${base}mode=${mode}">동네 이야기<span>COMMUNITY · LOCAL SANDBOX</span></a><nav aria-label="사이트 메뉴"><button type="button" data-view="board">게시판</button><button type="button" data-view="search">검색</button>${kind === "xss" ? '<button type="button" data-view="comments">댓글 미리보기</button>' : ""}${kind === "authz" ? '<button type="button" data-view="management">운영 현황</button>' : ""}<span id="site-session">계정 확인 중</span><button id="site-logout" type="button" hidden>로그아웃</button></nav></header>
  <div class="site-toolbar"><nav class="practice-mode-nav" aria-label="실습 방식 선택"><a data-site-mode="guided" href="${base}mode=guided">가이드 실습</a><a data-site-mode="free" href="${base}mode=free">자유 실습</a><a href="http://localhost:3000/learn/${kind}">개념 학습하기</a><a href="http://localhost:3000/practice">실습 목록</a></nav><label>사이트 버전<select id="site-policy"><option value="vulnerable">기본 버전</option><option value="safe">수정 버전</option></select></label></div>
  <main><header class="intro"><span class="eyebrow">OUR NEIGHBORHOOD</span><h1>우리 동네의 오늘을 만나보세요.</h1><p>이야기를 읽고, 소식을 찾고, 함께 나누는 공간입니다.</p></header>
  <section id="site-login" class="card"><h2>로그인</h2><form id="site-account"><label>실습용 계정<select name="user"><option value="user-a">사용자 A</option><option value="user-b">사용자 B</option><option value="admin">운영자</option></select></label><button class="primary">로그인</button></form><p>실습용 가상 계정만 사용합니다.</p></section>
  <section class="card site-surface" data-surface="board"><h2>동네 게시판</h2><div id="site-posts" class="post-list"></div></section>
  <section class="card site-surface" data-surface="post" hidden><button type="button" class="secondary" data-view="board">목록으로</button><article id="site-post"></article><nav aria-label="게시글 이동"><a id="site-previous">이전 글</a> <a id="site-next">다음 글</a></nav></section>
  <section class="card site-surface" data-surface="search" hidden><h2>소식 검색</h2><form id="site-search"><label>검색어<input name="q" type="search" maxlength="200" placeholder="제목으로 검색"></label><button class="primary">검색</button></form><p id="site-search-status" role="status"></p><div id="site-search-results"></div></section>
  ${kind === "xss" ? '<section class="card site-surface" data-surface="comments" hidden><h2>댓글 미리보기</h2><form id="site-comment"><label>댓글 내용<textarea name="text" rows="4" maxlength="2000" required></textarea></label><button class="primary">미리보기</button></form><div id="site-preview"></div></section>' : ""}
  ${kind === "authz" ? '<section class="card site-surface" data-surface="management" hidden><h2>운영 현황</h2><button id="site-report" class="secondary" type="button">현황 새로고침</button><p id="site-report-result" role="status"></p></section>' : ""}
  <p id="site-message" role="status" aria-live="polite"></p>${enabled ? "" : '<p role="alert">이 시나리오는 서버에서 비활성화되어 있습니다. 운영자가 로컬 실습 설정을 확인해야 합니다.</p>'}
  <p id="site-completed" role="status" hidden>실제 응답을 통한 시나리오 비교를 완료했습니다.</p>
  <details><summary>요청 기록</summary><pre id="site-request">아직 요청 기록이 없습니다.</pre></details>
  </main>
  <aside id="site-mission" class="card mission-dock" aria-label="가이드 미션"${mode === "free" ? " hidden" : ""}><h2 id="site-mission-title"></h2><p id="site-mission-action" aria-live="polite"></p><small>실제 행동 결과가 확인되면 다음 미션으로 이동합니다.</small></aside>
  <aside id="site-hints" class="hint-dock"${mode === "guided" ? " hidden" : ""}><button id="site-hint" type="button" class="secondary" aria-expanded="false" aria-controls="site-hint-list">힌트</button><ol id="site-hint-list" hidden></ol></aside>
  <footer>동네 이야기 · 로컬 실습 전용 · 가상 계정과 데이터 · 새로고침하면 진행 기록 초기화</footer></body></html>`;
}
