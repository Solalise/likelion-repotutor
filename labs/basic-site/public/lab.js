import { postPath, requestPost, requestText, isOwnBaseline, isIdorDiscovery, observeCommunityPost, observeCommunitySession } from "./http-client.js";
import { questions, gradeQuiz, isNormalComparison, learningComplete, analyzeDiscovery } from "./lesson.js";

export function initIdorLesson(root = document, integrated = false) {
if (integrated && root.dataset.initialized === "true") return () => {};
if (integrated) root.dataset.initialized = "true";
const subscriptions = [];
const $ = selector => root.querySelector(selector);
const fields = $("#request-fields");
const idInput = $("#request-id");
let baseline;
let discovered;
let busy = false;
let hintIndex = 0;
const learning = { attackSucceeded: false, comparisonDone: false, quizPassed: false };
let unlocked = 1;
let observedNormal;
let epoch = 0;
let observationVersion = 0;
async function lessonRequest(id, mode = "normal") {
  const started = epoch;
  const record = await requestPost(id, mode);
  if (started !== epoch) throw new Error("로그인 상태가 변경됐습니다. 다시 시작하세요.");
  return record;
}
const hints = [
  "먼저 자신의 비공개 글을 열고 URL의 마지막 숫자와 응답의 ownerId를 살펴보세요.",
  "로그인은 사용자를 확인합니다. 하지만 서버가 글마다 소유자를 확인하는지는 별개의 문제입니다. 번호를 바꾸면 어떻게 될까요?",
  "이 가상 게시판의 글 번호는 가까운 숫자로 이어집니다. 자신의 비공개 글 번호 주변을 하나씩 탐색하세요. 공개 글이나 자신의 글은 성공이 아닙니다.",
];
function step(index, text) {
  unlocked = Math.max(unlocked, index);
  $("#lab-progress").textContent = text || `${index}단계 · ${["개념과 목표", "게시판·정상 요청", "요청 수정·발견", "실제 응답 분석", "코드·방어 비교", "이해도 확인"][index - 1]}`;
  root.querySelectorAll("[data-stage]").forEach(item => {
    item.disabled = Number(item.dataset.stage) > unlocked;
    if (Number(item.dataset.stage) === index) item.setAttribute("aria-current", "step"); else item.removeAttribute("aria-current");
  });
  root.querySelectorAll("[data-stages]").forEach(item => { item.hidden = !item.dataset.stages.split(" ").includes(String(index)); });
  $("#request-form").hidden = index !== 3;
  $("#edit-start").disabled = !baseline && !observedNormal;
}
function resetDiscovery() {
  discovered = undefined;
  Object.assign(learning, { attackSucceeded: false, comparisonDone: false, quizPassed: false });
  unlocked = Math.min(unlocked, baseline ? 3 : 2);
  $("#analysis-facts").replaceChildren();
  $("#analysis-reason").textContent = "";
  $("#analysis-response").textContent = "";
  $("#vulnerable-response").textContent = "";
  $("#lesson-code").replaceChildren();
  $("#quiz-form").reset();
  root.querySelectorAll(".quiz-explanation").forEach(item => { item.textContent = ""; });
  $("#quiz-feedback").textContent = "";
  $("#learning-complete").hidden = true;
  $("#quiz-start").disabled = true;
  $("#lab-comparison").hidden = true;
  $("#comparison-result").textContent = "아직 정상 API 비교를 실행하지 않았습니다.";
  $("#comparison-feedback").textContent = "";
}
function resetSession() {
  epoch++; observationVersion++; baseline = undefined; observedNormal = undefined;
  resetDiscovery(); unlocked = 1; step(1);
  $("#observed-request").textContent = "로그인 상태가 변경됐습니다. 게시글을 다시 조회하세요.";
  $("#normal-result").textContent = "자신의 비공개 글을 다시 열어주세요.";
  $("#request-result").textContent = "아직 요청이 없습니다.";
}
function preview() {
  try {
    const path = postPath(idInput.value, "vulnerable");
    $("#request-url").value = new URL(path, location.origin).href;
    $("#request-path").textContent = path;
  } catch {
    $("#request-url").value = "";
    $("#request-path").textContent = "유효한 숫자 ID를 입력해주세요.";
  }
}
function renderPost(post) {
  const title = document.createElement("h3"); title.textContent = post.title;
  const owner = document.createElement("p"); owner.textContent = `작성자 ${post.ownerId} · ${post.visibility === "private" ? "비공개" : "공개"}`;
  const body = document.createElement("div"); body.className = "post-body"; body.textContent = post.body;
  $("#lab-post")?.replaceChildren(title, owner, body);
}
async function currentUser() {
  const started = epoch;
  const response = await fetch("/api/me", { credentials: "same-origin", cache: "no-store", redirect: "error" });
  if (started !== epoch) throw new Error("로그인 상태가 변경됐습니다.");
  if (response.status !== 200) return undefined;
  return (await response.json()).user?.id;
}
async function action(work) {
  if (busy) return;
  busy = true;
  fields.disabled = true;
  $("#compare-request").disabled = true;
  root.querySelectorAll("#lab-posts button").forEach(button => { button.disabled = true; });
  $("#lab-feedback").textContent = "요청을 전송하고 있습니다…";
  try { await work(); }
  catch (error) {
    baseline = undefined; resetDiscovery();
    $("#lab-feedback").textContent = error instanceof Error ? error.message : "요청을 완료하지 못했습니다.";
    step(2, "요청 또는 로그인 상태를 확인하지 못했습니다. 다시 자신의 글을 열어 시작하세요.");
  } finally {
    busy = false;
    fields.disabled = !baseline;
    $("#compare-request").disabled = false;
    root.querySelectorAll("#lab-posts button").forEach(button => { button.disabled = false; });
  }
}
async function send(id, edited, capturedNormal) {
  resetDiscovery();
  if ($("#lab-post")) $("#lab-post").textContent = "새 요청의 응답을 기다리는 중입니다.";
  $("#request-result").textContent = "실제 HTTP 응답을 기다리는 중입니다.";
  if (!edited) {
    const normal = capturedNormal || await lessonRequest(id);
    $("#normal-result").textContent = requestText(normal);
    $("#request-result").textContent = requestText(normal);
    if (normal.status === 200 && normal.data?.post) renderPost(normal.data.post);
    if (normal.status !== 200 || normal.data?.post?.ownerId !== "user-a" || normal.data?.post?.visibility !== "private") {
      baseline = undefined;
      $("#lab-feedback").textContent = "정상 API에서 자신의 비공개 글을 먼저 선택하세요.";
      step(2); return;
    }
  }
  const record = await lessonRequest(id, "vulnerable");
  $("#request-result").textContent = requestText(record);
  idInput.value = id; preview();
  if (record.status === 401) throw new Error("세션이 만료되었거나 로그인하지 않았습니다. 사용자 A로 다시 로그인해주세요.");
  if (record.status === 404 && record.data?.post === undefined) {
    $("#lab-feedback").textContent = "요청 경로 또는 글이 없습니다. ID를 확인하세요. 서버 재시작 후 실습이 비활성화됐다면 BASIC_SITE_ENABLE_IDOR=1이 필요합니다.";
    step(edited ? 3 : 2); return;
  }
  const userId = await currentUser();
  if (userId !== "user-a") throw new Error("현재 세션이 사용자 A가 아닙니다. 사용자 A로 로그인한 뒤 다시 시작해주세요.");
  if (record.status === 200 && record.data?.post) renderPost(record.data.post);
  if (!edited) {
    baseline = isOwnBaseline(record, userId) ? record : undefined;
    $("#lab-feedback").textContent = baseline ? "실제 조회 요청을 수집했습니다. 게시글 ID를 직접 바꾼 뒤 실행해보세요." : "실습 기준 요청을 만들려면 자신의 비공개 글을 먼저 선택하세요.";
    step(2, baseline ? "2단계 · 정상 요청의 ID와 ownerId를 확인한 뒤 3단계로 진행하세요." : "2단계 · 자신의 비공개 글을 열어주세요.");
  } else if (isIdorDiscovery(baseline, record, userId)) {
    discovered = record;
    learning.attackSucceeded = true;
    $("#analysis-response").textContent = requestText(record);
    $("#vulnerable-response").textContent = requestText(record);
    const facts = analyzeDiscovery(baseline, record, userId);
    for (const [label, value] of [["현재 로그인 사용자", facts.userId], ["요청한 게시글 ID", facts.requestedId], ["반환된 소유자", facts.ownerId], ["공개 여부", `${facts.visibility} (비공개)`], ["HTTP 응답 코드", facts.status]]) {
      const term = document.createElement("dt"); term.textContent = label;
      const detail = document.createElement("dd"); detail.textContent = String(value);
      $("#analysis-facts").append(term, detail);
    }
    $("#analysis-reason").textContent = `${facts.userId}의 세션으로 ${facts.ownerId} 소유의 비공개 글 본문이 실제 반환됐습니다. 자신의 글 기준 요청 이후 ID를 바꿨고, 소유자가 다른 비공개 데이터가 HTTP ${facts.status}으로 노출되어 IDOR로 판단합니다. 공격 성공이며 학습 완료는 아직 아닙니다.`;
    $("#lab-feedback").textContent = "IDOR 발견: A의 로그인 세션으로 B의 비공개 글과 본문이 반환됐습니다.";
    step(4, "4단계 · 공격 성공. 실제 응답의 소유자와 공개 범위를 분석하세요.");
  } else {
    $("#lab-feedback").textContent = "응답을 확인하세요. 공개 글이나 자신의 글 조회는 IDOR 성공으로 판정하지 않습니다.";
    step(3, "3단계 · 요청 ID와 응답의 소유자·공개 범위를 확인해보세요.");
  }
}
idInput.addEventListener("input", preview);
$("#request-form").addEventListener("submit", event => {
  event.preventDefault();
  if (baseline) void action(() => send(idInput.value, true));
});
$("#compare-request").addEventListener("click", () => void action(async () => {
  if (!discovered) return;
  const result = await lessonRequest(discovered.data.post.id);
  $("#comparison-result").textContent = requestText(result);
  if (await currentUser() !== "user-a") throw new Error("로그인 세션이 변경됐습니다. 사용자 A로 다시 시작해주세요.");
  const blocked = isNormalComparison(discovered, result, "user-a");
  learning.comparisonDone = blocked;
  learning.quizPassed = false;
  if (!blocked) unlocked = Math.min(unlocked, 5);
  $("#quiz-form").reset();
  root.querySelectorAll(".quiz-explanation").forEach(item => { item.textContent = ""; });
  $("#quiz-feedback").textContent = "";
  $("#learning-complete").hidden = true;
  $("#quiz-start").disabled = !blocked;
  $("#comparison-feedback").textContent = blocked
    ? "비교 완료: 같은 A 세션과 ID에서 정상 API는 403으로 차단하고 글 데이터를 반환하지 않습니다. 서버가 매 요청마다 소유권을 검사해야 합니다."
    : "정상 API의 차단을 확인하지 못했습니다. 실제 상태 코드와 응답 본문을 확인하세요.";
  $("#lab-feedback").textContent = "취약 요청과 정상 요청의 실제 응답을 비교하세요.";
  step(5, blocked ? "5단계 · 정상 API의 403 차단을 확인했습니다. 코드를 읽은 뒤 이해도 확인으로 진행하세요." : "5단계 · 정상 API 차단을 확인해야 다음 단계로 진행할 수 있습니다.");
}));
$("#hint-next").addEventListener("click", event => {
  const item = document.createElement("li"); item.textContent = hints[hintIndex++]; $("#hints").append(item);
  if (hintIndex === hints.length) { event.currentTarget.disabled = true; event.currentTarget.textContent = "모든 힌트를 확인했습니다"; }
});

$("#lesson-start").addEventListener("click", () => step(2));
$("#edit-start").addEventListener("click", () => {
  if (baseline) step(3);
  else if (observedNormal) void action(async () => {
    const captured = observedNormal;
    await send(String(captured.data.post.id), false, captured);
    if (baseline) step(3);
  });
});
root.querySelectorAll("[data-stage]").forEach(button => button.addEventListener("click", () => {
  if (!busy && Number(button.dataset.stage) <= unlocked) step(Number(button.dataset.stage));
}));
async function loadCode() {
  const started = epoch;
  $("#retry-code").disabled = true;
  try {
    const response = await fetch("/api/lab/idor-code", { credentials: "same-origin", cache: "no-store", redirect: "error" });
    if (!response.ok) throw new Error("코드를 불러오지 못했습니다. 로그인과 실습 활성 상태를 확인하고 다시 시도하세요.");
    const { snippets } = await response.json();
    if (started !== epoch) return;
    $("#lesson-code").replaceChildren();
    for (const name of ["getVulnerablePost", "getPost", "canReadPost"]) {
      const title = document.createElement("h4"); title.textContent = `${name}()`;
      const code = document.createElement("pre"); code.tabIndex = 0; code.textContent = snippets[name];
      $("#lesson-code").append(title, code);
    }
  } catch (error) { $("#lesson-code").textContent = error instanceof Error ? error.message : "코드를 불러오지 못했습니다."; }
  finally { $("#retry-code").disabled = false; }
}
$("#study-code").addEventListener("click", () => { if (discovered) { step(5); void loadCode(); } });
$("#retry-code").addEventListener("click", () => { if (discovered) void loadCode(); });
$("#quiz-start").addEventListener("click", () => { if (learning.comparisonDone) step(6); });
for (const [index, question] of questions.entries()) {
  const fieldset = document.createElement("fieldset");
  const legend = document.createElement("legend"); legend.textContent = `${index + 1}. ${question.prompt}`;
  fieldset.append(legend);
  question.options.forEach((option, value) => {
    const label = document.createElement("label");
    const input = document.createElement("input"); input.type = "radio"; input.name = `q${index}`; input.value = String(value); input.required = true;
    label.append(input, document.createTextNode(option)); fieldset.append(label);
  });
  const explanation = document.createElement("p"); explanation.id = `quiz-explanation-${index}`; explanation.className = "quiz-explanation";
  fieldset.append(explanation); $("#quiz-questions").append(fieldset);
}
$("#quiz-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!learning.attackSucceeded || !learning.comparisonDone || busy) return;
  if (integrated) {
    try { if (await currentUser() !== "user-a") { resetSession(); return; } }
    catch { resetSession(); return; }
  }
  const answers = new FormData(form);
  const results = gradeQuiz(questions.map((_, index) => answers.get(`q${index}`)));
  results.forEach((result, index) => { $(`#quiz-explanation-${index}`).textContent = `${result.correct ? "정답" : "다시 생각해보세요"} · ${result.explanation}`; });
  learning.quizPassed = results.every(result => result.correct);
  $("#quiz-feedback").textContent = learning.quizPassed ? "3문제 모두 정답입니다." : "아직 학습 완료가 아닙니다. 해설을 읽고 답을 수정해 다시 제출하세요.";
  $("#learning-complete").hidden = !learningComplete(learning);
  if (learningComplete(learning)) $("#lab-progress").textContent = "6단계 · 학습 완료! 공격 재현·정상 API 비교·이해도 확인을 모두 마쳤습니다.";
});
$("#quiz-form").addEventListener("change", () => {
  learning.quizPassed = false;
  $("#learning-complete").hidden = true;
  $("#quiz-feedback").textContent = "답안을 수정했습니다. 다시 제출해 확인하세요.";
  $("#lab-progress").textContent = "6단계 · 이해도 답안을 다시 확인하세요.";
});
async function loadPosts() {
  try {
    const response = await fetch("/api/posts", { credentials: "same-origin", cache: "no-store", redirect: "error" });
    if (!response.ok) throw new Error("목록을 불러오지 못했습니다.");
    const { posts } = await response.json();
    $("#lab-posts").replaceChildren();
    for (const post of posts) {
      const button = document.createElement("button"); button.type = "button"; button.className = "post-row lab-post-button";
      button.textContent = `${post.visibility === "private" ? "비공개" : "공개"} · ${post.title} · 작성자 ${post.ownerId}`;
      button.addEventListener("click", () => void action(async () => { baseline = undefined; await send(String(post.id), false); }));
      $("#lab-posts").append(button);
    }
  } catch { $("#lab-posts").textContent = "목록을 불러오지 못했습니다. 서버 연결을 확인하고 새로고침해주세요."; }
  finally { $("#lab-posts").setAttribute("aria-busy", "false"); }
}
if (integrated) {
  const enabled = root.dataset.enabled === "true";
  $("#idor-session-note").textContent = enabled
    ? "user-a로 로그인하고 커뮤니티에서 자신의 비공개 글을 여세요. 접기·펼치기와 게시글 탐색 중에는 학습 상태가 유지됩니다. 로그인 전환·로그아웃 시에는 초기화됩니다."
    : "실습 API가 비활성화되어 있습니다. 서버를 BASIC_SITE_ENABLE_IDOR=1로 실행한 뒤 새로고침하세요. 일반 커뮤니티는 계속 사용할 수 있습니다.";
  subscriptions.push(observeCommunityPost(record => {
    $("#observed-request").textContent = `${requestText(record)}\n\n게시글 ID: ${record.path.split("/").at(-1)}`;
    const version = ++observationVersion;
    void currentUser().then(userId => {
      if (version !== observationVersion || busy) return;
      const post = record.data?.post;
      if (userId !== "user-a" && (baseline || learning.attackSucceeded)) { resetSession(); return; }
      if (!baseline && enabled && userId === "user-a" && record.status === 200 && post?.ownerId === userId && post.visibility === "private") {
        observedNormal = record;
        $("#normal-result").textContent = requestText(record);
        $("#edit-start").disabled = false;
      }
    }).catch(() => { /* Session transitions are reset by the session observer. */ });
  }));
  subscriptions.push(observeCommunitySession(resetSession));
}
if (!integrated) void loadPosts();
step(1);
return () => { epoch++; for (const unsubscribe of subscriptions) unsubscribe(); };
}

if (document.body?.dataset.page === "lab") initIdorLesson();
