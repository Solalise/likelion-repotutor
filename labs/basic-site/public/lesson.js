import { isIdorDiscovery } from "./http-client.js";

/** Shared presentation only; each lesson retains its own progression conditions. */
export function renderLessonStep(root, index, { titles, unlocked, text, progress = "#lab-progress" }) {
  root.querySelector(progress).textContent = text || `${index}단계 · ${titles[index - 1]}`;
  root.querySelectorAll("[data-stage]").forEach(item => {
    item.disabled = Number(item.dataset.stage) > unlocked;
    if (Number(item.dataset.stage) === index) item.setAttribute("aria-current", "step"); else item.removeAttribute("aria-current");
  });
  root.querySelectorAll("[data-stages]").forEach(item => { item.hidden = !item.dataset.stages.split(" ").includes(String(index)); });
}

export const questions = [
  { prompt: "게시글 ID를 알고 있으면 비공개 글을 읽어도 될까요?", options: ["ID를 알면 권한도 있다", "ID와 읽기 권한은 별개다"], answer: "1", explanation: "ID는 글을 찾는 번호입니다. 읽기 권한은 서버가 로그인한 사용자와 글의 공개 범위·소유자를 확인해 결정합니다." },
  { prompt: "HTTP 200만으로 IDOR라고 판단할 수 있을까요?", options: ["아니다. 타인의 비공개 본문이 반환됐는지 확인해야 한다", "그렇다. 모든 200은 IDOR다"], answer: "0", explanation: "공개 글이나 자신의 글도 200입니다. 로그인 사용자·요청 ID·소유자·공개 여부·본문을 함께 확인해야 합니다." },
  { prompt: "권한 검사는 어디에서 해야 할까요?", options: ["화면에서 버튼만 숨긴다", "서버에서 매 조회 요청마다 검사한다"], answer: "1", explanation: "화면을 거치지 않고 HTTP 요청을 직접 보낼 수 있습니다. 서버가 canReadPost()로 읽기 권한을 확인하고 거부해야 합니다." },
];

export const sqliQuestions = [
  { prompt: "검색에서 SQL Injection이 생기는 주된 원인은 무엇인가요?", options: ["검색어를 SQL 문자열에 그대로 결합해 입력이 SQL 구문으로 해석될 수 있어서", "검색어가 URL에 표시되기만 해서", "HTTP GET 요청을 사용해서", "검색 결과에 공개 글이 있어서"], answer: "0", explanation: "문자열 결합으로 입력이 SQL의 따옴표나 조건 구조를 바꿀 수 있으면 검색 값이 명령의 일부로 해석될 수 있습니다." },
  { prompt: "이번 실습에서 정상 검색과 교육용 검색의 차이는 무엇인가요?", options: ["둘 다 같은 API지만 화면만 다르다", "정상 검색은 검색값을 바인딩하고 공개 범위만 반환하며, 교육용 검색은 입력을 SQL 문자열에 결합한다", "정상 검색은 로그인한 사용자만 쓸 수 있다", "교육용 검색은 항상 모든 데이터베이스 내용을 반환한다"], answer: "1", explanation: "정상 API는 공개 게시글 조건과 바인딩된 검색값을 사용합니다. 교육용 API는 가상 DB의 제한된 SELECT에서만 문자열 결합 취약점을 보여줍니다." },
  { prompt: "파라미터 바인딩은 어떻게 SQL Injection을 막나요?", options: ["입력에서 모든 특수문자를 무조건 삭제한다", "SQL 명령과 입력값을 따로 전달해 입력을 데이터로 처리한다", "검색 기능을 비활성화한다", "입력값을 화면에서 숨긴다"], answer: "1", explanation: "쿼리 구조를 먼저 준비하고 입력값을 별도로 바인딩하면 따옴표나 SQL처럼 보이는 글자도 명령이 아니라 검색 데이터로 처리됩니다." },
];

/** Shared radio-question markup for both learning guides. */
export function renderMultipleChoiceQuiz(container, questionSet, { namePrefix = "q", explanationPrefix = "quiz-explanation" } = {}) {
  container.replaceChildren();
  questionSet.forEach((question, index) => {
    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend"); legend.textContent = `${index + 1}. ${question.prompt}`;
    fieldset.append(legend);
    question.options.forEach((option, value) => {
      const label = document.createElement("label");
      const input = document.createElement("input"); input.type = "radio"; input.name = `${namePrefix}${index}`; input.value = String(value); input.required = true;
      input.dataset.quizAnswer = "true"; input.dataset.quizQuestion = String(index);
      label.append(input, document.createTextNode(option)); fieldset.append(label);
    });
    const explanation = document.createElement("p"); explanation.id = `${explanationPrefix}-${index}`;
    explanation.className = "quiz-explanation"; explanation.dataset.quizExplanation = "true";
    fieldset.append(explanation); container.append(fieldset);
  });
}

export function gradeAnswers(questionSet, answers) {
  return questionSet.map((question, index) => ({ correct: answers[index] === question.answer, explanation: question.explanation }));
}

export function sqliLearningComplete(state) {
  return Boolean(state.normalObserved && state.educationResponse && state.comparisonDone && state.codeViewed && state.quizPassed);
}

export function gradeQuiz(answers) {
  return gradeAnswers(questions, answers);
}
export function isNormalComparison(discovered, record, userId) {
  return Boolean(discovered && userId === "user-a" && record.method === "GET"
    && record.path === `/api/posts/${discovered.data.post.id}` && record.status === 403
    && record.data?.error === "FORBIDDEN" && !Object.hasOwn(record.data, "post"));
}
export function learningComplete(state) {
  return Boolean(state.attackSucceeded && state.comparisonDone && state.quizPassed);
}
export function analyzeDiscovery(baseline, record, userId) {
  if (!isIdorDiscovery(baseline, record, userId)) return undefined;
  return { userId, requestedId: record.path.split("/").at(-1), ownerId: record.data.post.ownerId,
    visibility: record.data.post.visibility, status: record.status };
}
