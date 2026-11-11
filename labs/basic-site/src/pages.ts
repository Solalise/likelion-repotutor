import { lessonPage, requestWorkshop } from "./lessonPage.ts";
import type { User } from "./types.ts";
import { communityHref, guidePanel, type GuideLab } from "./guide.ts";

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}
function labContent(enabled: boolean, user?: User) {
  const intro = '<header class="intro"><span class="eyebrow">REQUEST WORKSHOP · IDOR</span><h1>요청 속 번호를 직접 바꿔보세요.</h1><p>실습용 게시판에서 자신의 글을 열고, 정상 요청을 관찰한 뒤 실습 API에서 ID를 수정해보세요. 일반 게시판은 기존 권한 검사를 유지합니다.</p></header>';
  if (!enabled) return `${intro}<section class="card"><h2>실습이 비활성화되어 있습니다</h2><p>현재 서버에서는 취약 조회를 실행할 수 없습니다. 서버를 종료한 뒤 로컬 개발 환경에서 <code>BASIC_SITE_ENABLE_IDOR=1</code>로 다시 실행해주세요.</p><a class="back" href="/posts">정상 게시판으로 돌아가기 →</a></section>`;
  if (!user || user.id !== "user-a") return `${intro}<section class="card"><h2>1단계 · 사용자 A로 로그인</h2><p>이 가이드는 user-a 계정으로 진행합니다. ${user ? "현재 계정에서 로그아웃하거나 로그인 화면에서 계정을 전환해주세요." : "먼저 로그인해주세요."}</p><p>실습 계정: <code>user-a</code> / <code>practice-a</code></p><a class="back" href="/login?lab=idor">로그인하러 가기 →</a><p>로그인 후 IDOR 가이드의 6단계 학습 버튼으로 돌아오세요.</p></section>`;
  return `${intro}${lessonPage(requestWorkshop())}`;
}

export function page(kind: "posts" | "post" | "login" | "lab", user?: User, postId?: number, enableIdorLab = false, guide?: GuideLab) {
  const activeGuide = kind === "lab" ? undefined : guide;
  const href = (path: string) => communityHref(path, activeGuide);
  const account = user
    ? `<span>${escapeHtml(user.name)} · ${escapeHtml(user.id)}</span><button id="logout" type="button">로그아웃</button>`
    : `<a href="${href("/login")}">로그인</a>`;
  let content: string;
  if (kind === "lab") {
    content = labContent(enableIdorLab, user);
  } else if (kind === "login") {
    content = `<section class="card login"><span class="eyebrow">WELCOME BACK</span><h1>로그인</h1><p>동네 이야기 계정으로 로그인해주세요.</p>
      <form id="login-form"><label>아이디<input name="userId" autocomplete="username" maxlength="80" required></label><label>비밀번호<input name="password" type="password" autocomplete="current-password" maxlength="128" required></label><button class="primary" type="submit">로그인</button></form>
      </section>`;
  } else if (kind === "posts") {
    content = '<header class="intro"><span class="eyebrow">OUR NEIGHBORHOOD</span><h1>동네의 작은 이야기를 나눠요.</h1><p>공개된 이야기와 나만의 기록을 만나보세요.</p></header><section class="card"><h2>게시글</h2><div id="posts" class="post-list" aria-busy="true"><p>게시글을 불러오는 중입니다.</p></div></section>';
    content += '<section class="card search-card"><h2>게시글 검색</h2><p>제목에 포함된 단어로 공개된 이야기를 찾아보세요.</p><form id="search-form"><label for="search-query">검색어</label><input id="search-query" name="q" type="search" maxlength="200" placeholder="제목으로 검색"><button class="primary" type="submit">검색</button></form><p id="search-status" role="status" aria-live="polite"></p><div id="search-results" class="post-list"></div></section>';
  } else {
    content = `<a class="back" href="${href("/posts")}">← 게시글 목록</a><article class="card" id="post" aria-busy="true"><p>게시글을 불러오는 중입니다.</p></article>`;
  }
  const title = kind === "lab" ? "IDOR 학습 · 동네 이야기" : "동네 이야기";
  const footer = kind === "lab"
    ? `VulnLab 독립 실습 사이트 · 가상 데이터 · 로컬 개발 전용<br>정상 게시판 접근 제어 유지 · IDOR 실습 ${enableIdorLab ? "활성화" : "비활성화"}`
    : "동네 이야기 · 함께 나누는 우리 동네 소식";
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/assets/site.css"><script type="module" src="/assets/app.js"></script>${kind === "lab" && enableIdorLab && user?.id === "user-a" ? '<script type="module" src="/assets/lab.js"></script>' : ""}</head><body data-page="${kind}"${activeGuide ? ` data-guide="${activeGuide}"` : ""}${postId === undefined ? "" : ` data-post-id="${postId}"`}><header class="topbar"><a class="brand" href="${href("/posts")}">동네 이야기<span>${kind === "lab" ? "LOCAL PRACTICE" : "COMMUNITY"}</span></a><nav aria-label="주 메뉴"><a href="${href("/posts")}">게시글</a>${account}</nav></header>${activeGuide ? '<div class="community-layout">' : ""}<main>${content}<p id="message" role="status" aria-live="polite"></p></main>${activeGuide ? `${guidePanel(activeGuide, enableIdorLab)}</div>` : ""}<footer>${footer}</footer></body></html>`;
}
