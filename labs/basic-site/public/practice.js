import { requestPost, requestSearch, requestLabSearch, requestText, observeCommunitySession } from "./http-client.js";

// Fixed same-origin endpoints only; no lesson stage, quiz or storage dependency.
export function sendPractice(kind, value, mode, fetcher = fetch, origin = location.origin) {
  if (!["vulnerable", "safe"].includes(mode)) throw new Error("실습 모드를 선택하세요.");
  if (kind === "idor") return requestPost(value, mode === "safe" ? "normal" : "vulnerable", fetcher, origin);
  if (kind === "sqli") return mode === "safe" ? requestSearch(value, fetcher, origin) : requestLabSearch(value, fetcher, origin);
  throw new Error("지원하지 않는 실습입니다.");
}

export function practiceVerdict(kind, unsafe, safe, actor) {
  const post = unsafe?.data?.post;
  const attack = kind === "idor"
    ? Boolean(actor?.id && unsafe?.status === 200 && post?.ownerId && post.ownerId !== actor.id && post.visibility === "private" && typeof post.body === "string" && post.body.length > 0)
    : Boolean(unsafe?.status === 200 && unsafe.data?.dataset === "sqli-practice" && unsafe.data.posts?.some(p => p.visibility === "private" && typeof p.body === "string" && p.body.length > 0));
  const compared = attack && (kind === "idor"
    ? safe?.status === 403 && safe.data?.error === "FORBIDDEN" && !Object.hasOwn(safe.data, "post")
    : safe?.status === 200 && safe.query === unsafe.query && safe.data?.dataset === "sqli-practice" && Array.isArray(safe.data.posts) && safe.data.posts.every(p => p.visibility === "public"));
  return { attack, compared: Boolean(compared) };
}

export function initPractice(kind, root = document) {
  const $ = selector => root.querySelector(selector);
  const form = $("#quick-form");
  if (!form) return () => {};
  const submit = $("#quick-submit");
  const input = $("#quick-value");
  const status = $("#quick-status");
  const result = $("#quick-result");
  const comparison = $("#quick-comparison");
  let generation = 0;
  let busy = false;
  let controller;
  let records = {};
  let actor;
  function verdict() {
    const result = practiceVerdict(kind, records.vulnerable, records.safe, actor);
    const label = $("#mode-free-status");
    if (label) label.textContent = result.attack ? `자유 실습: 재현 성공${result.compared ? " · 안전 비교 완료" : ""}` : "자유 실습: 재현 미확인";
    return result;
  }
  function reset() {
    generation++;
    controller?.abort();
    busy = false;
    submit.disabled = false;
    records = {};
    actor = undefined;
    verdict();
    result.textContent = "실제 응답이 여기에 표시됩니다.";
    status.textContent = "입력 또는 세션이 바뀌었습니다. 요청을 다시 보내세요.";
    comparison.textContent = "같은 입력을 두 모드에 보내 응답을 비교하세요.";
  }
  async function send(event) {
    event.preventDefault();
    if (busy) return;
    const token = generation;
    const value = input.value;
    const mode = $("#quick-mode").value;
    busy = true;
    submit.disabled = true;
    const requestController = new AbortController();
    controller = requestController;
    const timer = setTimeout(() => requestController.abort(), 5000);
    status.textContent = "로컬 서버에 실제 요청을 보내고 있습니다…";
    try {
      const meRequest = new Request(new URL("/api/me", location.origin), { credentials: "same-origin", cache: "no-store", redirect: "error" });
      const me = await fetch(meRequest, { signal: requestController.signal });
      const identity = me.ok ? (await me.json()).user : undefined;
      if (token !== generation) return;
      if (actor && (actor.id !== identity?.id || actor.role !== identity?.role)) { reset(); status.textContent = "세션이 바뀌어 결과를 초기화했습니다. 다시 요청하세요."; return; }
      actor = identity;
      const record = await sendPractice(kind, value, mode, request => fetch(request, { signal: requestController.signal }));
      if (token !== generation) return;
      result.textContent = requestText(record);
      records[mode] = record;
      const outcome = verdict();
      status.textContent = record.status === 401 ? "로그인이 필요하거나 세션이 만료됐습니다. 실습 계정으로 로그인하세요."
        : record.status === 404 ? "글이 없거나 실습이 비활성화되어 있습니다. ID와 서버 활성화 설정을 확인하세요."
        : record.status === 403 ? "접근 거부: 서버의 권한 검사가 동작했습니다."
        : record.status === 200 ? "실제 응답을 받았습니다. 상태 코드와 반환된 데이터를 함께 확인하세요."
        : `HTTP ${record.status} · 응답의 오류 내용을 확인하세요.`;
      if (record.status === 200) status.textContent += outcome.attack ? " 공격 재현 성공: 타인 비공개 데이터의 실제 반환을 확인했습니다." : " 재현 미확인: 공개 데이터나 자신의 데이터만으로 성공 처리하지 않습니다.";
      if (records.vulnerable && records.safe) {
        const unsafe = records.vulnerable;
        const safe = records.safe;
        const privateCount = kind === "sqli" && Array.isArray(unsafe.data?.posts)
          ? unsafe.data.posts.filter(post => post.visibility === "private").length : undefined;
        comparison.textContent = `동일 입력 비교 · 취약 HTTP ${unsafe.status} / 안전 HTTP ${safe.status}`
          + (privateCount === undefined ? " · 소유자·공개 여부·본문을 확인하세요." : ` · 취약 응답의 비공개 글 ${privateCount}개 / 안전 응답 ${Array.isArray(safe.data?.posts) ? safe.data.posts.length + "개" : "조회 실패"}`);
      }
    } catch (error) {
      if (token !== generation) return;
      result.textContent = "응답을 받지 못했습니다. 이전 응답으로 이번 결과를 판정하지 않습니다.";
      delete records[mode];
      verdict();
      comparison.textContent = "이번 요청에 실패했습니다. 두 모드의 실제 응답을 다시 확인하세요.";
      status.textContent = error instanceof Error && error.message.includes("게시글 ID") ? error.message : "요청 실패: 실습 서버 실행·연결 상태와 입력을 확인한 뒤 다시 전송하세요.";
    } finally {
      clearTimeout(timer);
      if (token === generation) { busy = false; submit.disabled = false; }
    }
  }
  form.addEventListener("submit", send);
  input.addEventListener("input", reset);
  const unsubscribe = observeCommunitySession(reset);
  return () => { reset(); form.removeEventListener("submit", send); input.removeEventListener("input", reset); unsubscribe(); };
}
