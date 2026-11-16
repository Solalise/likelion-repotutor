/** Only the two same-origin, GET-only post endpoints can be constructed. */
const postObservers = new Set();
const sessionObservers = new Set();
const searchObservers = new Set();
export function observeCommunityPost(listener) { postObservers.add(listener); return () => postObservers.delete(listener); }
export function publishCommunityPost(record) { for (const listener of postObservers) listener(record); }
export function observeCommunitySession(listener) { sessionObservers.add(listener); return () => sessionObservers.delete(listener); }
export function publishCommunitySession() { for (const listener of sessionObservers) listener(); }
export function observeCommunitySearch(listener) { searchObservers.add(listener); return () => searchObservers.delete(listener); }
export function publishCommunitySearch(record) { for (const listener of searchObservers) listener(record); }

export function postPath(id, mode = "normal") {
  if (!/^\d{1,12}$/.test(String(id))) throw new Error("게시글 ID는 1~12자리 숫자로 입력해주세요.");
  if (!["normal", "vulnerable"].includes(mode)) throw new Error("지원하지 않는 조회 방식입니다.");
  return `${mode === "vulnerable" ? "/api/lab/vulnerable/posts" : "/api/posts"}/${id}`;
}

/** Records the Request actually passed to fetch and its actual response, including errors. */
export async function requestPost(id, mode = "normal", fetcher = fetch, origin = location.origin) {
  const request = new Request(new URL(postPath(id, mode), origin), {
    method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
  });
  return recordRequest(request, fetcher);
}

/** Normal community search. The community always uses this endpoint. */
export async function requestSearch(query, fetcher = fetch, origin = location.origin) {
  return searchRequest(query, "/api/search", fetcher, origin);
}

/** Explicit guide action only; endpoint and HTTP method cannot be edited. */
export async function requestLabSearch(query, fetcher = fetch, origin = location.origin) {
  return searchRequest(query, "/api/lab/vulnerable/search", fetcher, origin);
}

async function searchRequest(query, path, fetcher, origin) {
  const url = new URL(path, origin);
  url.search = new URLSearchParams({ q: query }).toString();
  const request = new Request(url, { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error" });
  return { ...await recordRequest(request, fetcher), kind: "search", query: String(query) };
}

async function recordRequest(request, fetcher) {
  const response = await fetcher(request);
  const body = await response.text();
  let data;
  try { data = JSON.parse(body); } catch { /* The raw body remains visible. */ }
  return { method: request.method, url: request.url, path: new URL(request.url).pathname,
    status: response.status, body, data };
}

export function requestText(record) {
  return `${record.method} ${record.url}\n경로: ${record.path}${record.kind === "search" ? `\n검색어: ${record.query}` : ""}\nHTTP ${record.status}\n\n${record.body}`;
}

export function isOwnBaseline(record, userId) {
  const post = record.data?.post;
  return userId === "user-a" && record.status === 200 && record.path === "/api/lab/vulnerable/posts/101"
    && post?.id === 101 && post.ownerId === userId && post.visibility === "private";
}

export function isIdorDiscovery(baseline, record, userId) {
  const post = record.data?.post;
  return Boolean(baseline && isOwnBaseline(baseline, userId) && record.status === 200
    && record.path === "/api/lab/vulnerable/posts/102" && post?.id === 102
    && post.ownerId === "user-b" && post.visibility === "private"
    && typeof post.body === "string" && post.body.length > 0);
}
