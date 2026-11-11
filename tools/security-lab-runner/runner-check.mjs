import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRunner } from './server.mjs';
import { createDemoServer } from './demo-server.mjs';
import { targetGet, relativePath, validatePlan } from './core.mjs';

const appOrigin = 'http://127.0.0.1:3100';
async function fixture(t, options = {}) {
  let clock = Date.now();
  const demo = await createDemoServer(0);
  const runner = await createRunner({ rpcPort:0,adminPort:0, now:()=>clock, ...options });
  t.after(async()=>{await runner.close();await demo.close();});
  const rpcBase=`http://127.0.0.1:${runner.rpcPort}`,adminBase=`http://127.0.0.1:${runner.adminPort}`;
  const config={ targetPort:demo.port,allowedOrigin:appOrigin,tokenA:'lab-token-a',tokenB:'lab-token-b',identityPath:'/me',subjectPointer:'/user/id',subjectA:'A',subjectB:'B',idPointer:'/order/id',ownerPointer:'/order/ownerId',protectedPointer:'/order/item',testOnly:true };
  let token;
  const post=async(base,path,data,headers)=>{
    const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
    return {status:r.status,body:await r.json(),headers:r.headers};
  };
  const admin=(path,data={},headers={})=>post(adminBase,'/admin/'+path,data,{Origin:adminBase,'X-Admin-Key':runner.adminKey,...headers});
  const rpc=(path,data={},headers={})=>post(rpcBase,'/v1/'+path,data,{Origin:appOrigin,...(token?{'X-Lab-Session':token}:{}),...headers});
  const setup=async(extra={})=>{assert.equal((await admin('setup',{...config,...extra})).status,200);return (await admin('state')).body.pairing.code;};
  const pair=async(extra={})=>{const code=await setup(extra);const r=await rpc('pair',{code});assert.equal(r.status,200);token=r.body.token;return code;};
  const plan=async(mode='vulnerable',extra={})=>{const r=await rpc('plans',{apiPath:`/${mode}/orders/{resourceId}`,resourceA:'101',resourceB:'102',policy:'owner-only',...extra});assert.equal(r.status,201);return r.body;};
  const execute=async(mode='vulnerable',extra={})=>{clock+=5001;const p=await plan(mode,extra);assert.equal((await admin('approve',{planId:p.id,confirm:true})).status,200);const r=await rpc('execute',{planId:p.id});assert.equal(r.status,200);return r.body;};
  return {demo,runner,config,admin,rpc,setup,pair,plan,execute,advance:ms=>clock+=ms,post,rpcBase,adminBase};
}

test('actual HTTP: distinct identities, A/A B/B A/B, vulnerable leak and fixed block',async t=>{
  const f=await fixture(t);await f.pair();
  const vulnerable=await f.execute();assert.equal(vulnerable.result.verdict,'confirmed');assert.equal(vulnerable.result.requestCount,5);
  assert.deepEqual(f.demo.seen.map(r=>[r.account,r.path]),[['A','/me'],['B','/me'],['A','/vulnerable/orders/101'],['B','/vulnerable/orders/102'],['A','/vulnerable/orders/102']]);
  assert.equal(vulnerable.result.evidence[4].response.ownerId,'B');
  assert.equal(vulnerable.result.evidence[3].response.protectedFingerprint,vulnerable.result.evidence[4].response.protectedFingerprint);
  const fixed=await f.execute('fixed');assert.equal(fixed.result.verdict,'blocked');assert.equal(fixed.result.evidence[4].status,403);
  assert.notEqual(vulnerable.result.comparisonKey,fixed.result.comparisonKey);
  assert.equal(vulnerable.result.comparisonKey,(await f.execute()).result.comparisonKey);
  const serialized=JSON.stringify((await f.rpc('state')).body);
  for(const secret of ['lab-token-a','lab-token-b','가상 크림 머그','authorization','set-cookie'])assert.equal(serialized.toLowerCase().includes(secret),false);
});
test('a 403 response containing B data is still confirmed as a leak',async t=>{const f=await fixture(t);await f.pair();assert.equal((await f.execute('error-leak')).result.verdict,'confirmed');});
test('unstructured data in a 403 response is never labeled as blocked',async t=>{const f=await fixture(t);await f.pair();const r=(await f.execute('unstructured-leak')).result;assert.equal(r.verdict,'suspected');assert.equal(r.evidence[4].response.protectedPresent,true);});
test('unclear ownership and unknown access policy remain inconclusive',async t=>{const f=await fixture(t);await f.pair();assert.equal((await f.execute('unclear')).result.verdict,'inconclusive');assert.equal((await f.execute('vulnerable',{policy:'unknown'})).result.verdict,'inconclusive');});
test('successful cross request without matching protected data is suspected',async t=>{const f=await fixture(t);await f.pair();assert.equal((await f.execute('suspected')).result.verdict,'suspected');});
test('authentication failure stops after identity checks and does not issue resource requests',async t=>{const f=await fixture(t);await f.pair({tokenB:'invalid-token-b'});const p=await f.execute();assert.equal(p.result.verdict,'inconclusive');assert.equal(p.result.requestCount,2);assert.equal(f.demo.seen.length,2);});
test('identity mismatch or identical observed identities cannot establish a verdict',async t=>{const f=await fixture(t);await f.pair({subjectB:'different-user'});assert.equal((await f.execute()).result.verdict,'inconclusive');assert.equal(f.demo.seen.length,2);await f.pair({identityPath:'/same-me'});assert.equal((await f.execute()).result.verdict,'inconclusive');assert.equal(f.demo.seen.length,4);});
test('no target requests before explicit local approval; approval is single-use and plan-bound',async t=>{
  const f=await fixture(t);await f.pair();const first=await f.plan();
  assert.equal((await f.rpc('execute',{planId:first.id})).status,409);assert.equal(f.demo.seen.length,0);
  await f.admin('approve',{planId:first.id,confirm:true});const second=await f.plan('fixed');
  assert.equal((await f.rpc('execute',{planId:first.id})).status,409);assert.equal((await f.rpc('execute',{planId:second.id})).status,409);assert.equal(f.demo.seen.length,0);
  await f.admin('approve',{planId:second.id,confirm:true});assert.equal((await f.rpc('execute',{planId:second.id})).status,200);
  assert.equal((await f.rpc('execute',{planId:second.id})).status,409);assert.equal(f.demo.seen.length,5);
});
test('unapproved targets, URL fields, external paths, encoded traversal and custom methods are rejected',async t=>{
  const f=await fixture(t);await f.pair();
  const base={apiPath:'/vulnerable/orders/{resourceId}',resourceA:'101',resourceB:'102',policy:'owner-only'};
  for(const extra of [{targetPort:9999},{url:'https://example.com'},{method:'POST'},{apiPath:'//example.com/{resourceId}'},{apiPath:'/api/%2e%2e/{resourceId}'},{apiPath:'http://127.0.0.1:9999/{resourceId}'}])assert.equal((await f.rpc('plans',{...base,...extra})).status,400);
  assert.equal(f.demo.seen.length,0);
});
test('exact Origin, Host and authenticated sessions are required; management is isolated',async t=>{
  const f=await fixture(t);const code=await f.setup();
  assert.equal((await f.rpc('pair',{code},{Origin:'http://evil.example'})).status,403);
  assert.equal((await f.rpc('pair',{code},{Origin:'null'})).status,403);
  const badHost=await new Promise(resolve=>{const req=http.request(f.rpcBase+'/v1/pair',{method:'POST',headers:{Origin:appOrigin,Host:'localhost:'+f.runner.rpcPort,'Content-Type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.end(JSON.stringify({code}));});
  assert.equal(badHost,403);
  assert.equal((await f.rpc('state')).status,401);
  assert.equal((await f.admin('setup',f.config,{Origin:appOrigin})).status,403);
  assert.equal((await f.post(f.adminBase,'/admin/setup',f.config,{Origin:f.adminBase,'X-Lab-Session':'not-admin'})).status,403);
  assert.equal((await f.rpc('pair',{code})).status,200);
  assert.equal((await f.rpc('state',{}, {'X-Lab-Session':'wrong-session'})).status,401);
  assert.equal(f.demo.seen.length,0);
});
test('one-use and expired pairing codes, expired approvals and expired sessions are rejected',async t=>{
  const f=await fixture(t);const code=await f.pair();assert.equal((await f.rpc('pair',{code})).status,401);
  const p=await f.plan();await f.admin('approve',{planId:p.id,confirm:true});f.advance(120001);assert.equal((await f.rpc('execute',{planId:p.id})).status,409);
  f.advance(600001);assert.equal((await f.rpc('state')).status,403);
  const expired=await f.setup();f.advance(120001);assert.equal((await f.rpc('pair',{code:expired})).status,403);assert.equal(f.demo.seen.length,0);
});
test('pairing brute force and rapid repeated runs are rate limited',async t=>{
  const f=await fixture(t);await f.setup();for(let i=0;i<5;i++)assert.equal((await f.rpc('pair',{code:'wrong'})).status,401);assert.equal((await f.rpc('pair',{code:'wrong'})).status,429);
  await f.pair();const one=await f.plan();await f.admin('approve',{planId:one.id,confirm:true});await f.rpc('execute',{planId:one.id});const two=await f.plan();await f.admin('approve',{planId:two.id,confirm:true});assert.equal((await f.rpc('execute',{planId:two.id})).status,429);
});
test('redirects are not followed and yield inconclusive results',async t=>{const f=await fixture(t);await f.pair();const r=await f.execute('redirect');assert.equal(r.result.verdict,'inconclusive');assert.equal(r.result.requestCount,5);assert.equal(r.result.evidence[2].error,'리다이렉트 차단');});
test('CORS allows exactly approved Origin, POST and session headers',async t=>{
  const f=await fixture(t);await f.setup();
  const r=await fetch(f.rpcBase+'/v1/pair',{method:'OPTIONS',headers:{Origin:appOrigin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-lab-session'}});
  assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),appOrigin);assert.equal(r.headers.get('access-control-allow-credentials'),null);
  const bad=await fetch(f.rpcBase+'/v1/pair',{method:'OPTIONS',headers:{Origin:appOrigin,'Access-Control-Request-Method':'GET'}});assert.equal(bad.status,403);
});
test('configuration change or clear destroys session and pending approval',async t=>{
  const f=await fixture(t);await f.pair();await f.plan();await f.setup();assert.equal((await f.rpc('state')).status,401);await f.admin('clear');assert.equal((await f.rpc('state')).status,403);
});
test('request time and streamed body size are bounded',async t=>{
  let count=0;
  const server=http.createServer((req,res)=>{count++;if(req.url==='/slow')return;res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({value:'x'.repeat(2000)}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  assert.equal((await targetGet(server.address().port,'/slow','test-token',{requestMs:30})).error,'요청 시간 초과');
  assert.equal((await targetGet(server.address().port,'/big','test-token',{responseBytes:100})).error,'응답 크기 제한 초과');assert.equal(count,2);
});
test('admin page has no embedded capability or token and cannot be framed',async t=>{
  const f=await fixture(t);const r=await fetch(f.adminBase+'/');const html=await r.text();assert.equal(html.includes(f.runner.adminKey),false);assert.equal(html.includes('lab-token-a / lab-token-b'),true);assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});
test('runner standalone validation rejects unsupported path/resource shapes',()=>{
  for(const path of ['/a/../b','/a\\b','https://example.com','//example.com','/api/a#secret'])assert.throws(()=>relativePath(path));
  assert.throws(()=>validatePlan({apiPath:'/orders/{resourceId}',resourceA:'101',resourceB:'101',policy:'owner-only'}));
});
