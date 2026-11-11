import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import http from "node:http";
import { networkInterfaces } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createBasicSite } from "../src/server.ts";
import { createSearchDatabase, restrictSearchConnection, type SearchConnection } from "../src/features/search.ts";

type SearchBody = { posts: { id: number; title: string; body: string; visibility: string }[]; error?: string };
let site: Awaited<ReturnType<typeof createBasicSite>>;
let cookie: string;
before(async () => {
  const prior = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  try { site = await createBasicSite({ port: 0, enableSqliLab: true, enableIdorLab: true }); }
  finally { if (prior === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prior; }
  const response = await fetch(`${site.url}/api/auth/login`, { method: "POST", headers: { Origin: site.url, "Content-Type": "application/json" }, body: JSON.stringify({ userId: "user-a", password: "practice-a" }) });
  cookie = response.headers.get("set-cookie")!.split(";")[0];
});
after(async () => { await site?.close(); });
async function search(q: string, vulnerable = false) {
  const response = await fetch(`${site.url}/api/${vulnerable ? "lab/vulnerable/" : ""}search?${new URLSearchParams({ q })}`, { headers: { Cookie: cookie } });
  return { response, body: await response.json() as SearchBody };
}

test("real SQLite normal search binds literal input and returns only public fixtures", async () => {
  const { response, body } = await search("산책");
  assert.equal(response.status, 200);
  assert.deepEqual(body.posts.map(post => post.id), [1001]);
  for (const query of ["' OR 1=1 --", "%", "_", "비공개", "' UNION SELECT 1,2,3,4 --", "'; DROP TABLE search_posts; --"]) {
    const result = await search(query);
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body.posts, []);
  }
  assert.deepEqual((await search("")).body.posts.map(post => post.visibility), ["public", "public"]);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("the vulnerable query really bypasses the SQL predicate while normal query stays safe", async () => {
  assert.deepEqual((await search("산책", true)).body.posts.map(post => post.id), [1001]);
  const result = await search("' OR 1=1 --", true);
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body.posts.map(post => post.id), [1001, 1002, 1003, 1004]);
  assert.equal(result.body.posts.filter(post => post.visibility === "private").length, 2);
  assert.ok(result.body.posts.every(post => post.body.length > 0));
  assert.deepEqual((await search("' OR 1=1 --")).body.posts, []);
  assert.equal((await fetch(`${site.url}/api/lab/vulnerable/search?q=x`)).status, 401);
});

test("dangerous functions, schema access, subqueries and stacked statements are denied", async () => {
  for (const query of [
    "'; DROP TABLE search_posts; --", "'; ATTACH DATABASE 'file:other' AS other; --",
    "' OR load_extension('x') --", "' OR readfile('x') --", "' OR writefile('x','y') --",
    "' OR randomblob(1000000000) --", "' OR (SELECT 1) --",
    "' UNION SELECT 1,name,sql,'private' FROM sqlite_master --",
  ]) {
    const result = await search(query, true);
    assert.equal(result.response.status, 400, query);
    assert.equal(result.body.error, "SEARCH_REJECTED");
    assert.equal("posts" in result.body, false);
  }
  assert.equal((await search("산책")).body.posts.length, 1);
});

test("SQLite authorization itself blocks mutations, file databases and unsafe SQL", () => {
  const db = new DatabaseSync(":memory:", { allowExtension: false }) as SearchConnection;
  try {
    db.exec("CREATE TABLE search_posts (id INTEGER, title TEXT, body TEXT, visibility TEXT); INSERT INTO search_posts VALUES (1,'t','b','public')");
    const reset = restrictSearchConnection(db);
    for (const sql of [
      "INSERT INTO search_posts VALUES (2,'a','b','public')", "UPDATE search_posts SET title='x'", "DELETE FROM search_posts",
      "DROP TABLE search_posts", "CREATE TABLE extra(id)", "ATTACH DATABASE ':memory:' AS other", "VACUUM INTO 'blocked.sqlite'",
      "PRAGMA query_only=OFF", "SELECT * FROM sqlite_master", "SELECT load_extension('x')", "SELECT readfile('x')", "SELECT writefile('x','y')",
      "SELECT randomblob(1000000000)", "SELECT (SELECT title FROM search_posts) FROM search_posts",
    ]) { reset(); assert.throws(() => db.prepare(sql).all(), Error, sql); }
    reset(); assert.deepEqual(db.prepare("SELECT title FROM search_posts").all().map(row => row.title), ["t"]);
    assert.throws(() => db.loadExtension("x"));
  } finally { db.close(); }
});

test("SQLi activation is separate, off by default, and requires explicit development/test", async () => {
  const prior = { env: process.env.NODE_ENV, flag: process.env.BASIC_SITE_ENABLE_SQLI };
  try {
    delete process.env.BASIC_SITE_ENABLE_SQLI;
    const disabled = await createBasicSite({ port: 0, enableIdorLab: true });
    try {
      assert.equal(disabled.enableSqliLab, false);
      assert.equal((await fetch(`${disabled.url}/api/lab/vulnerable/search?q=x`)).status, 404);
      assert.equal((await fetch(`${disabled.url}/api/search?q=`)).status, 200);
    } finally { await disabled.close(); }
    process.env.BASIC_SITE_ENABLE_SQLI = "1";
    for (const env of [undefined, "production", "staging", ""]) {
      if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env;
      await assert.rejects(createBasicSite({ port: 0 }), /production|development\/test/);
    }
    process.env.NODE_ENV = "development";
    const enabled = await createBasicSite({ port: 0, enableIdorLab: false });
    try { assert.equal(enabled.enableSqliLab, true); assert.equal(enabled.enableIdorLab, false); }
    finally { await enabled.close(); }
  } finally {
    if (prior.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prior.env;
    if (prior.flag === undefined) delete process.env.BASIC_SITE_ENABLE_SQLI; else process.env.BASIC_SITE_ENABLE_SQLI = prior.flag;
  }
});

test("invalid search parameters are bounded and fixture data is separate from the board", async () => {
  for (const suffix of ["", "?q=a&q=b", "?q=a&mode=unsafe", `?q=${"a".repeat(201)}`, "?q=%00"]) {
    assert.equal((await fetch(`${site.url}/api/search${suffix}`)).status, 400);
  }
  const board = await (await fetch(`${site.url}/api/posts`, { headers: { Cookie: cookie } })).json() as SearchBody;
  assert.deepEqual(board.posts.map(post => post.id), [101, 201, 202]);
  const html = await (await fetch(`${site.url}/posts`)).text();
  assert.match(html, /id="search-form"/);
  assert.match(html, /제목에 포함된 단어로 공개된 이야기를 찾아보세요/);
  const fresh = createSearchDatabase();
  try { assert.equal(fresh.search("").length, 2); }
  finally { fresh.close(); }
});

test("binding and Host validation reject non-loopback access and forged forwarded headers", async () => {
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const request = http.get(`${site.url}/api/lab/vulnerable/search?q=x`, { headers: { Host: "external.example", "X-Forwarded-Host": `127.0.0.1:${site.port}`, Cookie: cookie } }, response => { response.resume(); response.on("end", () => resolve(response.statusCode)); });
    request.on("error", reject);
  });
  assert.equal(status, 403);
  const external = Object.values(networkInterfaces()).flat().find(address => address && address.family === "IPv4" && !address.internal)?.address;
  if (external) {
    await assert.rejects(fetch(`http://${external}:${site.port}/api/search?q=x`, { signal: AbortSignal.timeout(1000) }));
  }
  assert.equal((await search("산책")).response.status, 200);
});
