import { requestPost, requestText, publishCommunityPost, publishCommunitySession } from "./http-client.js";
const integratedGuide = document.body.dataset.guide === "idor" && document.querySelector("#integrated-idor");
const lessonReady = integratedGuide
  ? import("./lab.js").then(({ initIdorLesson }) => initIdorLesson(integratedGuide, true))
  : Promise.resolve();
let navigationVersion = 0;
function communityPath(path) {
  const guide = document.body.dataset.guide;
  return ["idor", "sqli"].includes(guide) ? `${path}?lab=${guide}` : path;
}
function notify(text) { document.querySelector("#message").textContent = text; }
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", redirect: "error", ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "요청을 처리하지 못했습니다.");
  return data;
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}
function bindForms() {
const login = document.querySelector("#login-form");
login?.addEventListener("submit", async event => {
  event.preventDefault();
  const button = login.querySelector("button");
  button.disabled = true;
  notify("");
  try {
    const fields = new FormData(login);
    await api("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: fields.get("userId"), password: fields.get("password") }) });
    publishCommunitySession();
    if (integratedGuide) await navigateCommunity(communityPath("/posts"));
    else location.assign(communityPath("/posts"));
  } catch (error) { notify(error instanceof Error ? error.message : "로그인에 실패했습니다."); }
  finally { login.elements.password.value = ""; button.disabled = false; }
});
document.querySelector("#logout")?.addEventListener("click", async event => {
  event.currentTarget.disabled = true;
  try {
    await api("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    publishCommunitySession();
    if (integratedGuide) await navigateCommunity(communityPath("/posts"));
    else location.assign(communityPath("/posts"));
  } catch { notify("로그아웃하지 못했습니다. 다시 시도해주세요."); document.querySelector("#logout").disabled = false; }
});
bindSearch();
}
async function load(version = navigationVersion) {
  if (document.body.dataset.page === "posts") {
    const list = document.querySelector("#posts");
    try {
      const { posts } = await api("/api/posts");
      if (version !== navigationVersion) return;
      list.replaceChildren();
      for (const post of posts) {
        const link = element("a", "", "post-row");
        link.href = communityPath(`/posts/${post.id}`);
        link.append(element("span", post.visibility === "private" ? "비공개" : "공개", "badge"), element("h3", post.title), element("small", `작성자 ${post.ownerId}`));
        list.append(link);
      }
      if (!posts.length) list.append(element("p", "표시할 게시글이 없습니다."));
    } catch (error) { list.replaceChildren(element("p", error instanceof Error ? error.message : "게시글을 불러오지 못했습니다.")); }
    finally { list.setAttribute("aria-busy", "false"); }
  }
  if (document.body.dataset.page === "post") {
    const article = document.querySelector("#post");
    try {
      const record = await requestPost(document.body.dataset.postId);
      if (version !== navigationVersion) return;
      publishCommunityPost(record);
      const observed = document.querySelector("#observed-request");
      if (observed && !integratedGuide) observed.textContent = requestText(record);
      if (record.status !== 200) throw new Error(record.data?.message || "조회에 실패했습니다.");
      const { post } = record.data;
      article.replaceChildren(element("span", post.visibility === "private" ? "비공개" : "공개", "badge"), element("h1", post.title), element("p", `작성자 ${post.ownerId}`, "meta"), element("div", post.body, "post-body"));
    } catch (error) { article.replaceChildren(element("h1", "게시글을 열 수 없어요"), element("p", error instanceof Error ? error.message : "조회에 실패했습니다.")); }
    finally { article.setAttribute("aria-busy", "false"); }
  }
}
void lessonReady.then(() => { bindForms(); return load(); }).catch(() => notify("학습 화면을 준비하지 못했습니다. 새로고침해주세요."));

function bindSearch() {
const searchForm = document.querySelector("#search-form");
searchForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const button = searchForm.querySelector("button");
  const status = document.querySelector("#search-status");
  const results = document.querySelector("#search-results");
  button.disabled = true;
  status.textContent = "게시글을 검색하고 있습니다…";
  results.replaceChildren();
  try {
    const query = new URLSearchParams({ q: new FormData(searchForm).get("q") || "" });
    const { posts } = await api(`/api/search?${query}`);
    for (const post of posts) {
      const article = element("article", "", "post-row");
      article.append(element("span", "공개", "badge"), element("h3", post.title), element("p", post.body));
      results.append(article);
    }
    status.textContent = `검색 결과 ${posts.length}개`;
  } catch (error) { status.textContent = error instanceof Error ? error.message : "검색하지 못했습니다."; }
  finally { button.disabled = false; }
});
}

/** Replace only community surfaces. The guide DOM and its in-memory lesson stay mounted. */
export async function navigateCommunity(path, push = true) {
  const url = new URL(path, location.origin);
  if (url.origin !== location.origin || !/^\/(?:posts(?:\/\d{1,12})?|login)?$/.test(url.pathname) || url.searchParams.get("lab") !== "idor") return;
  const version = ++navigationVersion;
  try {
    await lessonReady;
    const response = await fetch(url.href, { cache: "no-store", credentials: "same-origin", redirect: "error" });
    if (!response.ok) throw new Error("페이지를 불러오지 못했습니다.");
    const parsed = new DOMParser().parseFromString(await response.text(), "text/html");
    if (version !== navigationVersion) return;
    const main = parsed.querySelector("main");
    const header = parsed.querySelector(".topbar");
    if (!main || !header || !parsed.querySelector("#integrated-idor")) throw new Error("페이지 구성을 확인하지 못했습니다.");
    document.querySelector("main").replaceWith(document.importNode(main, true));
    document.querySelector(".topbar").replaceWith(document.importNode(header, true));
    document.body.dataset.page = parsed.body.dataset.page;
    document.body.dataset.postId = parsed.body.dataset.postId || "";
    if (push) history.pushState(null, "", url.href);
    bindForms();
    await load(version);
  } catch (error) { if (version === navigationVersion) notify(error instanceof Error ? error.message : "페이지 이동에 실패했습니다."); }
}
if (integratedGuide) {
  document.addEventListener("click", event => {
    const link = event.target.closest("a");
    if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target || link.hasAttribute("download")) return;
    const url = new URL(link.href, location.origin);
    if (url.origin !== location.origin || url.searchParams.get("lab") !== "idor" || !/^\/(?:posts(?:\/\d{1,12})?|login)?$/.test(url.pathname)) return;
    event.preventDefault();
    void navigateCommunity(url.href);
  });
  window.addEventListener("popstate", () => {
    const url = new URL(location.href);
    if (url.searchParams.get("lab") !== "idor" || !/^\/(?:posts(?:\/\d{1,12})?|login)?$/.test(url.pathname)) {
      location.reload();
    } else void navigateCommunity(location.href, false);
  });
}
