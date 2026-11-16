import { observeCommunitySearch, observeCommunitySession, requestText, requestLabSearch, requestSearch } from "./http-client.js";
import { renderLessonStep, renderMultipleChoiceQuiz, sqliQuestions, gradeAnswers, sqliLearningComplete } from "./lesson.js";

const titles = ["개념과 목표", "정상 검색 요청 관찰", "요청 수정 및 실습", "검색 결과 분석", "코드 및 방어 방식 비교", "퀴즈 및 학습 완료"];

export function isSearchResponse(record, path, publicOnly = false) {
  if (record?.kind !== "search" || record.method !== "GET" || record.path !== path || record.status !== 200 || typeof record.query !== "string") return false;
  try {
    const url = new URL(record.url);
    if (url.pathname !== path || url.searchParams.getAll("q").length !== 1 || url.searchParams.get("q") !== record.query) return false;
  } catch { return false; }
  return record.data?.dataset === "sqli-practice" && Array.isArray(record.data.posts)
    && record.data.posts.every(post => Number.isSafeInteger(post?.id) && post.id > 0 && typeof post.title === "string" && typeof post.body === "string"
      && (publicOnly ? post.visibility === "public" : ["public", "private"].includes(post.visibility)));
}
export function isNormalSearchObservation(record) { return isSearchResponse(record, "/api/search", true); }
export function compareSearchResponses(education, normal) {
  const complete = isSearchResponse(education, "/api/lab/vulnerable/search") && isNormalSearchObservation(normal) && education.query === normal.query;
  const exposed = complete ? education.data.posts.filter(post => post.visibility === "private" && post.body.length > 0 && !normal.data.posts.some(safe => safe.id === post.id)) : [];
  return { complete, reproduced: complete && exposed.length > 0, exposedIds: exposed.map(post => post.id) };
}

// Render only fields present in the actual response. No inferred owners or fixtures.
function renderResults(target, record) {
  target.replaceChildren();
  const posts = record?.data?.posts;
  const count = document.createElement("p");
  count.textContent = `HTTP ${record.status} · 실제 검색 결과 ${Array.isArray(posts) ? `${posts.length}개` : "개수 확인 불가"}`;
  target.append(count);
  if (!Array.isArray(posts)) return;
  for (const post of posts) {
    const item = document.createElement("p");
    item.textContent = ["id", "title", "visibility", "body"].filter(key => post && Object.hasOwn(post, key)).map(key => `${key}: ${post[key]}`).join("\n");
    target.append(item);
  }
}

export function initSqliLesson(root) {
  if (root.dataset.initialized === "true") return () => {};
  root.dataset.initialized = "true";
  const $ = selector => root.querySelector(selector);
  let stage = 1;
  let unlocked = 1;
  let source;
  let education;
  let normalComparison;
  let comparisonDone = false;
  let reproduced = false;
  let codeLoaded = false;
  let codeViewed = false;
  let quizPassed = false;
  let busy = false;
  let generation = 0;
  let hintIndex = 0;
  const hints = [
    "검색어는 SQL 문자열 안에 들어갑니다. 작은따옴표가 문자열의 시작과 끝에 어떤 역할을 하는지 생각해보세요.",
    "문자열을 닫은 뒤 OR로 항상 참인 조건을 연결하면 공개 범위 조건에 어떤 영향이 있을까요? 뒤에 남는 SQL도 살펴보세요.",
    "필요한 경우 이 가상 실습에서 ' OR 1=1 -- 를 직접 입력해보세요. 문자열을 닫고 참인 조건을 연결한 뒤 나머지를 주석 처리하는 예입니다. 결과는 실제 응답과 동일 입력의 정상 API 비교로 판단하세요.",
  ];
  function mark(index, complete) {
    const button = $(`[data-stage="${index}"]`);
    if (complete) button.setAttribute("data-complete", "true"); else button.removeAttribute("data-complete");
  }
  function controls() {
    $("#sqli-request-fields").disabled = busy || !source;
    $("#sqli-edit-start").disabled = busy || !source;
    $("#sqli-analysis-start").disabled = busy || !education;
    $("#sqli-compare").disabled = busy || !education;
    $("#sqli-code-start").disabled = busy || !comparisonDone;
    $("#sqli-code-retry").disabled = busy || !comparisonDone;
    $("#sqli-code-confirm").disabled = busy || !codeLoaded || codeViewed;
    $("#sqli-quiz-start").disabled = busy || !codeViewed;
  }
  function show(index) {
    if (index < 1 || index > 6 || (index >= 5 && !comparisonDone) || (index === 6 && !codeViewed)) return;
    stage = index; unlocked = Math.max(unlocked, index);
    const complete = index === 2 ? Boolean(source) : index === 3 ? Boolean(education) : index === 4 ? comparisonDone : index === 5 ? codeViewed : index === 6 ? quizPassed : false;
    const descriptions = { 2: "실제 정상 검색 응답 확인", 3: "실제 교육용 검색 응답 확인", 4: "동일 입력의 실제 응답 비교 완료", 5: "실제 코드 자료를 확인", 6: "세 문제 모두 정답" };
    renderLessonStep(root, index, { titles, unlocked, progress: "#sqli-progress", text: complete ? `${index}단계 완료 · ${descriptions[index]}` : undefined });
    controls();
  }
  function updateCompletion() {
    const complete = sqliLearningComplete({ normalObserved: source, educationResponse: education, comparisonDone, codeViewed, quizPassed });
    $("#sqli-learning-complete").hidden = !complete;
    if (complete) $("#sqli-completion-reproduction").textContent = reproduced
      ? "취약점 재현: 실제 교육용 응답에서 정상 응답에 없던 비공개 데이터가 확인됐습니다."
      : "취약점 재현: 실제 응답에서는 비공개 데이터 노출을 확인하지 못했습니다. 학습 과정 완료와 취약점 재현은 별도입니다.";
    return complete;
  }
  function clearQuiz() {
    quizPassed = false; mark(6, false);
    root.querySelectorAll("[data-quiz-answer]").forEach(input => { input.checked = false; });
    root.querySelectorAll("[data-quiz-explanation]").forEach(item => { item.textContent = ""; });
    $("#sqli-quiz-feedback").textContent = "";
    updateCompletion();
  }
  function clearCode() {
    codeLoaded = false; codeViewed = false; mark(5, false);
    $("#sqli-code-source").textContent = "코드 자료를 요청하기 전입니다.";
    $("#sqli-code-snippet").textContent = "실제 소스에서 발췌한 코드가 여기에 표시됩니다.";
    $("#sqli-code-feedback").textContent = "";
    $("#sqli-code-evidence").replaceChildren();
    clearQuiz();
  }
  function clearComparison() {
    comparisonDone = false; normalComparison = undefined; reproduced = false; mark(4, false);
    $("#sqli-comparison-record").textContent = "아직 정상 API 비교를 실행하지 않았습니다.";
    $("#sqli-comparison-results").replaceChildren();
    $("#sqli-comparison-feedback").textContent = "";
    $("#sqli-reproduction-state").textContent = "재현 여부: 아직 비교하지 않아 판정하지 않았습니다.";
    $("#sqli-code-start").disabled = true;
    clearCode();
  }
  function clearPractice() {
    education = undefined; mark(3, false); clearComparison();
    $("#sqli-replay-record").textContent = "아직 교육용 API에 요청하지 않았습니다.";
    $("#sqli-replay-feedback").textContent = "";
    $("#sqli-education-record").textContent = "아직 비교할 응답이 없습니다.";
    $("#sqli-education-results").replaceChildren();
  }
  function preview() {
    const url = new URL("/api/lab/vulnerable/search", location.origin);
    url.search = new URLSearchParams({ q: $("#sqli-request-query").value }).toString();
    $("#sqli-request-url").value = url.href;
    $("#sqli-request-path").textContent = `${url.pathname}${url.search}`;
  }
  function reset() {
    generation++; busy = false; source = undefined; unlocked = 1;
    clearPractice(); mark(2, false);
    $("#sqli-search-record").textContent = "아직 관찰된 검색 요청이 없습니다";
    $("#sqli-search-results").replaceChildren();
    $("#sqli-search-feedback").textContent = "검색 요청을 기다리고 있습니다. 2단계는 아직 완료되지 않았습니다.";
    $("#sqli-editor-source").textContent = "아직 수집한 요청이 없습니다.";
    $("#sqli-request-query").value = ""; $("#sqli-request-url").value = "";
    $("#sqli-request-path").textContent = "아직 요청이 없습니다.";
    hintIndex = 0; $("#sqli-hints").replaceChildren(); $("#sqli-hint-next").disabled = false;
    show(1);
  }
  function renderQuiz() {
    renderMultipleChoiceQuiz($("#sqli-quiz-questions"), sqliQuestions, { namePrefix: "sqli-q", explanationPrefix: "sqli-quiz-explanation" });
  }
  function renderEvidence() {
    const safePosts = normalComparison?.data?.posts;
    const labPosts = education?.data?.posts;
    const privateIds = Array.isArray(labPosts) ? labPosts.filter(post => post.visibility === "private").map(post => post.id) : [];
    const rows = [
      ["검색어", education?.query],
      ["교육용 응답", education ? `HTTP ${education.status} · ${labPosts.length}개` : "응답 없음"],
      ["정상 응답", normalComparison ? `HTTP ${normalComparison.status} · ${safePosts.length}개` : "응답 없음"],
      ["교육용 응답의 비공개 게시글 ID", privateIds.length ? privateIds.join(", ") : "없음"],
      ["실제 응답 비교 결과", reproduced ? "정상 응답에 없는 비공개 데이터가 반환됨" : "비공개 데이터 노출을 확인하지 못함"],
    ];
    const target = $("#sqli-code-evidence"); target.replaceChildren();
    for (const [name, value] of rows) {
      const term = document.createElement("dt"); term.textContent = name;
      const description = document.createElement("dd"); description.textContent = String(value ?? "");
      target.append(term, description);
    }
  }
  async function loadCode(token) {
    $("#sqli-code-feedback").textContent = "서버의 실제 검색 소스에서 코드 발췌를 불러오고 있습니다…";
    const response = await fetch("/api/lab/sqli-code", { credentials: "same-origin", cache: "no-store", redirect: "error" });
    if (!response.ok) throw new Error(response.status === 401 ? "로그인 후 코드를 확인하세요." : "SQLI 실습이 활성화된 로컬 개발 서버인지 확인한 뒤 다시 시도하세요.");
    const data = await response.json();
    if (token !== generation) return;
    if (data.file !== "src/features/search.ts" || !Number.isSafeInteger(data.line) || typeof data.snippet !== "string"
      || !data.snippet.includes("vulnerable ?") || !data.snippet.includes("ESCAPE '!'") || !data.snippet.includes("statement.all(literalPattern)")) {
      throw new Error("서버에서 검증된 검색 코드 발췌를 받지 못했습니다.");
    }
    codeLoaded = true;
    $("#sqli-code-source").textContent = `출처: labs/basic-site/${data.file}:${data.line} (서버가 원본 파일에서 발췌)`;
    $("#sqli-code-snippet").textContent = data.snippet;
    $("#sqli-code-feedback").textContent = "취약 분기와 정상 분기, 실제 바인딩 호출이 같은 원본 검색 구현에 있습니다. 코드를 읽고 확인 버튼을 누르세요.";
    controls();
  }
  async function run(feedback, task) {
    if (busy) return;
    const token = generation;
    busy = true; controls();
    try { await task(token); }
    catch (error) {
      if (token === generation) {
        $(feedback).textContent = `요청을 완료하지 못했습니다. ${error instanceof Error ? error.message : "연결을 확인하세요."} 실제 HTTP 응답이 없으면 결과를 판정하지 않습니다. 다시 시도하세요.`;
        const record = feedback === "#sqli-replay-feedback" ? "#sqli-replay-record" : feedback === "#sqli-comparison-feedback" ? "#sqli-comparison-record" : "#sqli-code-source";
        $(record).textContent = feedback === "#sqli-code-feedback" ? "코드 자료를 불러오지 못했습니다. 로그인·실습 설정을 확인하고 다시 시도하세요." : "실제 HTTP 응답을 받지 못했습니다. 연결을 확인하고 다시 시도하세요.";
      }
    } finally { if (token === generation) { busy = false; show(stage); } }
  }
  renderQuiz();
  $("#sqli-start").addEventListener("click", () => { if (!busy) show(2); });
  $("#sqli-edit-start").addEventListener("click", () => { if (!busy && source) show(3); });
  $("#sqli-analysis-start").addEventListener("click", () => { if (!busy && education) show(4); });
  $("#sqli-code-start").addEventListener("click", () => {
    if (!comparisonDone || busy) return;
    show(5); renderEvidence();
    if (!codeLoaded) void run("#sqli-code-feedback", token => loadCode(token));
  });
  $("#sqli-code-retry").addEventListener("click", () => {
    if (!comparisonDone || busy) return;
    void run("#sqli-code-feedback", token => loadCode(token));
  });
  $("#sqli-code-confirm").addEventListener("click", () => {
    if (!codeLoaded || busy) return;
    codeViewed = true; mark(5, true); unlocked = 6; controls();
    $("#sqli-code-feedback").textContent = "5단계 완료 · 실제 소스와 정상·교육용 응답의 관계를 확인했습니다. 퀴즈로 진행할 수 있습니다.";
    show(5);
  });
  $("#sqli-quiz-start").addEventListener("click", () => { if (codeViewed && comparisonDone && !busy) show(6); });
  $("#sqli-request-query").addEventListener("input", preview);
  root.querySelectorAll("[data-stage]").forEach(button => button.addEventListener("click", () => {
    const target = Number(button.dataset.stage);
    if (!busy && target <= unlocked) show(target);
  }));
  $("#sqli-request-form").addEventListener("submit", event => {
    event.preventDefault();
    if (!source || busy) return;
    void run("#sqli-replay-feedback", async token => {
      clearPractice(); unlocked = 3;
      $("#sqli-replay-record").textContent = "실제 HTTP 응답을 기다리는 중입니다.";
      $("#sqli-replay-feedback").textContent = "교육용 API에 요청을 전송하고 있습니다…";
      const record = await requestLabSearch($("#sqli-request-query").value);
      if (token !== generation) return;
      $("#sqli-replay-record").textContent = requestText(record);
      if (!isSearchResponse(record, "/api/lab/vulnerable/search")) {
        $("#sqli-replay-feedback").textContent = `HTTP ${record.status} · 정상적인 교육용 검색 결과를 확인하지 못했습니다. ${record.data?.message || "응답 내용을 확인하세요."} 401이면 로그인, 404이면 BASIC_SITE_ENABLE_SQLI=1 설정을 확인하고 다시 시도하세요.`;
        return;
      }
      education = record; unlocked = 4; mark(3, true);
      $("#sqli-education-record").textContent = requestText(record);
      renderResults($("#sqli-education-results"), record);
      $("#sqli-replay-feedback").textContent = "3단계 완료 · 실제 교육용 검색 응답을 확인했습니다. HTTP 200만으로 조건 우회 성공을 판정하지 않습니다. 4단계에서 같은 검색어로 비교하세요.";
    });
  });
  $("#sqli-compare").addEventListener("click", () => {
    if (!education || busy) return;
    const captured = education;
    void run("#sqli-comparison-feedback", async token => {
      clearComparison();
      $("#sqli-comparison-feedback").textContent = "같은 검색어로 정상 API의 실제 응답을 기다리고 있습니다…";
      const normal = await requestSearch(captured.query);
      if (token !== generation) return;
      $("#sqli-comparison-record").textContent = requestText(normal);
      renderResults($("#sqli-comparison-results"), normal);
      const result = compareSearchResponses(captured, normal);
      comparisonDone = Boolean(source && result.complete); normalComparison = comparisonDone ? normal : undefined;
      reproduced = comparisonDone && result.reproduced; mark(4, comparisonDone);
      if (comparisonDone) { unlocked = 5; $("#sqli-code-start").disabled = false; }
      $("#sqli-comparison-feedback").textContent = comparisonDone
        ? "4단계 완료 · 동일한 검색어의 정상·교육용 응답을 비교했습니다. 전체 학습 완료는 아닙니다."
        : "정상 비교 응답을 확인하지 못했습니다. 4단계는 미완료입니다. 응답을 확인하고 다시 비교하세요.";
      $("#sqli-reproduction-state").textContent = !comparisonDone ? "재현 여부: 유효한 비교 응답이 없어 판정하지 않았습니다."
        : result.reproduced ? `조건 우회 재현 확인 · 교육용 API에서 비공개 글 ${result.exposedIds.join(", ")}의 본문이 반환됐고, 같은 입력의 정상 API에는 해당 비공개 데이터가 없습니다. 두 실제 응답을 근거로 판단했습니다.`
        : "조건 우회 재현은 확인되지 않았습니다. HTTP 200이나 결과 개수 차이만으로 성공 처리하지 않습니다. 비교 단계 완료와 취약점 재현은 별개입니다.";
      if (comparisonDone) renderEvidence();
    });
  });
  $("#sqli-quiz-form").addEventListener("submit", event => {
    event.preventDefault();
    if (!source || !education || !comparisonDone || !codeViewed || busy) return;
    const inputs = [...root.querySelectorAll("[data-quiz-answer]")];
    const answers = sqliQuestions.map((_, index) => inputs.find(input => input.dataset.quizQuestion === String(index) && input.checked)?.value);
    if (answers.some(answer => answer === undefined)) {
      $("#sqli-quiz-feedback").textContent = "세 문제 모두 선택한 뒤 답안을 확인하세요.";
      return;
    }
    const results = gradeAnswers(sqliQuestions, answers);
    results.forEach((result, index) => {
      $(`#sqli-quiz-explanation-${index}`).textContent = `${result.correct ? "정답" : "오답"} · ${result.explanation}`;
    });
    quizPassed = results.every(result => result.correct); mark(6, quizPassed);
    $("#sqli-quiz-feedback").textContent = quizPassed
      ? "3문제 모두 정답입니다. 모든 학습 조건을 확인했습니다."
      : `${results.filter(result => result.correct).length}/3 정답입니다. 해설을 읽고 답을 수정해 다시 제출하세요.`;
    const complete = updateCompletion();
    if (complete) show(6);
  });
  $("#sqli-quiz-form").addEventListener("change", () => {
    if (!quizPassed) return;
    quizPassed = false; mark(6, false); updateCompletion();
    $("#sqli-quiz-feedback").textContent = "답안을 수정했습니다. 다시 제출해 확인하세요.";
    show(6);
  });
  $("#sqli-hint-next").addEventListener("click", () => {
    if (hintIndex >= hints.length) return;
    const item = document.createElement("li"); item.textContent = hints[hintIndex++]; $("#sqli-hints").append(item);
    $("#sqli-hint-next").disabled = hintIndex === hints.length;
  });
  const offSearch = observeCommunitySearch(record => {
    if (record?.kind !== "search" || record.method !== "GET" || record.path !== "/api/search") return;
    generation++; busy = false; unlocked = 2; clearPractice();
    $("#sqli-search-record").textContent = requestText(record);
    source = isNormalSearchObservation(record) ? record : undefined;
    $("#sqli-search-results").replaceChildren(); mark(2, Boolean(source));
    if (source) {
      renderResults($("#sqli-search-results"), source);
      $("#sqli-editor-source").textContent = requestText(source);
      $("#sqli-request-query").value = source.query; preview();
    } else {
      $("#sqli-editor-source").textContent = "정상 검색 요청을 다시 수집하세요.";
      $("#sqli-request-query").value = ""; $("#sqli-request-url").value = "";
      $("#sqli-request-path").textContent = "정상 검색 요청을 다시 수집하세요.";
    }
    $("#sqli-search-feedback").textContent = source
      ? "2단계 완료 · 정상 검색의 실제 요청과 공개 결과를 확인했습니다. 이제 수집한 요청을 편집할 수 있습니다. 새 검색을 하면 이후 단계의 결과가 초기화됩니다."
      : "실제 응답은 기록했지만 정상 검색 결과를 확인하지 못했습니다. 검색어와 서버 응답을 확인하고 다시 검색하세요. 2단계는 미완료입니다.";
    show(2);
  });
  const offSession = observeCommunitySession(reset);
  reset();
  return () => { generation++; offSearch(); offSession(); delete root.dataset.initialized; };
}
