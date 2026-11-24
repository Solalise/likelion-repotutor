/* global chrome */
const element = id => document.getElementById(id);
const port = chrome.runtime.connect({ name: "vulnlab-panel" });
let session = null, kind = "SQL_INJECTION", step = 0, pending = null;
const drafts = {}, positions = {}, observations = {}, completed = new Set(), dirty = new Set();
const stepLabels = { UNREVIEWED: "아직 확인하지 않음", EXPECTED: "기대 동작과 일치", UNEXPECTED: "다른 동작·문제 의심", UNKNOWN: "판정 불가", NOT_APPLICABLE: "해당 없음 근거 확인" };
const outcomes = { UNSET: "선택하세요", OBSERVED: "문제 동작을 관찰함", NOT_OBSERVED: "확인 범위에서 기대 동작과 일치함", INCONCLUSIVE: "판정할 수 없음", NOT_APPLICABLE: "해당 기능을 사용하지 않음" };
const labels = { SQL_INJECTION: "SQL Injection", XSS: "XSS", IDOR: "IDOR", AUTHORIZATION: "권한 검증" };
const applicabilityLabels = { review: "관련 코드 검토", "not-applicable": "해당 없음 검토", unsupported: "분석 미지원", inconclusive: "판정 불가" };
const evidenceLabels = { "code-review": "소스코드를 직접 확인함", "approved-test": "승인된 격리 환경의 합성 테스트 결과를 확인함", unconfirmed: "근거를 충분히 확인하지 못함" };
Object.assign(stepLabels, { READY: "준비 조건 확인", NOT_READY: "미준비로 실행하지 않음", LOCATED: "기능 위치 확인", MISMATCH: "화면·설명 불일치", POLICY_CONFIRMED: "정책·소유 관계 확인" });
evidenceLabels["manual-check"] = "준비 상태·화면·정책 직접 확인";
function purpose(current) {
  if (current.id.endsWith("-prepare")) return "preparation";
  if (/-(?:overview|input|output)$/.test(current.id)) return "location";
  if (/-(?:object-scope|server-guard)$/.test(current.id)) return "policy";
  return current.id === "scope" ? "scope" : "observation";
}
function resultOptions(current) {
  const type = purpose(current);
  if (type === "preparation") return { UNREVIEWED: "아직 준비를 확인하지 않음", READY: "격리 환경·합성 데이터 준비 확인", NOT_READY: "준비되지 않아 실행하지 않음", UNKNOWN: "승인·격리 여부 미확인" };
  if (type === "location") return { UNREVIEWED: "아직 위치를 확인하지 않음", LOCATED: "기능·화면 위치 확인", MISMATCH: "안내와 실제 화면이 다름", UNKNOWN: "연결 위치를 확인하지 못함" };
  if (type === "policy") return { UNREVIEWED: "아직 정책을 확인하지 않음", POLICY_CONFIRMED: "소유 관계·역할 정책 확인", UNKNOWN: "정책이나 소유 관계 미확인", NOT_APPLICABLE: "해당 없음의 근거 확인" };
  if (type === "scope") return { UNREVIEWED: "아직 적용 여부를 확인하지 않음", NOT_APPLICABLE: "해당 기술·기능 미사용 근거 확인", UNKNOWN: "근거 부족으로 판정 불가" };
  return { UNREVIEWED: "아직 결과를 관찰하지 않음", EXPECTED: "관찰 범위에서 기대 동작과 일치", UNEXPECTED: "다른 동작·문제 의심 관찰", UNKNOWN: "결과를 판정할 수 없음", NOT_APPLICABLE: "해당 없음의 근거 확인" };
}
function populate(id, options, selected) {
  element(id).replaceChildren(...Object.entries(options).map(([value, label]) => { const option = document.createElement("option"); option.value = value; option.textContent = label; return option; }));
  element(id).value = Object.hasOwn(options, selected) ? selected : Object.keys(options)[0];
}
const fields = ["outcome", "expected", "observed", "evidence", "notes", "codeLocation"];
const text = (id, value) => { element(id).textContent = value; };
for (const [id, value] of Object.entries({ "step-title": "정상적으로 기대되는 동작", "observe-title": "관찰 방법", "source-label": "관련 코드와 분석 근거", "record-title": "수동 관찰 기록", "outcome-label": "확인한 결과", "evidence-label": "확인 방법", "notes-label": "메모 추가 (선택)", save: "수동 기록 저장", "scope-label": "분석 범위·가이드 생성 정보", "open-site": "등록 사이트 열기 (일반 탐색)", previous: "이전", next: "다음", footer: "교육·수동 기록은 실제 검증 완료나 실행 승인이 아닙니다. 능동적 테스트는 승인된 격리 환경·합성 데이터로 제한됩니다. 로그인된 VulnLab 탭을 열어 두세요." })) text(id, value);
for (const option of element("outcome").children) option.textContent = outcomes[option.value];
for (const option of element("evidence").children) option.textContent = evidenceLabels[option.value];
text("outcome-label", "단계별 선택의 집계 결과 (자동 반영)");
text("source-label", "안내의 근거와 관련 코드 설명 보기");
element("previous").disabled = true; element("next").disabled = true;
element("progress").setAttribute("aria-label", "현재 유형 단계 진행률"); element("overall-progress").setAttribute("aria-label", "전체 유형 수동 기록 저장률");
const heartbeat = setInterval(() => { try { port.postMessage({ type: "PING" }); } catch { clearInterval(heartbeat); } }, 20000);
window.addEventListener("pagehide", () => clearInterval(heartbeat));
function guide() { return session.guideBundle.guides.find(g => g.kind === kind); }
function saving(value) {
  element("save").disabled = value; element("record-fields").disabled = value; element("open-site").disabled = value || !session?.site;
  for (const tab of element("kind").children) tab.disabled = value;
  element("step-result").disabled = value; element("step-method").disabled = value;
}
function remember() { if (session) drafts[kind] = Object.fromEntries(fields.map(id => [id, element(id).value])); }
function loadDraft() {
  const g = guide(); const draft = drafts[kind] ?? { outcome: "UNSET", evidence: "code-review", expected: g.steps.map(s => s.expected).join(" ").slice(0, 1000), codeLocation: g.sources.map(s => s.location).join("\n").slice(0, 1000) };
  for (const id of fields) element(id).value = draft[id] ?? "";
}
function stepSummary() {
  const steps = guide().steps, selected = observations[kind] ?? {};
  const choices = steps.map(s => selected[s.id] ?? { result: "UNREVIEWED", method: "unconfirmed" });
  const unconfirmed = choices.some(c => ["UNREVIEWED", "UNKNOWN", "NOT_READY", "MISMATCH"].includes(c.result) || c.method === "unconfirmed");
  const observed = choices.filter((_c, i) => purpose(steps[i]) === "observation");
  const outcome = unconfirmed ? "INCONCLUSIVE" : observed.some(c => c.result === "UNEXPECTED") ? "OBSERVED" : choices.every(c => c.result === "NOT_APPLICABLE") || observed.length && observed.every(c => c.result === "NOT_APPLICABLE") ? "NOT_APPLICABLE" : observed.length && observed.every(c => c.result === "EXPECTED" || c.result === "NOT_APPLICABLE") ? "NOT_OBSERVED" : "INCONCLUSIVE";
  const lines = steps.map((s, i) => `${i + 1}. ${s.action} — ${stepLabels[choices[i].result]} (${evidenceLabels[choices[i].method]})`);
  return { outcome, observed: lines.join("\n").slice(0, 2000), evidence: choices.map((c, i) => `${i + 1}: ${stepLabels[c.result]} · ${evidenceLabels[c.method]}`).join("\n").slice(0, 800), anySelection: choices.some(c => c.result !== "UNREVIEWED") };
}
function render() {
  const g = guide(), current = g.steps[step];
  text("step-count", `${labels[kind]} · 현재 ${step + 1}/${g.steps.length} 단계`);
  text("action", current.action); text("explanation", current.explanation); text("expected-behavior", current.expected); text("observe", current.observe);
  text("feature-target", `검토 대상: ${current.feature ?? "기능 연결 미확인"}`); text("preparation", current.preparation ?? "");
  element("preparation").hidden = !current.preparation; element("preparation-title").hidden = !current.preparation;
  const selection = observations[kind]?.[current.id] ?? { result: "UNREVIEWED", method: "unconfirmed" };
  populate("step-result", resultOptions(current), selection.result);
  const methods = { unconfirmed: evidenceLabels.unconfirmed, ...(purpose(current) !== "observation" ? { "manual-check": evidenceLabels["manual-check"] } : {}), "code-review": evidenceLabels["code-review"], "approved-test": evidenceLabels["approved-test"] };
  populate("step-method", methods, selection.method);
  const interpretationKey = ["EXPECTED", "READY", "LOCATED", "POLICY_CONFIRMED"].includes(selection.result) ? "expected" : ["UNEXPECTED", "NOT_READY", "MISMATCH"].includes(selection.result) ? "unexpected" : "unknown";
  text("interpretation", current.interpretation?.[interpretationKey] ?? "확인한 범위만 기록하고 미확인은 판정 불가로 남기세요.");
  const summary = stepSummary(); element("outcome").value = summary.outcome; element("outcome").disabled = true;
  element("observed").value = summary.observed; text("record-preview", `${outcomes[summary.outcome]}\n${summary.observed}`);
  element("progress").value = Math.round((step + 1) / g.steps.length * 100);
  const progress = session.recordProgress;
  text("overall", progress && !progress.loaded && !completed.size ? progress.error || "기존 수동 기록을 확인하는 중입니다." : `현재 버전 ${session.commit?.slice(0, 8) ?? ""} 수동 기록 ${completed.size}/4 · ${completed.size * 25}%${dirty.has(kind) ? " · 현재 유형에 저장 전 변경 있음" : ""}`);
  element("overall-progress").value = completed.size * 25;
  element("overall-progress").hidden = Boolean(progress && !progress.loaded && !completed.size);
  const previous = progress?.previous ?? [];
  element("previous-records").hidden = !previous.length && !progress?.limited;
  text("record-history", previous.map(p => `커밋 ${p.commit.slice(0, 8)} · 환경 버전 ${p.environmentVersion} · ${p.count}/4 (현재 버전에 합산하지 않음)`).join("\n") + (progress?.limited ? "\n최근 1,000개 범위만 조회했습니다. 나머지 기록도 DB에 유지됩니다." : ""));
  text("guide-state", applicabilityLabels[g.applicability]);
  element("previous").disabled = step === 0; element("next").disabled = step === g.steps.length - 1;
  element("record").hidden = step !== g.steps.length - 1;
  text("scope", g.summary);
  text("guide-origin", session.guideBundle.origin === "ai" ? `AI 근거 검증 가이드${session.guideBundle.cached ? " · 캐시 재사용" : ""}` : `기본 가이드 · ${session.guideBundle.reason ?? "AI 가이드를 사용할 수 없습니다."}`);
  const source = element("source"); source.replaceChildren();
  const add = (tag, value) => { const node = document.createElement(tag); node.textContent = value; source.append(node); };
  for (const item of g.sources.filter(s => current.sourceIds.includes(s.id))) { add("h3", item.location); add("pre", item.code); add("p", item.reason); }
  const feature = g.features?.find(f => f.id === current.featureId);
  element("xss-samples").hidden = !(kind === "XSS" && feature?.roles.includes("input") && feature.roles.includes("output") && ["preparation", "observation"].includes(purpose(current)));
  if (feature) { for (const relation of feature.relations.slice(0, 8)) add("p", `${relation.status === "confirmed" ? "정적 관계 확인" : "미확정 관계"}: ${relation.description}`); for (const limit of feature.limitations) add("p", limit); }
  if (!source.children.length) add("p", "이 단계에 연결된 코드 근거가 없습니다. 기능이나 경로를 추정하지 마세요.");
  for (const tab of element("kind").children) { tab.setAttribute("aria-selected", String(tab.dataset.kind === kind)); tab.tabIndex = tab.dataset.kind === kind ? 0 : -1; }
}
function move(next) { remember(); step = next; positions[kind] = step; element("source-details").open = false; render(); window.scrollTo({ top: 0, behavior: "instant" }); }
function switchKind(next) { if (pending) return; remember(); positions[kind] = step; kind = next; step = positions[kind] ?? 0; loadDraft(); move(step); }
port.onMessage.addListener(message => {
  if (message.type === "DISCONNECTED") { session = null; pending = null; element("previous").disabled = true; element("next").disabled = true; element("workspace").hidden = true; text("context", "미연결"); text("status", "VulnLab 분석 화면에서 다시 연결하세요."); for (const key of Object.keys(drafts)) delete drafts[key]; for (const key of Object.keys(positions)) delete positions[key]; for (const key of Object.keys(observations)) delete observations[key]; completed.clear(); return; }
  if (message.type === "SESSION") {
    if (!message.session.guideBundle?.guides?.every(g => g.steps?.length)) { text("status", "가이드 형식이 변경되었습니다. VulnLab 페이지와 확장을 새로고침한 뒤 다시 연결하세요."); return; }
    const same = session?.id === message.session.id; session = message.session;
    if (!same) { for (const key of Object.keys(drafts)) delete drafts[key]; for (const key of Object.keys(positions)) delete positions[key]; for (const key of Object.keys(observations)) delete observations[key]; dirty.clear(); kind = "SQL_INJECTION"; step = 0; }
    completed.clear(); for (const savedKind of session.recordProgress?.current ?? []) if (Object.hasOwn(labels, savedKind)) completed.add(savedKind);
    pending = null; text("project", session.project); text("context", "연결됨");
    element("kind").replaceChildren(...session.guideBundle.guides.map(g => {
      const tab = document.createElement("button"); tab.type = "button"; tab.textContent = labels[g.kind]; tab.dataset.kind = g.kind; tab.setAttribute("role", "tab");
      tab.addEventListener("click", () => switchKind(g.kind));
      tab.addEventListener("keydown", event => { if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return; event.preventDefault(); const kinds = Object.keys(labels), index = kinds.indexOf(kind); const next = kinds[(index + (event.key === "ArrowRight" ? 1 : 3)) % 4]; switchKind(next); [...element("kind").children].find(t => t.dataset.kind === next)?.focus(); });
      return tab;
    }));
    saving(false); element("workspace").hidden = false;
    text("status", session.guideBundle.origin === "fallback" ? `기본 가이드 사용 · ${session.guideBundle.reason}` : "프로젝트별 가이드 준비 완료"); loadDraft(); render();
  }
  if (!session || message.sessionId !== session.id) return;
  if (message.type === "SAVED" && pending === message.kind) { completed.add(message.kind); dirty.delete(message.kind); pending = null; saving(false); text("status", "DB에 수동 기록 저장 완료 · 실제 보안 검증 완료가 아닙니다."); render(); }
  if (message.type === "ERROR") { pending = null; saving(false); text("status", message.message); }
});
port.onDisconnect.addListener(() => { clearInterval(heartbeat); void chrome.runtime.lastError; element("workspace").hidden = true; text("context", "미연결"); text("status", "연결이 종료되었습니다. 패널을 닫고 다시 연결하세요."); });
element("previous").addEventListener("click", () => { if (session && step > 0) move(step - 1); });
element("next").addEventListener("click", () => { if (session && step < guide().steps.length - 1) move(step + 1); });
element("open-site").addEventListener("click", () => { if (session?.site) port.postMessage({ type: "OPEN_SITE" }); });
for (const id of fields) element(id).addEventListener("input", () => { dirty.add(kind); remember(); render(); });
for (const id of ["step-result", "step-method"]) element(id).addEventListener("change", () => {
  if (!session || pending) return;
  observations[kind] ??= {};
  observations[kind][guide().steps[step].id] = { result: element("step-result").value, method: element("step-method").value };
  dirty.add(kind); render();
});
for (const [button, value] of [["copy-plain", "VulnLab 메모"], ["copy-html", "<b>VulnLab 메모</b>"]]) element(button).addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(value); text("copy-status", "문구를 복사했습니다. 승인된 격리 환경에서만 사용하세요."); }
  catch { text("copy-status", "복사하지 못했습니다. 위 문구를 직접 선택해 복사하세요."); }
});
element("record").addEventListener("submit", event => {
  event.preventDefault(); if (!session || pending) return;
  const summary = stepSummary();
  if (!summary.anySelection) { text("status", "각 단계에서 직접 확인한 결과를 하나 이상 선택하세요. 미확인 결과는 자동 작성하지 않습니다."); return; }
  element("outcome").value = summary.outcome; element("observed").value = summary.observed;
  if (summary.outcome === "NOT_APPLICABLE" && !element("notes").value.trim()) element("notes").value = `각 단계에서 사용자가 해당 없음 근거를 확인한 것으로 기록함. 확인 범위: ${guide().summary}`.slice(0, 800);
  remember(); const review = { ...drafts[kind], evidence: summary.evidence, completed: true };
  pending = kind; saving(true); text("status", "DB 저장을 확인하고 있습니다…"); port.postMessage({ type: "SAVE", kind, review });
});
