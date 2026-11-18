import { requestPost, requestSearch, requestLabSearch, requestText } from './http-client.js';
import { createPracticeState, missions } from './practice-state.js';

const kind = document.body.dataset.practiceSite;
const enabled = document.body.dataset.enabled === 'true';
const state = createPracticeState(kind);
const $ = selector => document.querySelector(selector);
let epoch = 0, actor, currentPost, preview, busy = false;
const policy = () => $('#site-policy').value;
const message = text => { $('#site-message').textContent = text; };

function renderProgress() {
  const progress = state.snapshot();
  $('#site-mission-title').textContent = progress.completed ? '미션 완료' : `${progress.step + 1} / ${progress.total} · ${missions[kind][progress.step][0]}`;
  $('#site-mission-action').textContent = progress.completed ? '실제 응답으로 시나리오 비교를 확인했습니다. 개념 정리는 학습 페이지에서 이어가세요.' : missions[kind][progress.step][1];
  $('#site-completed').hidden = !progress.completed;
}
function setMode(mode) {
  document.body.dataset.practiceMode = mode;
  $('#site-mission').hidden = mode !== 'guided';
  $('#site-hints').hidden = mode !== 'free';
  for (const link of document.querySelectorAll('[data-site-mode]')) {
    if (link.dataset.siteMode === mode) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  renderProgress();
}
function address(id) {
  const url = new URL(kind === 'idor' || kind === 'sqli' ? id === undefined ? '/' : `/posts/${id}` : `/lab/${kind}`, location.origin);
  if (kind === 'idor' || kind === 'sqli') url.searchParams.set('lab', kind);
  url.searchParams.set('mode', document.body.dataset.practiceMode);
  return url;
}
function show(view) {
  for (const surface of document.querySelectorAll('[data-surface]')) surface.hidden = surface.dataset.surface !== view;
}
function node(tag, text, className) {
  const item = document.createElement(tag); item.textContent = text;
  if (className) item.className = className;
  return item;
}
function clearPreview() { preview = undefined; $('#site-preview')?.replaceChildren(); }
async function json(path, options = {}) {
  // No user-supplied URL: every caller uses a fixed, same-origin practice endpoint.
  const request = new Request(new URL(path, location.origin), { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000), ...options });
  const response = await fetch(request);
  const body = await response.text();
  return { method: request.method, url: request.url, path: new URL(request.url).pathname, status: response.status, body, data: JSON.parse(body) };
}
function observe(event) { state.observe(event); renderProgress(); }
function identity(user) {
  const changed = actor?.id !== user?.id || actor?.role !== user?.role;
  if (changed) {
    epoch++; clearPreview();
    $('#site-post').replaceChildren(); $('#site-search-results').replaceChildren();
    $('#site-request').textContent = '아직 요청 기록이 없습니다.';
    if ($('#site-report-result')) $('#site-report-result').textContent = '';
    $('#site-hint-list').replaceChildren(); $('#site-hint-list').hidden = true;
    $('#site-hint').setAttribute('aria-expanded', 'false');
  }
  actor = user;
  $('#site-session').textContent = user ? `${user.name} · ${user.role === 'admin' ? '운영자' : '일반 회원'}` : '로그인하지 않음';
  $('#site-logout').hidden = !user;
  observe({ type: 'session', user });
}
async function refreshIdentity() {
  const record = await json('/api/me');
  if (record.status === 200 && record.data.user) identity(record.data.user);
  else if (record.status === 401) identity(undefined);
  else throw new Error('현재 계정을 확인하지 못했습니다.');
}
async function action(work) {
  if (busy) return;
  busy = true; message('');
  try { await refreshIdentity(); await work(epoch); }
  catch { message('요청을 완료하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도하세요. 이번 작업은 완료 처리하지 않았습니다.'); }
  finally { busy = false; }
}
function recordResult(record) {
  $('#site-request').textContent = requestText(record);
  if (record.status === 401) { identity(undefined); message('로그인 후 이용하세요.'); }
  else if (record.status === 403) message('이 콘텐츠에 접근할 권한이 없습니다.');
  else if (record.status !== 200) message(record.data?.message ?? `HTTP ${record.status}`);
}
async function loadBoard(version = epoch) {
  const record = await json('/api/posts');
  if (version !== epoch) return;
  if (record.status !== 200) { recordResult(record); return; }
  const list = $('#site-posts'); list.replaceChildren();
  for (const post of record.data.posts) {
    const link = node('a', '', 'post-row'); link.href = address(post.id).href; link.dataset.openPost = String(post.id);
    link.append(node('span', post.visibility === 'private' ? '비공개' : '공개', 'badge'), node('h3', post.title), node('small', `작성자 ${post.ownerId}`)); list.append(link);
  }
}
async function openPost(id, version = epoch, push = true) {
  if (!/^\d{1,12}$/.test(String(id))) { message('글 번호를 확인하세요.'); return; }
  currentPost = Number(id); show('post');
  if (push && (kind === 'idor' || kind === 'sqli')) history.pushState(null, '', address(id));
  for (const [name, offset] of [['previous', -1], ['next', 1]]) {
    const link = $(`#site-${name}`); link.href = address(Math.max(1, Number(id) + offset)).href; link.dataset.openPost = String(Math.max(1, Number(id) + offset));
  }
  const selectedPolicy = policy();
  const record = await requestPost(id, kind === 'idor' && enabled && selectedPolicy === 'vulnerable' ? 'vulnerable' : 'normal');
  if (version !== epoch) return;
  recordResult(record);
  if (enabled) observe({ type: 'post', record, policy: selectedPolicy });
  const article = $('#site-post'); article.replaceChildren();
  if (record.status !== 200) { article.append(node('h2', '게시글을 열 수 없습니다.')); return; }
  const post = record.data.post;
  article.append(node('h1', post.title), node('p', `작성자 ${post.ownerId} · ${post.visibility === 'private' ? '비공개' : '공개'}`, 'meta'), node('div', post.body, 'post-body'));
}

document.addEventListener('click', event => {
  const target = event.target.closest('[data-site-mode], [data-view], [data-open-post]');
  if (!target || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  if (target.dataset.siteMode) {
    event.preventDefault(); const mode = target.dataset.siteMode;
    setMode(mode); const url = new URL(location.href); url.searchParams.set('mode', mode); history.replaceState(null, '', url);
    return; // The website forms, iframe and progress stay mounted.
  }
  if (target.dataset.openPost) { event.preventDefault(); void action(version => openPost(target.dataset.openPost, version)); }
  if (target.dataset.view) {
    event.preventDefault(); const view = target.dataset.view; show(view);
    if (view !== 'post' && (kind === 'idor' || kind === 'sqli')) history.pushState(null, '', address());
    if (view === 'board') void action(version => loadBoard(version));
    if (view === 'management') void report();
  }
});
$('#site-account').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  busy = true; const version = ++epoch; clearPreview();
  try {
    const userId = new FormData(event.currentTarget).get('user');
    const password = userId === 'admin' ? 'practice-admin' : userId === 'user-a' ? 'practice-a' : 'practice-b';
    const record = await json('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, password }) });
    if (version !== epoch) return;
    if (record.status !== 200) { message(record.data?.message ?? '로그인하지 못했습니다.'); return; }
    identity(record.data.user); message('로그인했습니다.'); await loadBoard();
  } catch { message('로그인하지 못했습니다.'); }
  finally { busy = false; }
});
$('#site-logout').addEventListener('click', () => void action(async version => {
  const record = await json('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  if (version !== epoch) return;
  if (record.status === 200) { identity(undefined); await loadBoard(); message('로그아웃했습니다.'); }
  else recordResult(record);
}));
$('#site-search').addEventListener('submit', event => {
  event.preventDefault(); const query = new FormData(event.currentTarget).get('q') || '';
  void action(async version => {
    const selectedPolicy = policy();
    const record = await (kind === 'sqli' && enabled && selectedPolicy === 'vulnerable' ? requestLabSearch(query) : requestSearch(query));
    if (version !== epoch) return;
    recordResult(record); const results = $('#site-search-results'); results.replaceChildren();
    if (record.status !== 200) return;
    for (const post of record.data.posts) {
      const item = node('article', '', 'post-row'); item.append(node('span', post.visibility === 'private' ? '비공개' : '공개', 'badge'), node('h3', post.title), node('p', post.body)); results.append(item);
    }
    $('#site-search-status').textContent = `검색 결과 ${record.data.posts.length}개`;
    if (enabled) observe({ type: 'search', record, policy: selectedPolicy });
  });
});
$('#site-comment')?.addEventListener('submit', event => {
  event.preventDefault(); const text = new FormData(event.currentTarget).get('text');
  if (!enabled) { message('이 시나리오는 비활성화되어 있습니다.'); return; }
  void action(async version => {
    clearPreview(); const selectedPolicy = policy();
    const record = await json('/api/lab/xss', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, mode: selectedPolicy }) });
    if (version !== epoch) return;
    recordResult(record); if (record.status !== 200 || typeof record.data.document !== 'string') return;
    const frame = document.createElement('iframe'); frame.title = '댓글 미리보기'; frame.setAttribute('sandbox', 'allow-scripts'); frame.referrerPolicy = 'no-referrer';
    const observation = { record, text, policy: selectedPolicy };
    preview = { frame, observation, version };
    frame.addEventListener('load', () => {
      if (preview?.frame === frame && version === epoch) observe({ type: 'preview', ...observation });
    });
    frame.srcdoc = record.data.document; $('#site-preview').replaceChildren(frame);
  });
});
$('#site-comment textarea')?.addEventListener('input', () => { epoch++; clearPreview(); });
window.addEventListener('message', event => {
  if (!preview || event.source !== preview.frame.contentWindow || event.data !== 'vulnlab-xss-executed' || preview.version !== epoch || preview.observation.policy !== 'vulnerable') return;
  observe({ type: 'execution', ...preview.observation }); message('댓글 미리보기에서 실행 신호를 확인했습니다.');
});
async function report() {
  if (!enabled) { message('이 시나리오는 비활성화되어 있습니다.'); return; }
  await action(async version => {
    const selectedPolicy = policy(); const record = await json(`/api/lab/authz?mode=${selectedPolicy}`);
    if (version !== epoch) return;
    recordResult(record); $('#site-report-result').textContent = record.status === 200 ? record.data.report : record.data?.message ?? '접근할 수 없습니다.';
    observe({ type: 'report', record, policy: selectedPolicy });
  });
}
$('#site-report')?.addEventListener('click', () => void report());
$('#site-policy').addEventListener('change', () => {
  epoch++; clearPreview(); message('사이트 버전을 변경했습니다. 같은 화면에서 다시 확인하세요.');
  $('#site-post').replaceChildren(); $('#site-search-results').replaceChildren();
  if ($('#site-report-result')) $('#site-report-result').textContent = '';
  if (currentPost && !$('[data-surface="post"]').hidden) void action(version => openPost(currentPost, version, false));
});
$('#site-hint').addEventListener('click', () => {
  const hint = state.hint(); const list = $('#site-hint-list');
  if (hint) list.append(node('li', hint));
  else if (!list.textContent) list.append(node('li', '추가 힌트가 없습니다.'));
  list.hidden = false; $('#site-hint').setAttribute('aria-expanded', 'true');
});
window.addEventListener('popstate', () => {
  const url = new URL(location.href); setMode(url.searchParams.get('mode') === 'guided' ? 'guided' : 'free');
  const match = /^\/posts\/(\d{1,12})$/.exec(url.pathname);
  if (match) void action(version => openPost(match[1], version, false));
  else show('board');
});
setMode(document.body.dataset.practiceMode);
void action(async version => {
  await loadBoard(version);
  if (document.body.dataset.postId) await openPost(document.body.dataset.postId, version, false);
  else show(kind === 'xss' ? 'comments' : kind === 'sqli' ? 'search' : 'board');
});
