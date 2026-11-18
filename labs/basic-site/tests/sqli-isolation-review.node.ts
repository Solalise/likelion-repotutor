import assert from "node:assert/strict";
import { test } from "node:test";
import { createBasicSite } from "../src/server.ts";

async function login(url: string, userId: "user-a" | "user-b") {
  const response = await fetch(`${url}/api/auth/login`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(5000),
    headers: { Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify({ userId, password: userId === "user-a" ? "practice-a" : "practice-b" }),
  });
  assert.equal(response.status, 200);
  await response.json();
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}

type SearchBody = { posts: Array<{ id: number; visibility: string }>; dataset: string };
async function search(url: string, path: string, value: string, cookie?: string) {
  return fetch(`${url}${path}?${new URLSearchParams({ q: value })}`, {
    redirect: "error", signal: AbortSignal.timeout(5000), headers: cookie ? { Cookie: cookie } : {},
  });
}

test("SQLi authentication separates sessions but both demo users query the same instance-wide fixture dataset", async () => {
  const prior = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  const site = await createBasicSite({ port: 0, enableSqliLab: true });
  try {
    const cookieA = await login(site.url, "user-a");
    const cookieB = await login(site.url, "user-b");
    assert.notEqual(cookieA, cookieB);
    const anonymous = await search(site.url, "/api/lab/vulnerable/search", "산책");
    assert.equal(anonymous.status, 401); await anonymous.json();
    const ownSession = async (cookie: string) => {
      const response = await fetch(`${site.url}/api/me`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(5000) });
      return (await response.json() as { user: { id: string } }).user.id;
    };
    assert.equal(await ownSession(cookieA), "user-a"); assert.equal(await ownSession(cookieB), "user-b");
    const normal = await search(site.url, "/api/lab/vulnerable/search", "산책", cookieA);
    assert.equal(normal.status, 200);
    assert.deepEqual((await normal.json() as SearchBody).posts.map(row => row.id), [1001]);
    // Read-only predicate bypass against synthetic data on this test's ephemeral loopback instance only.
    const a = await search(site.url, "/api/lab/vulnerable/search", "' OR 1=1 --", cookieA);
    const b = await search(site.url, "/api/lab/vulnerable/search", "' OR 1=1 --", cookieB);
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    const dataA = await a.json() as SearchBody, dataB = await b.json() as SearchBody;
    assert.deepEqual(dataA, dataB);
    assert.equal(dataA.dataset, "sqli-practice");
    assert.deepEqual(dataA.posts.map(row => row.id), [1001, 1002, 1003, 1004]);
    assert.equal(dataA.posts.filter(row => row.visibility === "private").length, 2);
    const safe = await search(site.url, "/api/search", "' OR 1=1 --");
    assert.equal(safe.status, 200); assert.deepEqual((await safe.json() as SearchBody).posts, []);
  } finally {
    await site.close();
    if (prior === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prior;
  }
});

test("separate instances do not accept each other's session and SQLi guards remain enabled", async () => {
  const prior = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  const sites: Awaited<ReturnType<typeof createBasicSite>>[] = [];
  try {
    const a = await createBasicSite({ port: 0, enableSqliLab: true }); sites.push(a);
    const b = await createBasicSite({ port: 0, enableSqliLab: false }); sites.push(b);
    const cookie = await login(a.url, "user-a");
    const other = await fetch(`${b.url}/api/me`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(5000) });
    assert.equal(other.status, 401); await other.json();
    const disabled = await search(b.url, "/api/lab/vulnerable/search", "x", cookie);
    assert.equal(disabled.status, 404); await disabled.json();
    const rejected = await search(a.url, "/api/lab/vulnerable/search", "'; DROP TABLE search_posts; --", cookie);
    assert.equal(rejected.status, 400); assert.equal((await rejected.json() as { error: string }).error, "SEARCH_REJECTED");
    const stillAvailable = await search(a.url, "/api/search", "산책");
    assert.equal(stillAvailable.status, 200); assert.deepEqual((await stillAvailable.json() as SearchBody).posts.map(row => row.id), [1001]);
    const health = await fetch(`${a.url}/api/health`, { signal: AbortSignal.timeout(5000) });
    const info = await health.json() as Record<string, unknown>;
    assert.equal(info.sqliEnabled, true);
    assert.equal("userId" in info, false); assert.equal("sandboxId" in info, false); assert.equal("approvalId" in info, false);
    process.env.NODE_ENV = "production";
    await assert.rejects(createBasicSite({ port: 0, enableSqliLab: true }), /production/);
  } finally {
    for (const site of sites) await site.close();
    if (prior === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prior;
  }
});
