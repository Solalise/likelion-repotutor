const kind = document.body.dataset.lab;
const result = document.querySelector('#result');
const evidence = document.querySelector('#evidence');
const frame = document.querySelector('#preview');
let generation = 0;
let currentMode;
function reset() { generation++; currentMode = undefined; result.textContent = ''; evidence.textContent = ''; if (frame) frame.srcdoc = ''; }
async function api(path, options) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000), ...options });
  return { status: response.status, data: await response.json() };
}

document.querySelector('#account').addEventListener('submit', async event => {
  event.preventDefault(); reset();
  const userId = new FormData(event.currentTarget).get('user');
  try {
    const record = await api('/api/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({userId, password: userId === 'admin' ? 'practice-admin' : userId === 'user-a' ? 'practice-a' : 'practice-b'}) });
    document.querySelector('#session').textContent = record.status === 200 ? `${record.data.user.name} · 서버 역할: ${record.data.user.role}` : record.data.message;
  } catch { document.querySelector('#session').textContent = '로그인 실패: 실습 서버 연결을 확인하세요.'; }
});

document.querySelector('#sample')?.addEventListener('click', () => { document.querySelector('textarea').value = '<svg onload="alert(1)"></svg>'; });
window.addEventListener('message', event => {
  if (event.source === frame?.contentWindow && event.data === 'vulnlab-xss-executed' && currentMode === 'vulnerable') result.textContent = 'XSS 재현 성공: 입력한 코드가 격리 프레임에서 실행되었습니다.';
});

document.querySelector('#exercise').addEventListener('submit', async event => {
  event.preventDefault(); reset(); const version = generation;
  const form = event.currentTarget;
  const fields = new FormData(form); const mode = fields.get('mode');
  const button = form.querySelector('button.primary'); button.disabled = true;
  try {
    const record = await api(kind === 'xss' ? '/api/lab/xss' : `/api/lab/authz?mode=${mode}`, kind === 'xss' ? { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({text: fields.get('text'), mode}) } : {});
    if (version !== generation) return;
    evidence.textContent = `HTTP ${record.status}\n${JSON.stringify(record.data, null, 2)}`;
    if (record.status !== 200) { result.textContent = record.status === 403 ? '접근 거부: 서버 권한 검증이 동작했습니다.' : '실습 실패: ' + record.data.message; return; }
    if (kind === 'xss') {
      currentMode = mode; frame.srcdoc = record.data.document;
      result.textContent = mode === 'safe' ? '안전한 출력: 입력을 글자로 표시했습니다. 취약 모드와 비교하세요.' : '출력 완료: 실행 감지 대기 중입니다. 일반 텍스트는 XSS를 발생시키지 않습니다.';
    } else result.textContent = mode === 'vulnerable' && record.data.user.role !== 'admin' ? '권한 우회 재현 성공: 일반 사용자가 관리자 통계를 읽었습니다.' : '접근 허용: 관리자 역할 또는 취약 모드의 로그인 검사 결과입니다.';
  } catch { if (version === generation) result.textContent = '요청 실패: 실습 서버 연결을 확인하세요.'; }
  finally { button.disabled = false; }
});
