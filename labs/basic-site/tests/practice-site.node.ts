import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createBasicSite } from '../src/server.ts';
import { createPracticeState, missions } from '../public/practice-state.js';

let site: Awaited<ReturnType<typeof createBasicSite>>;
const previousEnvironment = process.env.NODE_ENV;
before(async () => {
  process.env.NODE_ENV = 'test';
  site = await createBasicSite({ port: 0, enableIdorLab: true, enableSqliLab: true, enableXssLab: true, enableAuthzLab: true });
});
after(async () => {
  await site?.close();
  if (previousEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousEnvironment;
});

test('both modes serve the same website controls, with assistance separated and scripts available', async () => {
  for (const kind of ['idor', 'sqli', 'xss', 'authz']) {
    const base = ['idor', 'sqli'].includes(kind) ? `/?lab=${kind}&` : `/lab/${kind}?`;
    const versions: string[] = [];
    for (const mode of ['guided', 'free']) {
      const response = await fetch(site.url + base + 'mode=' + mode);
      assert.equal(response.status, 200);
      const html = await response.text(); versions.push(html);
      for (const id of ['site-account', 'site-posts', 'site-search']) assert.ok(html.includes(`id="${id}"`));
      if (kind === 'xss') for (const id of ['site-xss-status', 'site-xss-victim', 'site-xss-secret', 'site-xss-impact', 'site-xss-review', 'site-mission-next']) assert.ok(html.includes(`id="${id}"`));
      assert.ok(html.includes('동네 이야기'));
      assert.doesNotMatch(html, /quick-form|quiz-|requestWorkshop|XSS 예시 입력|OR 1=1|innerHTML/);
      assert.match(html, mode === 'free' ? /id="site-mission"[^>]+ hidden/ : /id="site-hints"[^>]+ hidden/);
      assert.match(html, /id="site-hint-list" hidden/);
    }
    const surface = (html: string) => html.match(/<main>[\s\S]*?<\/main>/)![0];
    assert.equal(surface(versions[0]), surface(versions[1]));
  }
  for (const asset of ['practice-site.js', 'practice-state.js', 'http-client.js']) {
    const response = await fetch(`${site.url}/assets/${asset}`);
    assert.equal(response.status, 200);
    const source = await response.text();
    // Parse only; never evaluate the fixture's HTML or run an attack payload.
    assert.doesNotThrow(() => new Function(source.replace(/^import .*;$/gm, '').replace(/^export /gm, '')));
  }
  const deepLink = await (await fetch(site.url + '/posts/102?lab=idor&mode=free')).text();
  assert.match(deepLink, /data-post-id="102"/);
});

test('real local responses gate progress; hints, failures and mismatched comparisons do not complete it', async () => {
  let cookie = '';
  async function call(path: string, input?: object) {
    const response = await fetch(site.url + path, { method: input ? 'POST' : 'GET', headers: { Origin: site.url, Cookie: cookie, ...(input ? { 'Content-Type': 'application/json' } : {}) }, body: input ? JSON.stringify(input) : undefined });
    const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
    const body = await response.text();
    return { method: input ? 'POST' : 'GET', url: site.url + path, path: new URL(site.url + path).pathname, status: response.status, body, data: JSON.parse(body), query: new URL(site.url + path).searchParams.get('q') ?? '' };
  }
  async function login(state: ReturnType<typeof createPracticeState>, id = 'user-a') {
    const record = await call('/api/auth/login', { userId: id, password: id === 'admin' ? 'practice-admin' : 'practice-a' });
    assert.equal(record.status, 200); state.observe({ type: 'session', user: record.data.user });
  }
  const idor = createPracticeState('idor');
  for (let i = 0; i < 8; i++) idor.hint();
  assert.equal(idor.snapshot().step, 0);
  await login(idor);
  const denied = await call('/api/posts/102'); assert.equal(denied.status, 403);
  idor.observe({ type: 'post', policy: 'safe', record: denied });
  idor.observe({ type: 'post', policy: 'vulnerable', record: await call('/api/lab/vulnerable/posts/201') });
  assert.equal(idor.snapshot().step, 1); // A public 200 is not a discovery.
  idor.observe({ type: 'post', policy: 'vulnerable', record: await call('/api/lab/vulnerable/posts/102') });
  assert.equal(idor.snapshot().completed, false);
  idor.observe({ type: 'post', policy: 'vulnerable', record: await call('/api/lab/vulnerable/posts/101') });
  assert.equal(idor.snapshot().completed, true); // Free exploration need not follow guide order.
  idor.observe({ type: 'session' }); assert.equal(idor.snapshot().completed, false);

  const sqli = createPracticeState('sqli'); await login(sqli);
  const query = "' OR 1=1 -- ";
  sqli.observe({ type: 'search', policy: 'vulnerable', record: await call('/api/lab/vulnerable/search?q=' + encodeURIComponent('산책')) });
  sqli.observe({ type: 'search', policy: 'vulnerable', record: await call('/api/lab/vulnerable/search?q=' + encodeURIComponent(query)) });
  sqli.observe({ type: 'search', policy: 'safe', record: await call('/api/search?q=other') });
  assert.equal(sqli.snapshot().completed, false);
  sqli.observe({ type: 'search', policy: 'safe', record: await call('/api/search?q=' + encodeURIComponent(query)) });
  assert.equal(sqli.snapshot().completed, true);

  const xss = createPracticeState('xss'); await login(xss);
  const plain = await call('/api/lab/xss', { mode: 'vulnerable', text: '안녕하세요' });
  xss.observe({ type: 'preview', policy: 'vulnerable', text: '안녕하세요', record: plain });
  const text = '<svg onload="alert(1)"></svg>';
  const unsafe = await call('/api/lab/xss', { mode: 'vulnerable', text });
  xss.observe({ type: 'preview', policy: 'vulnerable', text, record: unsafe });
  assert.equal(xss.snapshot().step, 2); // Merely receiving HTML is not execution.
  const fakeSecret = 'VULNLAB-B-0123456789AB';
  xss.observe({ type: 'exposure', policy: 'vulnerable', text, executed: true, exposure: { victimId: 'user-b', secret: fakeSecret }, record: unsafe });
  assert.equal(xss.snapshot().step, 2); // User-supplied values are not exposure evidence.
  xss.observe({ type: 'execution', policy: 'vulnerable', text, record: unsafe });
  assert.equal(xss.snapshot().step, 3);
  xss.observe({ type: 'exposure', policy: 'vulnerable', text, executed: true, exposure: { victimId: 'user-a', secret: fakeSecret }, record: unsafe });
  assert.equal(xss.snapshot().step, 3);
  xss.observe({ type: 'exposure', policy: 'vulnerable', text, executed: true, exposure: { victimId: 'user-b', secret: fakeSecret }, record: unsafe });
  assert.equal(xss.snapshot().step, 4);
  xss.observe({ type: 'victim-review', policy: 'vulnerable', text, record: unsafe });
  assert.equal(xss.snapshot().step, 5);
  const safe = await call('/api/lab/xss', { mode: 'safe', text });
  assert.ok(safe.data.document.includes('&lt;svg'));
  xss.observe({ type: 'preview', policy: 'safe', text: 'different', record: safe });
  assert.equal(xss.snapshot().completed, false);
  xss.observe({ type: 'preview', policy: 'safe', text, executionDetected: true, record: safe });
  assert.equal(xss.snapshot().completed, false);
  xss.observe({ type: 'preview', policy: 'safe', text, record: safe });
  assert.equal(xss.snapshot().completed, true);
  xss.observe({ type: 'session', user: { id: 'user-b', role: 'user' } });
  assert.equal(xss.snapshot().completed, false);

  const authz = createPracticeState('authz'); await login(authz);
  authz.observe({ type: 'report', policy: 'safe', record: await call('/api/lab/authz?mode=safe') });
  authz.observe({ type: 'report', policy: 'vulnerable', record: await call('/api/lab/authz?mode=vulnerable') });
  assert.equal(authz.snapshot().step, 3);
  await login(authz, 'admin');
  authz.observe({ type: 'report', policy: 'safe', record: await call('/api/lab/authz?mode=safe') });
  assert.equal(authz.snapshot().completed, true);
  for (const kind of Object.keys(missions)) assert.equal(createPracticeState(kind).snapshot().completed, false);
});

test('switching assistance preserves live forms, evidence and inputs without sending another request', async () => {
  class Control {
    value = ''; textContent = ''; hidden = false; dataset: Record<string, string> = {}; children: unknown[] = [];
    attributes = new Map(); listeners = new Map();
    addEventListener(name: string, callback: (event: unknown) => unknown) { this.listeners.set(name, callback); }
    setAttribute(key: string, value: string) { this.attributes.set(key, value); }
    removeAttribute(key: string) { this.attributes.delete(key); }
    replaceChildren(...children: unknown[]) { this.children = children; }
    append(...children: unknown[]) { this.children.push(...children); }
  }
  const ids = ['site-policy', 'site-mission', 'site-hints', 'site-mission-title', 'site-mission-action', 'site-mission-next', 'site-completed', 'site-session', 'site-logout', 'site-post', 'site-posts', 'site-search-results', 'site-request', 'site-hint', 'site-hint-list', 'site-account', 'site-search', 'site-message'];
  const controls = new Map(ids.map(id => ['#' + id, new Control()]));
  controls.get('#site-policy')!.value = 'vulnerable';
  const modes = ['guided', 'free'].map(mode => Object.assign(new Control(), { dataset: { siteMode: mode } }));
  const surfaces = ['board', 'search', 'post'].map(surface => Object.assign(new Control(), { dataset: { surface } }));
  const listeners = new Map(); let requests = 0;
  const originals = Object.fromEntries(['document', 'window', 'location', 'history', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  function install(key: string, value: unknown) { Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); }
  try {
    install('document', { body: { dataset: { practiceSite: 'idor', practiceMode: 'guided', enabled: 'true' } }, querySelector: (selector: string) => controls.get(selector), querySelectorAll: (selector: string) => selector === '[data-site-mode]' ? modes : surfaces, addEventListener: (name: string, callback: unknown) => listeners.set(name, callback), createElement: () => new Control() });
    install('window', { addEventListener() {} });
    install('location', { origin: site.url, href: site.url + '/?lab=idor&mode=guided' });
    install('history', { replaceState() {}, pushState() {} });
    install('fetch', async (request: Request) => {
      requests++;
      return Response.json(new URL(request.url).pathname === '/api/me' ? { user: { id: 'user-a', name: 'A', role: 'user' } } : { posts: [] });
    });
    await import('../public/practice-site.js');
    await new Promise(resolve => setImmediate(resolve));
    const form = controls.get('#site-search')!; form.value = '입력 유지';
    const initialRequests = requests;
    const click = (mode: string) => listeners.get('click')({ target: { closest: () => modes.find(link => link.dataset.siteMode === mode) }, button: 0, preventDefault() {} });
    click('free');
    assert.equal(controls.get('#site-mission')!.hidden, true);
    assert.equal(controls.get('#site-hints')!.hidden, false);
    controls.get('#site-hint')!.listeners.get('click')();
    assert.equal(controls.get('#site-hint-list')!.children.length, 1);
    click('guided');
    assert.equal(controls.get('#site-search'), form);
    assert.equal(form.value, '입력 유지');
    assert.match(controls.get('#site-mission-title')!.textContent, /^2 \/ 4/);
    assert.equal(requests, initialRequests);
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
