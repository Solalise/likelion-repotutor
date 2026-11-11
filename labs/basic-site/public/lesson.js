import { isIdorDiscovery } from "./http-client.js";

export const questions = [
  { prompt: "게시글 ID를 알고 있으면 비공개 글을 읽어도 될까요?", options: ["ID를 알면 권한도 있다", "ID와 읽기 권한은 별개다"], answer: "1", explanation: "ID는 글을 찾는 번호입니다. 읽기 권한은 서버가 로그인한 사용자와 글의 공개 범위·소유자를 확인해 결정합니다." },
  { prompt: "HTTP 200만으로 IDOR라고 판단할 수 있을까요?", options: ["아니다. 타인의 비공개 본문이 반환됐는지 확인해야 한다", "그렇다. 모든 200은 IDOR다"], answer: "0", explanation: "공개 글이나 자신의 글도 200입니다. 로그인 사용자·요청 ID·소유자·공개 여부·본문을 함께 확인해야 합니다." },
  { prompt: "권한 검사는 어디에서 해야 할까요?", options: ["화면에서 버튼만 숨긴다", "서버에서 매 조회 요청마다 검사한다"], answer: "1", explanation: "화면을 거치지 않고 HTTP 요청을 직접 보낼 수 있습니다. 서버가 canReadPost()로 읽기 권한을 확인하고 거부해야 합니다." },
];

export function gradeQuiz(answers) {
  return questions.map((question, index) => ({ correct: answers[index] === question.answer, explanation: question.explanation }));
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
