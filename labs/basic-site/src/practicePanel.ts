import type { GuideLab } from "./guide.ts";

/** Independent of the optional lesson's stage, evidence and completion state. */
export function practicePanel(lab: GuideLab) {
  const idor = lab === "idor";
  return `<section class="quick-practice" aria-labelledby="quick-title">
    <span class="eyebrow">FREE PRACTICE · ${idor ? "IDOR" : "SQL Injection"}</span>
    <h2 id="quick-title">가이드 없이 바로 실습</h2>
    <p>단계 진행이나 퀴즈 없이 요청을 보낼 수 있습니다. 아래 6단계 가이드는 필요할 때만 펼쳐보세요.</p>
    <p class="quick-account">먼저 <a href="/login?lab=${lab}">실습 계정으로 로그인</a>하세요.<br>사용자 A: <code>user-a</code> / <code>practice-a</code></p>
    <form id="quick-form">
      <label for="quick-value">${idor ? "게시글 ID" : "검색어"}</label>
      <input id="quick-value" name="value" ${idor ? 'value="101" inputmode="numeric" pattern="[0-9]{1,12}" maxlength="12" required' : 'value="산책" maxlength="200"'} autocomplete="off">
      <label for="quick-mode">요청 모드</label><select id="quick-mode" name="mode"><option value="vulnerable">취약 모드</option><option value="safe">안전 모드 · 정상 API</option></select>
      <button id="quick-submit" class="primary" type="submit">요청 전송</button>
    </form>
    <p id="quick-status" role="status" aria-live="polite">아직 요청하지 않았습니다. 입력과 모드를 선택해 직접 실행하세요.</p>
    <pre id="quick-result" tabindex="0" aria-label="자유 실습의 마지막 실제 요청과 응답">실제 응답이 여기에 표시됩니다.</pre>
    <p id="quick-comparison" role="status" aria-live="polite">같은 입력을 두 모드에 보내 응답을 비교하세요.</p>
    <details class="quick-help"><summary>입력 예시와 비교 방법</summary><p>${idor ? "사용자 A로 101번 글을 조회한 뒤 102번 글을 두 모드에서 조회하세요. 반환된 ownerId·visibility·body와 HTTP 상태를 비교합니다. 공개 글이나 자신의 글을 조회한 200 응답만으로 IDOR라고 판단하지 마세요." : "먼저 산책을 검색하세요. 조건 우회 예시: <code>&#39; OR 1=1 -- </code>. 같은 입력을 두 모드에서 실행하고 비공개 글 포함 여부를 비교하세요. 안전 모드는 전체 입력을 검색어로 처리합니다."}</p></details>
    <p class="quick-note">자유 실습 요청은 아래 가이드의 단계·퀴즈·완료 판정에 자동 반영되지 않습니다. 로그인·계정 전환·새로고침 시 이 결과는 초기화됩니다. 404가 나오면 서버의 실습 활성화 설정도 확인하세요.</p>
    <a class="back" href="http://localhost:3000/practice">← VulnLab 실습 목록</a>
  </section>`;
}
