import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { limits, port, safeId, relativePath, pointer, validatePlan, requestList, runPlan } from './core.mjs';

const random = () => randomBytes(24).toString('base64url');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const error = (message, status = 400) => Object.assign(new Error(message), { status });
async function body(req) {
  let size = 0; const parts = [];
  if (req.headers['content-type'] !== 'application/json') throw error('JSON 요청만 허용됩니다.', 415);
  for await (const chunk of req) { size += chunk.length; if (size > 16384) throw error('입력 크기 제한 초과', 413); parts.push(chunk); }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw error('JSON 입력 오류'); }
}
function send(res, status, data, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(JSON.stringify(data));
}
function configure(input, rpcPort, adminPort) {
  if (!input || Object.keys(input).some(k => !['targetPort','allowedOrigin','tokenA','tokenB','identityPath','subjectPointer','subjectA','subjectB','idPointer','ownerPointer','protectedPointer','testOnly'].includes(k))) throw error('지원하지 않는 설정입니다.');
  port(input.targetPort);
  if ([rpcPort, adminPort].includes(input.targetPort)) throw error('실행기 자신의 포트는 대상이 될 수 없습니다.');
  const origin = new URL(input.allowedOrigin);
  if (!['127.0.0.1', 'localhost'].includes(origin.hostname) || origin.protocol !== 'http:' || !origin.port || origin.origin !== input.allowedOrigin || [rpcPort, adminPort, input.targetPort].includes(Number(origin.port))) throw error('RepoTutor Origin은 별도의 로컬 HTTP 주소와 명시적 포트여야 합니다.');
  for (const token of [input.tokenA, input.tokenB]) if (typeof token !== 'string' || !/^[A-Za-z0-9._~+/-]{8,2048}=*$/.test(token)) throw error('테스트 Bearer 토큰 형식을 확인해주세요.');
  if (input.tokenA === input.tokenB || !safeId(input.subjectA) || !safeId(input.subjectB) || input.subjectA === input.subjectB || input.testOnly !== true) throw error('서로 다른 테스트 계정과 테스트 서버 확인이 필요합니다.');
  relativePath(input.identityPath);
  for (const key of ['subjectPointer','idPointer','ownerPointer','protectedPointer']) pointer(input[key]);
  for (const value of [input.subjectA,input.subjectB,input.identityPath,input.subjectPointer,input.idPointer,input.ownerPointer,input.protectedPointer,input.allowedOrigin]) if ([input.tokenA,input.tokenB].some(token => value.includes(token))) throw error('공개 설정에 인증정보를 넣을 수 없습니다.');
  return { ...input };
}

export async function createRunner(options = {}) {
  const rpcPort = options.rpcPort ?? 4317, adminPort = options.adminPort ?? 4318;
  if (rpcPort !== 0) port(rpcPort); if (adminPort !== 0) port(adminPort);
  const now = options.now ?? Date.now;
  const adminKey = random(); let config, pairing, session, plan, running = false;
  let attempts = 0, attemptsAt = now(), lastRunAt = -Infinity;
  const adminHtml = await readFile(new URL('./admin.html', import.meta.url), 'utf8');
  let actualRpc, actualAdmin;
  const adminOrigin = () => `http://127.0.0.1:${actualAdmin}`;
  function expire() {
    if (session && session.expiresAt <= now()) { session = undefined; plan = undefined; config = undefined; pairing = undefined; }
    if (!session && pairing && pairing.expiresAt <= now()) { config = undefined; pairing = undefined; plan = undefined; }
  }
  function cleanPlan() { return plan && { id: plan.id, input: plan.input, requests: plan.requests, target: plan.target, policy: plan.input.policy, expiresAt: plan.expiresAt, approved: Boolean(plan.approved), used: plan.used, result: plan.result }; }
  function publicState() { return { configured: Boolean(config), paired: Boolean(session), target: config ? `http://127.0.0.1:${config.targetPort}` : undefined, plan: cleanPlan(), running }; }
  const rpc = http.createServer(async (req, res) => {
    let cors = {};
    try {
      expire();
      if (req.headers.host !== `127.0.0.1:${actualRpc}` || !config || req.headers.origin !== config.allowedOrigin) throw error('Origin 또는 대상 설정을 확인해주세요.', 403);
      cors = { 'Access-Control-Allow-Origin': config.allowedOrigin, Vary: 'Origin' };
      if (req.method === 'OPTIONS') {
        if (req.headers['access-control-request-method'] !== 'POST' || (req.headers['access-control-request-headers'] ?? '').split(',').map(h => h.trim().toLowerCase()).some(h => !['content-type','x-lab-session'].includes(h))) throw error('허용되지 않은 사전 요청입니다.', 403);
        send(res, 204, undefined, { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, X-Lab-Session' }); return;
      }
      if (req.method !== 'POST') throw error('POST 통신만 허용됩니다.', 405);
      if (req.url === '/v1/pair') {
        if (now() - attemptsAt >= 60000) { attempts = 0; attemptsAt = now(); }
        if (++attempts > 5) throw error('페어링 시도 제한. 잠시 후 다시 시도해주세요.', 429);
        const input = await body(req);
        if (session || !pairing || pairing.expiresAt <= now() || !equal(input.code, pairing.code)) throw error('사용했거나 만료된 페어링 코드입니다.', 401);
        session = { token: random(), expiresAt: now() + (options.sessionMs ?? limits.sessionMs) }; pairing = undefined;
        send(res, 200, { token: session.token, expiresAt: session.expiresAt, ...publicState() }, cors); return;
      }
      if (!session || !equal(req.headers['x-lab-session'], session.token)) throw error('세션이 없거나 만료되었습니다. 로컬 화면에서 다시 설정해주세요.', 401);
      const input = await body(req);
      if (req.url === '/v1/state') { send(res, 200, publicState(), cors); return; }
      if (req.url === '/v1/plans') {
        if (running) throw error('실행 중에는 계획을 변경할 수 없습니다.', 409);
        const validated = validatePlan(input);
        const forbidden = [config.tokenA, config.tokenB];
        if (JSON.stringify(validated).split('').length > 1000 || forbidden.some(token => JSON.stringify(validated).includes(token))) throw error('계획에 인증정보를 포함할 수 없습니다.');
        plan = { id: random(), input: validated, requests: requestList(validated, config), target: `http://127.0.0.1:${config.targetPort}`, expiresAt: now() + (options.approvalMs ?? limits.approvalMs), used: false };
        send(res, 201, cleanPlan(), cors); return;
      }
      if (req.url === '/v1/execute') {
        if (!plan || input.planId !== plan.id || !plan.approved || plan.used || plan.expiresAt <= now() || running) throw error('실행 직전 로컬 관리 화면에서 이 계획을 승인해주세요. 승인은 2분간 한 번만 유효합니다.', 409);
        if (session.expiresAt - now() < limits.requests * limits.requestMs + 1000) throw error('세션 유효 시간이 부족합니다. 로컬 화면에서 다시 등록해주세요.', 401);
        if (now() - lastRunAt < 5000) throw error('실행 간격은 최소 5초입니다.', 429);
        plan.used = true; running = true; lastRunAt = now();
        const executing = plan, activeConfig = config;
        try { executing.result = await runPlan(executing.input, activeConfig, options.requestOptions); }
        finally { running = false; }
        send(res, 200, cleanPlan(), cors); return;
      }
      throw error('지원하지 않는 실행기 경로입니다.', 404);
    } catch (caught) { send(res, caught.status ?? 400, { message: caught.status ? caught.message : '입력 형식을 확인해주세요.' }, cors); }
  });
  const admin = http.createServer(async (req, res) => {
    try {
      expire();
      if (req.headers.host !== `127.0.0.1:${actualAdmin}`) throw error('Host 불일치', 403);
      if (req.method === 'GET' && req.url === '/') {
        const nonce = random();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'` });
        res.end(adminHtml.replaceAll('NONCE_VALUE', nonce)); return;
      }
      if (req.method !== 'POST' || req.headers.origin !== adminOrigin() || !equal(req.headers['x-admin-key'], adminKey)) throw error('로컬 관리 화면 인증이 필요합니다.', 403);
      const input = await body(req);
      if (req.url === '/admin/state') { send(res, 200, { ...publicState(), pairing: pairing ? { code: pairing.code, expiresAt: pairing.expiresAt } : undefined }); return; }
      if (running) throw error('실행 중에는 설정을 변경할 수 없습니다.', 409);
      if (req.url === '/admin/setup') {
        config = configure(input, actualRpc, actualAdmin); session = undefined; plan = undefined;
        pairing = { code: random(), expiresAt: now() + (options.pairMs ?? limits.pairMs) }; attempts = 0; attemptsAt = now();
        send(res, 200, { message: '테스트 대상 등록 완료. 페어링 코드는 2분간 한 번만 사용할 수 있습니다.' }); return;
      }
      if (req.url === '/admin/approve') {
        if (!plan || plan.used || plan.id !== input.planId || input.confirm !== true || plan.expiresAt <= now() || !session) throw error('승인할 계획이 없거나 만료되었습니다.', 409);
        plan.approved = true;
        send(res, 200, { message: '현재 계획을 한 번 실행하도록 승인했습니다.' }); return;
      }
      if (req.url === '/admin/clear') { config = undefined; session = undefined; pairing = undefined; plan = undefined; send(res, 200, { message: '토큰과 세션을 메모리에서 폐기했습니다.' }); return; }
      throw error('지원하지 않는 관리 경로입니다.', 404);
    } catch (caught) { send(res, caught.status ?? 400, { message: caught.status ? caught.message : '설정 형식을 확인해주세요.' }); }
  });
  for (const server of [rpc, admin]) { server.requestTimeout = 10000; server.headersTimeout = 5000; server.maxHeadersCount = 30; }
  await new Promise((resolve, reject) => { rpc.once('error', reject); rpc.listen(rpcPort, '127.0.0.1', resolve); });
  actualRpc = rpc.address().port;
  try { await new Promise((resolve, reject) => { admin.once('error', reject); admin.listen(adminPort, '127.0.0.1', resolve); }); }
  catch (caught) { rpc.close(); throw caught; }
  actualAdmin = admin.address().port;
  const sweep = setInterval(expire, 1000); sweep.unref();
  return { rpcPort: actualRpc, adminPort: actualAdmin, adminKey, adminUrl: `${adminOrigin()}/#${adminKey}`,
    close: async () => { clearInterval(sweep); config = undefined; session = undefined; pairing = undefined; plan = undefined; for (const server of [rpc, admin]) server.closeAllConnections(); await Promise.all([rpc, admin].map(server => new Promise(resolve => server.close(resolve)))); } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const runner = await createRunner();
  console.log(`RepoTutor Local Runner: http://127.0.0.1:${runner.rpcPort}\n로컬 관리 화면: ${runner.adminUrl}\n관리 URL은 이 PC에서만 열고 공유하지 마세요. 테스트 계정 토큰은 출력하지 않습니다.`);
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal, async () => { await runner.close(); process.exit(0); });
}
