import { lessonPage, requestWorkshop } from "./lessonPage.ts";

export type GuideLab = "idor" | "sqli";

/** UI selection only. Never use this value to authorize a vulnerable API. */
export function selectedGuide(params: URLSearchParams): GuideLab | undefined {
  if (params.getAll("lab").length !== 1) return undefined;
  const value = params.get("lab");
  return value === "idor" || value === "sqli" ? value : undefined;
}

export function communityHref(path: string, lab?: GuideLab) {
  return lab ? `${path}?lab=${lab}` : path;
}

export function guidePanel(lab: GuideLab, enableIdorLab = false) {
  const idor = lab === "idor";
  return `<aside class="learning-guide" aria-label="학습 가이드"><details class="guide-panel" open>
    <summary><span><small>학습 가이드</small><strong>${idor ? "IDOR" : "SQL Injection"}</strong></span><span class="guide-toggle"><span class="guide-open-label">접기</span><span class="guide-closed-label">펼치기</span> ↕</span></summary>
    <div class="guide-content"><p class="guide-state">${idor ? "커뮤니티 안에서 진행하는 6단계 학습" : "현재 단계 · 검색 학습 준비"}</p>
    ${idor ? `<div id="integrated-idor" data-enabled="${enableIdorLab}"><p id="idor-session-note"></p><details><summary>커뮤니티의 마지막 실제 게시글 요청</summary><pre id="observed-request" tabindex="0">아직 게시글 조회 요청이 없습니다.</pre></details>${lessonPage(requestWorkshop(true), true)}</div><a class="back" href="/lab/idor">기존 독립 IDOR 학습 화면</a>`
      : `<h2>검색어가 SQL 명령이 되면?</h2><p>SQL Injection은 검색어 같은 입력이 SQL 명령의 일부로 해석될 때 생깁니다. 먼저 이 커뮤니티의 게시글 검색으로 정상 동작을 관찰하세요.</p><ol><li>게시글 검색에 일반 검색어를 입력하세요.</li><li>정상 검색은 공개 실습 글만 반환한다는 점을 확인하세요.</li><li>이후 학습에서 문자열 결합과 파라미터 바인딩의 차이를 비교할 예정입니다.</li></ol><p>현재는 학습 준비 안내입니다. SQL Injection 단계별 학습 UI·공격 실행 도구는 아직 제공하지 않습니다.</p><p>검색 데이터는 게시판 글과 별도인 가상 데이터입니다. 정상 검색은 <code>GET /api/search?q=...</code>를 사용합니다.</p><a class="secondary guide-link" href="/?lab=sqli#search-form">게시글 검색으로 이동 ↓</a>`}

    <details><summary>학습용 가상 계정</summary><dl><dt>user-a</dt><dd>practice-a</dd><dt>user-b</dt><dd>practice-b</dd><dt>admin</dt><dd>practice-admin</dd></dl><p>공개된 실습용 계정입니다. 실제 비밀번호를 입력하지 마세요.</p></details>
    <p class="guide-note">이 주소의 lab 파라미터는 가이드만 선택합니다. 취약 API는 서버의 별도 환경변수와 접근 제한으로 관리되며, 주소를 열어도 활성화되지 않습니다.</p><a class="back" href="/">가이드 없이 일반 사이트 보기 →</a></div>
    </details></aside>`;
}
