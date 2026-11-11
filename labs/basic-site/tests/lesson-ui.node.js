import assert from "node:assert/strict";
import { test } from "node:test";
import { createBasicSite } from "../src/server.ts";
import { page } from "../src/pages.ts";

// Minimal DOM contract harness: exercise the actual event handlers against real HTTP.
// This does not verify layout, browser focus or native form validation.
class Element {
  constructor(tag = "div") { this.tag = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {}; this.textContent = ""; this.hidden = false; this.value = ""; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  reset() {}
  async fire(type) { await this.listeners[type]?.({ preventDefault() {}, currentTarget: this }); }
}

test("community detail loads without a request inspector and search feedback contains no lab labels", async () => {
  const site = await createBasicSite({ port: 0, enableIdorLab: false, enableSqliLab: false });
  const original = { document: globalThis.document, location: globalThis.location, fetch: globalThis.fetch, FormData: globalThis.FormData };
  const waitFor = async predicate => {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail("community UI did not finish its HTTP request");
  };
  try {
    globalThis.location = { origin: site.url };
    globalThis.fetch = (input, options) => original.fetch(typeof input === "string" ? new URL(input, site.url) : input, options);
    const article = new Element();
    const nodes = new Map([["#post", article], ["#message", new Element()]]);
    globalThis.document = { body: { dataset: { page: "post", postId: "201" } }, querySelector: selector => nodes.get(selector), createElement: tag => new Element(tag) };
    await import("../public/app.js?community-detail");
    await waitFor(() => article.attributes["aria-busy"] === "false");
    assert.equal(article.children[1].tag, "h1");
    assert.equal(article.children[1].textContent.includes("열 수 없어요"), false);
    assert.ok(article.children.some(child => child.className === "post-body"));

    const form = new Element("form");
    const button = new Element("button");
    form.querySelector = () => button;
    nodes.set("#search-form", form);
    nodes.set("#search-status", new Element());
    nodes.set("#search-results", new Element());
    globalThis.document.body.dataset = { page: "login" };
    globalThis.FormData = class { get() { return "산책"; } };
    await import("../public/app.js?community-search");
    const pending = form.fire("submit");
    assert.equal(nodes.get("#search-status").textContent, "게시글을 검색하고 있습니다…");
    await pending;
    assert.equal(nodes.get("#search-status").textContent, "검색 결과 1개");
    assert.equal(nodes.get("#search-results").children.length, 1);
    assert.equal(button.disabled, false);
  } finally {
    Object.assign(globalThis, original);
    await site.close();
  }
});

test("integrated community navigation feeds real requests and preserves the full lesson through completion", async () => {
  const site = await createBasicSite({ port: 0, enableIdorLab: true });
  const names = ["document", "location", "fetch", "FormData", "DOMParser", "history", "window"];
  const original = Object.fromEntries(names.map(name => [name, globalThis[name]]));
  let dispose;
  try {
    const login = await fetch(`${site.url}/api/auth/login`, { method: "POST", headers: { Origin: site.url, "Content-Type": "application/json" }, body: JSON.stringify({ userId: "user-a", password: "practice-a" }) });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const html = await (await fetch(`${site.url}/?lab=idor`, { headers: { Cookie: cookie } })).text();
    const nodes = new Map();
    const all = [];
    for (const match of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
      const e = new Element(); e.hidden = match[0].includes(" hidden"); nodes.set(`#${match[1]}`, e);
    }
    const stages = Array.from({ length: 6 }, (_, i) => { const e = new Element("button"); e.dataset.stage = String(i + 1); return e; });
    const panels = [...html.matchAll(/data-stages="([^"]+)"/g)].map(match => { const e = new Element(); e.dataset.stages = match[1]; return e; });
    const find = selector => nodes.get(selector) || all.find(e => `#${e.id}` === selector);
    const root = { dataset: { enabled: "true" }, querySelector: find, querySelectorAll: selector => selector === "[data-stage]" ? stages : selector === "[data-stages]" ? panels : selector === "#lab-posts button" ? [] : all.filter(e => e.className === "quiz-explanation") };
    nodes.set("#integrated-idor", root);
    const disclosure = new Element("details"); disclosure.open = true;
    let currentMain;
    let currentHeader;
    let viewNodes = new Map();
    function parseView(source) {
      const maps = new Map();
      const mainHtml = source.match(/<main>([\s\S]*?)<\/main>/)[1];
      for (const match of mainHtml.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
        const e = new Element(); e.querySelector = () => new Element("button"); maps.set(`#${match[1]}`, e);
      }
      const main = new Element("main"); main.maps = maps;
      const header = new Element("header");
      main.replaceWith = next => { currentMain = next; viewNodes = next.maps; };
      header.replaceWith = next => { currentHeader = next; };
      return { body: { dataset: { guide: source.match(/data-guide="([^"]+)"/)?.[1], page: source.match(/data-page="([^"]+)"/)[1], postId: source.match(/data-post-id="([^"]+)"/)?.[1] } }, querySelector: selector => selector === "main" ? main : selector === ".topbar" ? header : selector === "#integrated-idor" ? root : maps.get(selector) };
    }
    const initial = parseView(html);
    currentMain = initial.querySelector("main"); currentHeader = initial.querySelector(".topbar"); viewNodes = currentMain.maps;
    const events = {};
    globalThis.document = {
      body: initial.body,
      querySelector: selector => selector === "main" ? currentMain : selector === ".topbar" ? currentHeader : selector === ".guide-panel" ? disclosure : viewNodes.get(selector) || find(selector),
      createElement: tag => { const e = new Element(tag); all.push(e); return e; }, createTextNode: text => ({ textContent: text }),
      importNode: node => node, addEventListener: (name, handler) => { events[name] = handler; },
    };
    globalThis.location = { origin: site.url, href: `${site.url}/?lab=idor` };
    globalThis.history = { pushState: (_, __, url) => { globalThis.location.href = url; } };
    globalThis.window = { addEventListener: (name, handler) => { events[name] = handler; } };
    globalThis.DOMParser = class { parseFromString(source) { return parseView(source); } };
    globalThis.FormData = class { get(name) { return ["1", "0", "1"][Number(name.slice(1))]; } };
    const sent = [];
    globalThis.fetch = (input, options) => {
      const url = typeof input === "string" ? new URL(input, site.url) : new URL(input.url);
      sent.push(url.pathname);
      return original.fetch(typeof input === "string" ? url : input, { ...options, headers: { Cookie: cookie } });
    };
    const waitFor = async predicate => {
      for (let attempt = 0; attempt < 400; attempt++) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      assert.fail("integrated lesson did not reach expected state");
    };
    // Initialize the shared controller explicitly; app's dynamic import uses this same module.
    const { initIdorLesson } = await import("../public/lab.js");
    dispose = initIdorLesson(root, true);
    root.dataset.initialized = "true";
    const app = await import("../public/app.js?integrated-test");
    await waitFor(() => viewNodes.get("#posts")?.attributes["aria-busy"] === "false");
    assert.equal(find("#observed-request").textContent, "");
    await find("#lesson-start").fire("click");
    const ownLink = viewNodes.get("#posts").children[0];
    ownLink.hasAttribute = () => false;
    let intercepted = false;
    events.click({ target: { closest: () => ownLink }, button: 0, preventDefault() { intercepted = true; } });
    await waitFor(() => find("#edit-start").disabled === false);
    assert.equal(intercepted, true);
    assert.match(find("#observed-request").textContent, /GET .*\/api\/posts\/101/);
    assert.match(find("#observed-request").textContent, /HTTP 200/);
    assert.equal(sent.filter(path => path === "/api/posts/101").length, 1);
    await find("#edit-start").fire("click");
    const stage = () => stages.findIndex(e => e.attributes["aria-current"] === "step") + 1;
    await waitFor(() => stage() === 3 && find("#request-fields").disabled === false);
    assert.equal(sent.filter(path => path === "/api/posts/101").length, 1, "captured normal request is reused without a fake/redundant fetch");
    disclosure.open = false;
    await app.navigateCommunity("/posts?lab=idor");
    await app.navigateCommunity("/posts/201?lab=idor");
    assert.equal(document.querySelector(".guide-panel"), disclosure);
    assert.equal(disclosure.open, false);
    Object.assign(location, { href: `${site.url}/posts?lab=idor` });
    events.popstate();
    await waitFor(() => document.body.dataset.page === "posts" && viewNodes.get("#posts")?.attributes["aria-busy"] === "false");
    assert.equal(document.querySelector(".guide-panel"), disclosure);
    assert.equal(disclosure.open, false);
    disclosure.open = true;
    assert.equal(stage(), 3);
    assert.equal(document.querySelector("#integrated-idor"), root);
    find("#request-id").value = "102";
    await find("#request-form").fire("submit");
    await waitFor(() => stage() === 4 && find("#request-fields").disabled === false);
    assert.equal(find("#learning-complete").hidden, true);
    await app.navigateCommunity("/posts?lab=idor");
    assert.equal(stage(), 4);
    await find("#study-code").fire("click");
    await waitFor(() => find("#lesson-code").children.length === 6);
    await find("#compare-request").fire("click");
    await waitFor(() => find("#quiz-start").disabled === false);
    assert.match(find("#comparison-result").textContent, /HTTP 403/);
    await find("#quiz-start").fire("click");
    await find("#quiz-form").fire("submit");
    assert.equal(find("#learning-complete").hidden, false);
    await app.navigateCommunity("/posts/201?lab=idor");
    assert.equal(find("#learning-complete").hidden, false);
    const { publishCommunitySession } = await import("../public/http-client.js");
    publishCommunitySession();
    assert.equal(stage(), 1);
    assert.equal(find("#learning-complete").hidden, true);
  } finally {
    dispose?.(); Object.assign(globalThis, original); await site.close();
  }
});

test("actual lesson handlers traverse all stages, gate completion, retry and reset evidence", async () => {
  const site = await createBasicSite({ port: 0, enableIdorLab: true });
  const original = { document: globalThis.document, location: globalThis.location, fetch: globalThis.fetch, FormData: globalThis.FormData };
  const nodes = new Map();
  const stages = Array.from({ length: 6 }, (_, i) => { const e = new Element("button"); e.dataset.stage = String(i + 1); return e; });
  const panels = [];
  const all = [];
  const html = page("lab", { id: "user-a", name: "A", role: "user" }, undefined, true);
  for (const match of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const node = new Element(); node.hidden = match[0].includes(" hidden"); nodes.set(`#${match[1]}`, node);
  }
  for (const match of html.matchAll(/data-stages="([^"]+)"/g)) {
    const e = new Element(); e.dataset.stages = match[1]; panels.push(e);
  }
  const find = selector => nodes.get(selector) || all.find(e => `#${e.id}` === selector);
  let answers = ["0", "1", "0"];
  let disabledLab = false;
  let invalidComparison = false;
  try {
    const login = await fetch(`${site.url}/api/auth/login`, { method: "POST", headers: { Origin: site.url, "Content-Type": "application/json" }, body: JSON.stringify({ userId: "user-a", password: "practice-a" }) });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    globalThis.location = { origin: site.url };
    globalThis.document = {
      querySelector: find,
      querySelectorAll: selector => selector === "[data-stage]" ? stages : selector === "[data-stages]" ? panels : selector === "#lab-posts button" ? find("#lab-posts").children : all.filter(e => e.className === "quiz-explanation"),
      createElement: tag => { const e = new Element(tag); all.push(e); return e; },
      createTextNode: text => ({ textContent: text }),
    };
    globalThis.FormData = class { get(name) { return answers[Number(name.slice(1))]; } };
    globalThis.fetch = (input, options) => {
      const path = new URL(typeof input === "string" ? input : input.url, site.url).pathname;
      if (disabledLab && path.startsWith("/api/lab/vulnerable/")) return Promise.resolve(Response.json({ error: "NOT_FOUND" }, { status: 404 }));
      if (invalidComparison && path === "/api/posts/102") return Promise.resolve(Response.json({ error: "OTHER" }, { status: 403 }));
      return original.fetch(typeof input === "string" ? new URL(input, site.url) : input, { ...options, headers: { Cookie: cookie } });
    };
    const waitFor = async predicate => {
      for (let attempt = 0; attempt < 200; attempt++) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      assert.fail("lesson handler did not reach expected state");
    };
    const current = () => stages.findIndex(e => e.attributes["aria-current"] === "step") + 1;
    const { initIdorLesson } = await import("../public/lab.js");
    initIdorLesson(document);
    await waitFor(() => find("#lab-posts").children.length > 0);
    assert.equal(current(), 1);
    assert.equal(stages[5].disabled, true);
    assert.equal(find("#analysis-facts").children.length, 0);
    assert.ok(all.filter(e => e.className === "quiz-explanation").every(e => !e.textContent));
    await find("#quiz-form").fire("submit");
    assert.equal(find("#learning-complete").hidden, true);
    await find("#lesson-start").fire("click");
    assert.equal(current(), 2);
    await find("#lab-posts").children[0].fire("click");
    await waitFor(() => find("#request-fields").disabled === false);
    assert.match(find("#normal-result").textContent, /\/api\/posts\/101/);
    await find("#edit-start").fire("click");
    assert.equal(current(), 3);
    find("#request-id").value = "201";
    await find("#request-form").fire("submit");
    await waitFor(() => find("#request-fields").disabled === false);
    assert.equal(current(), 3, "public HTTP 200 is not discovery");
    find("#request-id").value = "102";
    await find("#request-form").fire("submit");
    await waitFor(() => current() === 4);
    assert.equal(find("#analysis-facts").children.length, 10);
    assert.match(find("#analysis-response").textContent, /HTTP 200/);
    assert.equal(find("#learning-complete").hidden, true);
    await find("#study-code").fire("click");
    assert.equal(current(), 5);
    await waitFor(() => find("#retry-code").disabled === false);
    assert.equal(find("#lesson-code").children.length, 6);
    invalidComparison = true;
    await find("#compare-request").fire("click");
    await waitFor(() => find("#compare-request").disabled === false);
    assert.equal(find("#quiz-start").disabled, true);
    assert.equal(stages[5].disabled, true);
    invalidComparison = false;
    await find("#compare-request").fire("click");
    await waitFor(() => find("#quiz-start").disabled === false);
    assert.match(find("#comparison-result").textContent, /HTTP 403/);
    await find("#quiz-start").fire("click");
    assert.equal(current(), 6);
    await find("#quiz-form").fire("submit");
    assert.equal(find("#learning-complete").hidden, true);
    assert.ok(find("#quiz-explanation-0").textContent.length > 0);
    answers = ["1", "0", "1"];
    await find("#quiz-form").fire("submit");
    assert.equal(find("#learning-complete").hidden, false);
    await find("#quiz-form").fire("change");
    assert.equal(find("#learning-complete").hidden, true);
    await stages[2].fire("click");
    find("#request-id").value = "201";
    await find("#request-form").fire("submit");
    await waitFor(() => find("#request-fields").disabled === false);
    assert.equal(find("#analysis-facts").children.length, 0);
    assert.equal(stages[5].disabled, true);
    assert.equal(find("#learning-complete").hidden, true);
    disabledLab = true;
    find("#request-id").value = "102";
    await find("#request-form").fire("submit");
    await waitFor(() => find("#request-fields").disabled === false);
    assert.equal(current(), 3);
    assert.match(find("#lab-feedback").textContent, /BASIC_SITE_ENABLE_IDOR=1/);
    assert.equal(find("#analysis-facts").children.length, 0);
    assert.equal(stages[5].disabled, true);
  } finally {
    Object.assign(globalThis, original);
    await site.close();
  }
});
