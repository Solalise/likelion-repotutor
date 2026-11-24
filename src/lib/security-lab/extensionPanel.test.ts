import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
type FakeNode = { value: string | number; textContent: string; hidden: boolean; disabled: boolean; children: FakeNode[]; dataset: Record<string, string>; handlers: Record<string, (event?: unknown) => unknown>; addEventListener: (type: string, fn: (event?: unknown) => unknown) => void; replaceChildren: (...nodes: unknown[]) => void; append: (node: unknown) => void; setAttribute: (key: string, value: string) => void; focus: () => void };
function panel() {
  const elements = new Map<string, FakeNode>();
  const node = (): FakeNode => { const value: FakeNode = { value: "", textContent: "", hidden: false, disabled: false, children: [], dataset: {}, handlers: {}, setAttribute: vi.fn(), focus: vi.fn(), addEventListener: (type, fn) => { value.handlers[type] = fn; }, replaceChildren: (...nodes) => { value.children = nodes as FakeNode[]; }, append: child => value.children.push(child as FakeNode) }; return value; };
  const get = (id: string) => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id)!; };
  let receive: (message: unknown) => void = () => {};
  const postMessage = vi.fn(), clipboard = vi.fn().mockResolvedValue(undefined), scroll = vi.fn();
  runInNewContext(readFileSync("extensions/vulnlab/panel.js", "utf8"), { document: { getElementById: get, createElement: node }, navigator: { clipboard: { writeText: clipboard } }, window: { addEventListener: vi.fn(), scrollTo: scroll }, setInterval: vi.fn(), clearInterval: vi.fn(), chrome: { runtime: { connect: () => ({ postMessage, onMessage: { addListener: (fn: typeof receive) => { receive = fn; } }, onDisconnect: { addListener: vi.fn() } }) } } });
  return { get, receive: (message: unknown) => receive(message), postMessage, clipboard, scroll };
}
const kinds = ["SQL_INJECTION", "XSS", "IDOR", "AUTHORIZATION"];
function makeSession(commit = "a".repeat(40), current: string[] = [], previous: { commit: string; environmentVersion: number; count: number }[] = []) {
  return { id: commit, commit, project: "org/app", site: "https://sandbox.example.org", recordProgress: { current, previous, loaded: true, limited: false, error: "" }, guideBundle: { origin: "fallback", reason: "mock", guides: kinds.map(kind => ({ kind, applicability: "review", summary: "scope", features: [{ id: "feature", label: "문의 게시판", roles: ["input", "output"], sourceIds: ["s1"], relations: [], limitations: [] }], sources: [{ id: "s1", location: "src/view.tsx:9", code: "textContent", reason: "static" }], steps: ["read", "compare"].map(id => ({ id, action: `${id} action`, featureId: "feature", feature: "문의 게시판", explanation: "guide", expected: "Text", observe: "Compare", sourceIds: ["s1"] })) })) } };
}
function choose(get: ReturnType<typeof panel>["get"], result: string, method: string) {
  get("step-result").value = result; get("step-result").handlers.change(); get("step-method").value = method; get("step-method").handlers.change();
}
it("keeps persisted records across drafts and versions without inheriting previous analysis results", () => {
  const { get, receive, postMessage } = panel();
  receive({ type: "SESSION", session: makeSession() }); expect(get("kind").children).toHaveLength(4);
  get("notes").value = "draft"; get("notes").handlers.input(); get("kind").children[1].handlers.click(); get("kind").children[0].handlers.click(); expect(get("notes").value).toBe("draft");
  choose(get, "EXPECTED", "code-review"); get("next").handlers.click();
  expect(get("outcome").value).toBe("INCONCLUSIVE"); choose(get, "EXPECTED", "code-review"); expect(get("outcome").value).toBe("NOT_OBSERVED");
  get("record").handlers.submit({ preventDefault: () => {} }); expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "SAVE", kind: "SQL_INJECTION" }));
  expect(get("overall").textContent).toContain("0/4");
  receive({ type: "SAVED", sessionId: "a".repeat(40), kind: "SQL_INJECTION" }); expect(get("overall").textContent).toContain("1/4");
  get("notes").handlers.input(); expect(get("overall").textContent).toContain("1/4"); expect(get("overall").textContent).toContain("저장 전 변경");
  receive({ type: "SESSION", session: makeSession("b".repeat(40), [], [{ commit: "a".repeat(40), environmentVersion: 7, count: 1 }]) });
  expect(get("overall").textContent).toContain("0/4"); expect(get("record-history").textContent).toContain("aaaaaaaa"); expect(get("record-history").textContent).toContain("1/4 (현재 버전에 합산하지 않음)");
  receive({ type: "SESSION", session: makeSession("a".repeat(40), ["SQL_INJECTION"]) }); expect(get("overall").textContent).toContain("1/4");
  const unavailable = makeSession(); unavailable.recordProgress.loaded = false; unavailable.recordProgress.error = "기존 기록 조회 실패 · DB 기록 유지";
  receive({ type: "SESSION", session: unavailable }); expect(get("overall").textContent).toContain("DB 기록 유지"); expect(get("overall-progress").hidden).toBe(true);
});
it("uses purpose-specific choices, separates preparation from final judgment, and copies harmless XSS samples", async () => {
  const { get, receive, postMessage, clipboard, scroll } = panel();
  const session = makeSession(), xss = session.guideBundle.guides[1];
  xss.steps = ["text-prepare", "map-overview", "map-input", "map-output", "text-observe"].map(id => ({ ...xss.steps[0], id }));
  Object.assign(xss.steps[0], { preparation: "승인된 격리 환경과 합성 데이터" });
  receive({ type: "SESSION", session }); get("kind").children[1].handlers.click();
  expect(get("step-result").children.map(option => option.value)).toEqual(["UNREVIEWED", "READY", "NOT_READY", "UNKNOWN"]);
  expect(get("xss-samples").hidden).toBe(false); await get("copy-html").handlers.click(); expect(clipboard).toHaveBeenCalledExactlyOnceWith("<b>VulnLab 메모</b>");
  choose(get, "READY", "manual-check"); expect(get("outcome").value).toBe("INCONCLUSIVE");
  get("next").handlers.click(); expect(get("preparation-title").hidden).toBe(true); expect(get("step-result").children.map(option => option.value)).toContain("LOCATED");
  for (let i = 0; i < 3; i++) { choose(get, "LOCATED", "manual-check"); get("next").handlers.click(); }
  expect(get("step-result").children.map(option => option.value)).toContain("EXPECTED"); expect(get("step-result").children.map(option => option.value)).not.toContain("READY");
  choose(get, "EXPECTED", "approved-test"); expect(get("outcome").value).toBe("NOT_OBSERVED");
  expect(get("record-preview").textContent).toContain("준비 조건 확인");
  for (let i = 0; i < 4; i++) get("previous").handlers.click(); choose(get, "NOT_READY", "manual-check");
  for (let i = 0; i < 4; i++) get("next").handlers.click(); expect(get("outcome").value).toBe("INCONCLUSIVE");
  get("record").handlers.submit({ preventDefault: () => {} }); expect(postMessage.mock.calls.at(-1)![0].review.outcome).toBe("INCONCLUSIVE");
  expect(scroll).toHaveBeenCalled(); clipboard.mockRejectedValueOnce(new Error()); await get("copy-plain").handlers.click(); expect(get("copy-status").textContent).toContain("직접 선택해 복사");
});
