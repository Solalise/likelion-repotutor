import assert from "node:assert/strict";
import { test } from "node:test";
import { createBasicSite } from "../src/server.ts";

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
  assert.match(safe.document, /&lt;svg/); assert.doesNotMatch(safe.document, /<svg/);
  assert.match(unsafe.document, /connect-src 'none'/);
  assert.equal((await xss('invalid',a)).status,400);
  assert.equal((await xss('safe',a,'a'.repeat(2001))).status,400);
  assert.equal((await fetch(site.url+'/api/lab/authz?mode=vulnerable',{headers:{Cookie:a}})).status,200);
  assert.equal((await fetch(site.url+'/api/lab/authz?mode=safe&role=admin',{headers:{Cookie:a}})).status,403);
  const b = await login('user-b','practice-b');
  assert.equal((await fetch(site.url+'/api/lab/authz?mode=safe',{headers:{Cookie:b}})).status,403);
  const admin = await login('admin','practice-admin');
  assert.equal((await fetch(site.url+'/api/lab/authz?mode=safe',{headers:{Cookie:admin}})).status,200);
  const page = await (await fetch(site.url+'/lab/xss')).text();
  assert.match(page,/sandbox="allow-scripts"/); assert.doesNotMatch(page,/allow-same-origin/);
  assert.match(page,/http:\/\/localhost:3000\/learn\/xss/);
  const cross = await fetch(site.url+'/api/lab/xss',{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/json',Cookie:a},body:'{}'});
  assert.equal(cross.status,403);
 } finally {await site.close(); if(prior === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV=prior;}
 const disabled = await createBasicSite({port:0,enableXssLab:false,enableAuthzLab:false});
 try {
  assert.equal((await fetch(disabled.url+'/api/lab/authz?mode=vulnerable')).status,404);
  assert.equal((await fetch(disabled.url+'/api/lab/xss',{method:'POST',headers:{Origin:disabled.url,'Content-Type':'application/json'},body:'{}'})).status,404);
  assert.match(await (await fetch(disabled.url+'/lab/xss')).text(), /fieldset disabled/);
 } finally {await disabled.close();}
 process.env.NODE_ENV='staging';
 try {await assert.rejects(createBasicSite({port:0,enableXssLab:true})); await assert.rejects(createBasicSite({port:0,enableAuthzLab:true}));}
 finally {if(prior === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV=prior;}
});