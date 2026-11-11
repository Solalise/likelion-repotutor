import http from 'node:http';
import { createHash } from 'node:crypto';

export const limits = Object.freeze({ requestMs: 4000, responseBytes: 65536, requests: 5, sessionMs: 600000, approvalMs: 120000, pairMs: 120000 });
export const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
export function port(value) {
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error('포트는 1024~65535 사이의 정수여야 합니다.');
  return value;
}
export function relativePath(value, template = false) {
  if (typeof value !== 'string' || value.length > 500 || !value.startsWith('/') || /[\\\s%#:]/.test(value) || value.includes('//')) throw new Error('허용되지 않은 상대 경로입니다.');
  if (template && value.split('{resourceId}').length !== 2) throw new Error('{resourceId}를 한 번 사용해주세요.');
  const clean = template ? value.replace('{resourceId}', 'RESOURCE_ID') : value;
  const [pathname, query, ...extra] = clean.split('?');
  if (extra.length || !/^\/[A-Za-z0-9_~./-]+$/.test(pathname) || pathname.split('/').some(p => p === '.' || p === '..') || (query !== undefined && !/^[A-Za-z0-9_-]+=[A-Za-z0-9_~.-]+(?:&[A-Za-z0-9_-]+=[A-Za-z0-9_~.-]+)*$/.test(query))) throw new Error('경로 형식을 확인해주세요.');
  return value;
}
export function pointer(value) {
  if (typeof value !== 'string' || value.length > 150 || !/^(?:\/[A-Za-z0-9_-]+)+$/.test(value) || value.split('/').some(p => ['__proto__', 'prototype', 'constructor'].includes(p))) throw new Error('JSON 필드 위치는 /order/id 형식으로 입력해주세요.');
  return value;
}
export function readPointer(body, path) {
  let current = body;
  for (const key of path.slice(1).split('/')) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
}
function scalar(value, secrets) {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  return safeId(text) && !secrets.some(secret => text.includes(secret)) ? text : undefined;
}
function fingerprint(value, secrets) {
  // Only scalar test fields; never relay arbitrary response bodies or headers.
  if (!['string', 'number', 'boolean'].includes(typeof value)) return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  const text = JSON.stringify(value);
  if (text.length > 4096 || secrets.some(secret => text.includes(secret))) return undefined;
  return createHash('sha256').update(text).digest('hex');
}

/** Numeric IP + fixed port only. No DNS, env proxy, redirect, cookies, retries, or custom headers. */
export function targetGet(targetPort, path, token, options = {}) {
  port(targetPort); relativePath(path);
  return new Promise(resolve => {
    let done = false;
    let timer;
    const finish = value => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
    const req = http.request({ hostname: '127.0.0.1', port: targetPort, path, method: 'GET', agent: false,
      maxHeaderSize: 8192, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Cache-Control': 'no-cache' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400) { res.destroy(); finish({ status: res.statusCode, error: '리다이렉트 차단' }); return; }
      const chunks = []; let bytes = 0;
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > (options.responseBytes ?? limits.responseBytes)) { res.destroy(); finish({ status: res.statusCode, error: '응답 크기 제한 초과' }); }
        else chunks.push(chunk);
      });
      res.on('end', () => {
        if (!/^application\/json(?:\s*;|$)/i.test(res.headers['content-type'] ?? '')) { finish({ status: res.statusCode, error: 'JSON 응답 아님' }); return; }
        try { finish({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch { finish({ status: res.statusCode, error: 'JSON 해석 실패' }); }
      });
      res.on('error', () => finish({ status: res.statusCode, error: '응답 연결 중단' }));
    });
    req.on('error', () => finish({ error: '연결 실패 또는 시간 초과' }));
    timer = setTimeout(() => { finish({ error: '요청 시간 초과' }); req.destroy(); }, options.requestMs ?? limits.requestMs);
    req.end();
  });
}

export function validatePlan(input) {
  if (!input || Object.keys(input).some(k => !['apiPath', 'resourceA', 'resourceB', 'policy'].includes(k))) throw new Error('계획에는 경로·리소스·접근 정책만 전달할 수 있습니다.');
  relativePath(input.apiPath, true);
  if (!safeId(input.resourceA) || !safeId(input.resourceB) || input.resourceA === input.resourceB) throw new Error('서로 다른 테스트 리소스 ID를 입력해주세요.');
  if (!['owner-only', 'unknown'].includes(input.policy)) throw new Error('접근 정책을 선택해주세요.');
  return { apiPath: input.apiPath, resourceA: input.resourceA, resourceB: input.resourceB, policy: input.policy };
}
export function requestList(plan, config) {
  return [
    { account: 'A', purpose: '계정 A 신원 확인', path: config.identityPath },
    { account: 'B', purpose: '계정 B 신원 확인', path: config.identityPath },
    { account: 'A', purpose: 'A → A 정상 요청', path: plan.apiPath.replace('{resourceId}', plan.resourceA) },
    { account: 'B', purpose: 'B → B 정상 요청', path: plan.apiPath.replace('{resourceId}', plan.resourceB) },
    { account: 'A', purpose: 'A → B 교차 접근', path: plan.apiPath.replace('{resourceId}', plan.resourceB) },
  ];
}
export async function runPlan(plan, config, options = {}) {
  const evidence = [], secrets = [config.tokenA, config.tokenB];
  const comparisonKey = createHash('sha256').update(JSON.stringify({ plan, targetPort: config.targetPort,
    identityPath: config.identityPath, subjectPointer: config.subjectPointer, subjectA: config.subjectA, subjectB: config.subjectB,
    idPointer: config.idPointer, ownerPointer: config.ownerPointer, protectedPointer: config.protectedPointer })).digest('hex');
  const request = async item => {
    const response = await targetGet(config.targetPort, item.path, item.account === 'A' ? config.tokenA : config.tokenB, options);
    const body = response.body;
    const clean = { ...item, method: 'GET', status: response.status, error: response.error,
      response: { subject: scalar(readPointer(body, config.subjectPointer), secrets),
        resourceId: scalar(readPointer(body, config.idPointer), secrets), ownerId: scalar(readPointer(body, config.ownerPointer), secrets),
        protectedFingerprint: fingerprint(readPointer(body, config.protectedPointer), secrets),
        resourcePresent: readPointer(body, config.idPointer) !== undefined,
        ownerPresent: readPointer(body, config.ownerPointer) !== undefined,
        protectedPresent: readPointer(body, config.protectedPointer) !== undefined } };
    evidence.push(clean);
    return clean;
  };
  const finish = (verdict, reason) => ({ verdict, reason, evidence, comparisonKey, requestCount: evidence.length,
    scope: '이번 계정·리소스·경로에서 관찰한 결과입니다. 웹사이트 전체의 안전을 보장하지 않습니다.' });
  const requests = requestList(plan, config);
  const a = await request(requests[0]), b = await request(requests[1]);
  const ok = item => item.status >= 200 && item.status < 300 && !item.error;
  if (!ok(a) || !ok(b) || a.response.subject !== config.subjectA || b.response.subject !== config.subjectB || a.response.subject === b.response.subject) {
    return finish('inconclusive', '테스트 계정의 인증 또는 서로 다른 신원을 확인하지 못했습니다. 리소스 요청은 중단했습니다.');
  }
  const aa = await request(requests[2]), bb = await request(requests[3]), ab = await request(requests[4]);
  if (!ok(aa) || !ok(bb) || [aa, bb, ab].some(item => item.error) || [401, 429].includes(ab.status) || !ab.status || ab.status >= 500) return finish('inconclusive', '정상 요청 실패·인증 실패·응답 오류로 비교 조건을 충족하지 못했습니다.');
  if (plan.policy !== 'owner-only' || aa.response.resourceId !== plan.resourceA || bb.response.resourceId !== plan.resourceB || aa.response.ownerId !== config.subjectA || bb.response.ownerId !== config.subjectB || !aa.response.protectedFingerprint || !bb.response.protectedFingerprint || aa.response.protectedFingerprint === bb.response.protectedFingerprint) {
    return finish('inconclusive', '소유자 전용 정책, 리소스 ID, 소유권 또는 서로 구분되는 보호 데이터 근거가 부족합니다.');
  }
  const leaked = ab.response.protectedFingerprint === bb.response.protectedFingerprint;
  if (leaked && ab.response.resourceId === plan.resourceB && ab.response.ownerId === config.subjectB) return finish('confirmed', 'A의 신원으로 B 소유 리소스와 동일한 보호 데이터가 반환되어 소유자 전용 정책 위반을 재현했습니다.');
  // Error statuses alone do not prove blocking: resource/owner/protected fields must be absent.
  if ([403, 404].includes(ab.status) && !ab.response.resourcePresent && !ab.response.ownerPresent && !ab.response.protectedPresent) return finish('blocked', '정상 기준 요청은 성공했고 교차 요청은 거부되었으며 설정한 보호 필드가 반환되지 않았습니다.');
  if (leaked || ok(ab) || ab.response.resourcePresent || ab.response.ownerPresent || ab.response.protectedPresent) return finish('suspected', '교차 접근 응답이 관찰되었지만 동일한 비공개 데이터 노출을 확정할 근거가 충분하지 않습니다.');
  return finish('inconclusive', '응답이 지원하는 판정 조건과 일치하지 않습니다. 접근 정책과 필드 위치를 확인해주세요.');
}
