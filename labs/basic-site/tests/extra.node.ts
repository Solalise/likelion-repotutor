import assert from "node:assert/strict";
import { test } from "node:test";
import { createBasicSite } from "../src/server.ts";
import { createPracticeState } from "../public/practice-state.js";

test("XSS and role authorization use real HTTP, sessions, opt-in flags and isolation", async () => {
 const prior = process.env.NODE_ENV; process.env.NODE_ENV = "test";
 const site = await createBasicSite({port:0, enableXssLab:true, enableAuthzLab:true});
 try {
  const login = async (userId: string, password: string) => {
   const r = await fetch(site.url + '/api/auth/login', {method:'POST',headers:{Origin:site.url,'Content-Type':'application/json'},body:JSON.stringify({userId,password})});
   assert.equal(r.status,200); return r.headers.get('set-cookie')!.split(';')[0];
  };
  const xss = async (mode: string, cookie?: string, text = '<svg onload="alert(1)"></svg>') => fetch(site.url+'/api/lab/xss',{method:'POST',headers:{Origin:site.url,'Content-Type':'application/json', ...(cookie ? {Cookie:cookie} : {})},body:JSON.stringify({text,mode})});
  assert.equal((await xss('vulnerable')).status,401);
  assert.equal((await fetch(site.url+'/api/lab/authz?mode=vulnerable')).status,401);
  const a = await login('user-a','practice-a');
  const unsafe = await (await xss('vulnerable',a)).json() as {document:string};
  const safe = await (await xss('safe',a)).json() as {document:string};
  assert.match(unsafe.document, /<svg onload="alert\(1\)">/);
  assert.match(unsafe.document, /vulnLabDemo/);
  assert.match(unsafe.document, /VULNLAB-B-[A-F0-9]{12}/);
  assert.match(unsafe.document, /script-src 'unsafe-inline'/);
  assert.match(safe.document, /&lt;svg/); assert.doesNotMatch(safe.document, /<svg/);
  assert.match(safe.document, /script-src 'none'/);
  assert.doesNotMatch(safe.document, /vulnLabDemo|VULNLAB-B-/);
  for (const directive of ["default-src 'none'", "connect-src 'none'", "img-src 'none'", "form-action 'none'", "base-uri 'none'"]) assert.ok(unsafe.document.includes(directive));
  const secondPreview = await (await xss('vulnerable',a)).json() as {document:string};
  assert.notEqual(unsafe.document.match(/VULNLAB-B-[A-F0-9]{12}/)?.[0], secondPreview.document.match(/VULNLAB-B-[A-F0-9]{12}/)?.[0]);
  assert.equal((await xss('invalid',a)).status,400);
  assert.equal((await xss('safe',a,'a'.repeat(2001))).status,400);
  assert.equal((await fetch(site.url+'/api/lab/authz?mode=vulnerable',{headers:{Cookie:a}})).status,200);
  assert.equal((await fetch(site.url+'/api/lab/authz?mode=safe&role=admin',{headers:{Cookie:a}})).status,403);
  const b = await login('user-b','practice-b');
  assert.equal((await fetch(site.url+'/api/lab/authz?mode=safe',{headers:{Cookie:b}})).status,403);
  const admin = await login('admin','practice-admin');
  assert.equal((await fetch(site.url+'/api/lab/authz?mode=safe',{headers:{Cookie:admin}})).status,200);
  const page = await (await fetch(site.url+'/lab/xss')).text();
  assert.match(page,/site-xss-victim/);
  assert.match(page,/site-xss-defense/);
  assert.match(page,/site-mission-next/);
  assert.match(page,/http:\/\/localhost:3000\/learn\/xss/);
  const practiceClient = await (await fetch(site.url+'/assets/practice-site.js')).text();
  assert.match(practiceClient,/setAttribute\('sandbox', 'allow-scripts'\)/);
  assert.doesNotMatch(practiceClient,/allow-same-origin/);
  const cross = await fetch(site.url+'/api/lab/xss',{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/json',Cookie:a},body:'{}'});
  assert.equal(cross.status,403);
 } finally {await site.close(); if(prior === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV=prior;}
 const disabled = await createBasicSite({port:0,enableXssLab:false,enableAuthzLab:false});
 try {
  assert.equal((await fetch(disabled.url+'/api/lab/authz?mode=vulnerable')).status,404);
  assert.equal((await fetch(disabled.url+'/api/lab/xss',{method:'POST',headers:{Origin:disabled.url,'Content-Type':'application/json'},body:'{}'})).status,404);
  const disabledPage = await (await fetch(disabled.url+'/lab/xss')).text();
  assert.match(disabledPage, /data-enabled="false"/);
  assert.match(disabledPage, /시나리오는 서버에서 비활성화/);
 } finally {await disabled.close();}
 process.env.NODE_ENV='staging';
 try {await assert.rejects(createBasicSite({port:0,enableXssLab:true})); await assert.rejects(createBasicSite({port:0,enableAuthzLab:true}));}
 finally {if(prior === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV=prior;}
});

test("XSS progress requires execution, verified demo exposure, victim review and the same escaped input", () => {
 const state = createPracticeState("xss");
 const record = (mode: string, document = "") => ({ status: 200, path: "/api/lab/xss", data: { mode, document } });
 state.observe({ type: "session", user: { id: "user-a", role: "user" } });
 state.observe({ type: "preview", policy: "vulnerable", text: "일반 댓글", record: record("vulnerable") });
 assert.equal(state.snapshot().step, 2);

 const text = '<svg onload="window.vulnLabDemo.readSecret()"></svg>';
 const vulnerable = record("vulnerable", `<div>${text}</div>`);
 state.observe({ type: "preview", policy: "vulnerable", text, record: vulnerable });
 state.observe({ type: "exposure", policy: "vulnerable", text, executed: true, exposure: { victimId: "user-b", secret: "VULNLAB-B-0123456789AB" }, record: vulnerable });
 assert.equal(state.snapshot().step, 2);
 state.observe({ type: "execution", policy: "vulnerable", text, record: vulnerable });
 assert.equal(state.snapshot().step, 3);
 state.observe({ type: "exposure", policy: "vulnerable", text, executed: true, exposure: { victimId: "user-b", secret: "not-the-generated-format" }, record: vulnerable });
 assert.equal(state.snapshot().step, 3);
 state.observe({ type: "exposure", policy: "vulnerable", text, executed: true, exposure: { victimId: "user-b", secret: "VULNLAB-B-0123456789AB" }, record: vulnerable });
 assert.equal(state.snapshot().step, 4);
 state.observe({ type: "victim-review", policy: "vulnerable", text, record: vulnerable });
 assert.equal(state.snapshot().step, 5);

 const escaped = text.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
 state.observe({ type: "preview", policy: "safe", text: "다른 입력", record: record("safe", `<div>${escaped}</div>`) });
 assert.equal(state.snapshot().completed, false);
 state.observe({ type: "preview", policy: "safe", text, executionDetected: true, record: record("safe", `<div>${escaped}</div>`) });
 assert.equal(state.snapshot().completed, false);
 state.observe({ type: "preview", policy: "safe", text, record: record("safe", `<div>${escaped}</div>`) });
 assert.equal(state.snapshot().completed, true);
});