import { sqliLessonPage } from "./sqliLessonPage.ts";
import { practicePanel } from "./practicePanel.ts";
import { lessonPage, requestWorkshop } from "./lessonPage.ts";
import { modeNavigation, type PracticeMode } from "./modes.ts";

export type GuideLab = "idor" | "sqli";

/** UI selection only. Never use this value to authorize a vulnerable API. */
export function selectedGuide(params: URLSearchParams): GuideLab | undefined {
  if (params.getAll("lab").length !== 1) return undefined;
  const value = params.get("lab");
  return value === "idor" || value === "sqli" ? value : undefined;
}

export function communityHref(path: string, lab?: GuideLab, mode?: PracticeMode) {
  return lab ? `${path}?lab=${lab}${mode ? `&amp;mode=${mode}` : ""}` : path;
}

export function guidePanel(lab: GuideLab, enableIdorLab = false, mode?: PracticeMode) {
  const idor = lab === "idor";
  return `<aside class="learning-guide" aria-label="학습 가이드">${modeNavigation("/", lab)}${practicePanel(lab)}<details class="guide-panel"${mode === "guided" ? " open" : ""}>
    <summary><span><small>학습 가이드</small><strong>${idor ? "IDOR" : "SQL Injection"}</strong></span><span class="guide-toggle"><span class="guide-open-label">접기</span><span class="guide-closed-label">펼치기</span> ↕</span></summary>
    <div class="guide-content"><a class="back" href="http://localhost:3000/learn/${lab}">VulnLab 개념 학습으로 이동</a><p>선택형 6단계 가이드입니다. 접어도 자유 실습을 계속할 수 있고, 다시 펼치면 현재 단계와 기록이 유지됩니다.</p><p class="guide-state">${idor ? "커뮤니티 안에서 진행하는 6단계 학습" : "커뮤니티 안에서 진행하는 SQL Injection 6단계 학습"}</p>
    ${idor ? `<div data-learning-panel id="integrated-idor" data-enabled="${enableIdorLab}"><p id="idor-session-note"></p><details><summary>커뮤니티의 마지막 실제 게시글 요청</summary><pre id="observed-request" tabindex="0">아직 게시글 조회 요청이 없습니다.</pre></details>${lessonPage(requestWorkshop(true), true)}</div><a class="back" href="/lab/idor">기존 독립 IDOR 학습 화면</a>`
      : sqliLessonPage()}

    <details><summary>학습용 가상 계정</summary><dl><dt>user-a</dt><dd>practice-a</dd><dt>user-b</dt><dd>practice-b</dd><dt>admin</dt><dd>practice-admin</dd></dl><p>공개된 실습용 계정입니다. 실제 비밀번호를 입력하지 마세요.</p></details>
    <p class="guide-note">이 주소의 lab 파라미터는 자유 실습 화면과 선택형 가이드를 선택합니다. 취약 API는 서버의 별도 환경변수와 접근 제한으로 관리되며, 주소를 열어도 활성화되지 않습니다.</p><a class="back" href="/">가이드 없이 일반 사이트 보기 →</a></div>
    </details></aside>`;
}
