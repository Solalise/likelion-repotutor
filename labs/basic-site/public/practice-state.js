// Presentation evidence only: these states never authorize API requests.
export const missions = {
  idor: [
    ['사용자 A로 로그인', '로그인에서 사용자 A를 선택하세요.'],
    ['나의 비공개 글 열기', '게시판에서 사용자 A의 비공개 글을 기본 버전으로 열어보세요.'],
    ['다른 글의 접근 결과 확인', '다음 글 링크로 글 번호를 바꾸어 다른 소유자의 비공개 글 접근 결과를 확인하세요.'],
    ['수정 버전과 비교', '같은 글 주소를 수정 버전에서 다시 열어 접근 거부를 확인하세요.'],
  ],
  sqli: [
    ['사용자 A로 로그인', '로그인에서 사용자 A를 선택하세요.'],
    ['일반 검색', '검색 화면에서 일반 단어로 소식을 찾아보세요.'],
    ['검색 조건 변화 확인', '기본 버전에서 검색 입력을 바꾸어 공개 범위 밖의 기록이 반환되는지 관찰하세요.'],
    ['같은 입력으로 비교', '입력을 유지하고 수정 버전에서 검색해 반환 범위를 비교하세요.'],
  ],
  xss: [
    ['사용자 A로 로그인', '실습용 계정에서 사용자 A를 선택하고 로그인하세요.', '다음 조건: 화면에 사용자 A · 일반 회원이 표시됩니다.'],
    ['정상 댓글 미리보기', '댓글 미리보기에서 일반 문장을 입력하고 취약 모드에서 미리보기를 누르세요.', '다음 조건: 일반 문장이 댓글 미리보기 영역에 나타납니다.'],
    ['XSS 취약점 발견', '댓글 입력란에 HTML 태그와 이벤트 동작을 직접 시도한 뒤 취약 모드에서 미리보기를 누르세요. 입력이 브라우저에서 실행되는지 확인합니다.', '다음 조건: 격리 iframe에서 실제 실행 신호가 도착합니다. HTML 요소는 브라우저가 해석하는 페이지 구성요소입니다.'],
    ['가상 비밀정보 노출 시도', '발견한 취약점을 사용해 iframe 안의 전용 실습 API가 사용자 B의 가상 비밀정보를 읽게 해보세요. 실제 쿠키·세션·외부 주소는 대상이 아닙니다.', '다음 조건: 실행된 iframe이 user-b와 임의 생성 비밀정보를 전달합니다. 입력한 문자열만으로는 통과하지 않습니다.'],
    ['피해자 관점에서 확인', '사용자 B의 공격 전·후 상태와 실제로 노출된 실습 데이터를 확인한 뒤 피해자 관점 결과 확인 버튼을 누르세요.', '다음 조건: 가상 사용자 B에게 발생한 변화와 노출 데이터를 확인합니다.'],
    ['안전 모드로 재검증', '같은 댓글을 유지하고 안전 모드에서 미리보기를 다시 누르세요. 입력이 글자로 표시되고 실행·노출 신호가 없는지 확인합니다.', '다음 조건: 입력이 HTML로 해석되지 않고 동일한 공격 동작이 차단됩니다.'],
  ],
  authz: [
    ['사용자 A로 로그인', '로그인에서 사용자 A를 선택하세요.'],
    ['운영 현황 열기', '기본 버전에서 운영 현황을 열고 일반 계정의 접근 결과를 확인하세요.'],
    ['수정 버전과 비교', '사용자 A를 유지하고 수정 버전에서 운영 현황을 다시 확인하세요.'],
    ['운영자로 계정 전환', '로그인 영역에서 운영자 계정으로 전환하세요.'],
    ['운영자의 접근 확인', '수정 버전에서 운영 현황을 다시 열어보세요.'],
  ],
};

export const hints = {
  idor: ['로그인한 계정에서 볼 수 있는 비공개 글을 찾아보세요.', '글 주소에서 어떤 부분이 대상을 구분하는지 살펴보세요.', '요청한 글의 소유자와 현재 계정을 비교해 보세요.', '사이트 버전을 바꾸고 같은 글에 다시 접근해 보세요.'],
  sqli: ['먼저 일반 검색 결과의 공개 범위를 관찰하세요.', '입력에 따라 검색 조건의 해석이 달라지는지 살펴보세요.', '반환된 글의 공개 여부를 확인하세요.', '같은 검색어를 다른 사이트 버전에서 확인해 보세요.'],
  xss: [
    '먼저 사용자 A와 일반 댓글로 정상 기능을 확인하세요.',
    '입력에서 꺾쇠 문자가 결과 영역에서 글자 그대로 보이는지 살펴보세요.',
    '댓글 미리보기는 격리 iframe 안에서 동작합니다. 실행 결과 알림이 왔는지 확인하세요.',
    '실행 감지와 데이터 노출은 별도입니다. iframe에만 있는 실습용 읽기 API를 찾아보세요.',
    '공격 전·후 사용자 B의 가상 상태를 비교한 뒤 확인 버튼을 누르세요.',
    '같은 입력을 안전 모드에 넣고 결과가 HTML 요소가 아닌 글자로 표시되는지 확인하세요.',
  ],
  authz: ['현재 로그인 계정과 역할을 확인하세요.', '운영 현황을 일반 계정에서 열어보세요.', '사이트 버전을 바꾸고 접근 결과를 비교하세요.', '운영자 계정에서도 같은 화면을 확인해 보세요.'],
};

export function createPracticeState(kind) {
  if (!Object.hasOwn(missions, kind)) throw new Error('지원하지 않는 시나리오입니다.');
  let actor, hintCount = 0;
  let facts = missions[kind].map(() => false);
  const discoveries = new Set(), safeComparisons = new Set(), exposures = new Map();
  function reset() { facts = facts.map(() => false); actor = undefined; discoveries.clear(); safeComparisons.clear(); exposures.clear(); hintCount = 0; }
  function snapshot() {
    const missing = facts.indexOf(false);
    return { step: missing === -1 ? facts.length : missing, total: facts.length, completed: missing === -1 };
  }
  return {
    snapshot,
    hint() { return hintCount < hints[kind].length ? hints[kind][hintCount++] : undefined; },
    observe(event) {
      if (event.type === 'session') {
        const next = event.user;
        const plannedAdmin = kind === 'authz' && facts[1] && facts[2] && next?.id === 'admin' && next.role === 'admin';
        if (actor && (actor.id !== next?.id || actor.role !== next?.role) && !plannedAdmin) reset();
        actor = next;
        if (next?.id === 'user-a' && next.role === 'user') facts[0] = true;
        else if (plannedAdmin) facts[3] = true;
        return snapshot();
      }
      if (!actor || !facts[0] || snapshot().completed) return snapshot();
      const record = event.record;
      const post = record?.data?.post;
      const posts = record?.data?.posts;
      const unsafe = event.policy === 'vulnerable', safe = event.policy === 'safe';
      if (kind === 'idor' && event.type === 'post') {
        if (unsafe && record?.status === 200 && record.path === `/api/lab/vulnerable/posts/${post?.id}` && post?.visibility === 'private' && typeof post.body === 'string' && post.body.length) {
          if (post.ownerId === actor.id) facts[1] = true;
          else if (post.ownerId) { facts[2] = true; discoveries.add(String(post.id)); }
        }
        if (safe && record?.status === 403 && /^\/api\/posts\/\d+$/.test(record.path) && record.data?.error === 'FORBIDDEN' && !post) safeComparisons.add(record.path.split('/').pop());
      }
      if (kind === 'sqli' && event.type === 'search' && record?.status === 200 && record.data?.dataset === 'sqli-practice' && Array.isArray(posts)) {
        if (unsafe && record.path === '/api/lab/vulnerable/search' && typeof record.query === 'string') {
          if (record.query.trim() && posts.length && posts.every(p => p.visibility === 'public')) facts[1] = true;
          if (posts.some(p => p.visibility === 'private' && typeof p.body === 'string' && p.body.length)) { facts[2] = true; discoveries.add(record.query); }
        }
        if (safe && record.path === '/api/search' && typeof record.query === 'string' && posts.every(p => p.visibility === 'public')) safeComparisons.add(record.query);
      }
      if (kind === 'xss' && record?.status === 200 && record.path === '/api/lab/xss' && record.data?.mode === event.policy) {
        if (unsafe && event.type === 'preview' && facts[0] && typeof event.text === 'string' && event.text.trim() && !/[<>&]/.test(event.text)) facts[1] = true;
        if (unsafe && event.type === 'execution' && facts[1] && typeof event.text === 'string') { facts[2] = true; discoveries.add(event.text); }
        if (unsafe && event.type === 'exposure' && facts[2] && event.executed === true && discoveries.has(event.text) && event.exposure?.victimId === 'user-b' && /^VULNLAB-B-[A-F0-9]{12}$/.test(event.exposure.secret)) {
          facts[3] = true; exposures.set(event.text, event.exposure.secret);
        }
        if (event.type === 'victim-review' && facts[3] && exposures.has(event.text)) facts[4] = true;
        if (safe && event.type === 'preview' && facts[4] && event.executionDetected !== true && typeof event.text === 'string' && exposures.has(event.text) && typeof record.data.document === 'string') {
          const escaped = event.text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
          if (record.data.document.includes(escaped)) { safeComparisons.add(event.text); facts[5] = true; }
        }
      }
      if (kind === 'authz' && event.type === 'report' && record?.path === '/api/lab/authz') {
        if (unsafe && actor.role === 'user' && record.status === 200 && record.data?.user?.id === actor.id && record.data.user.role === 'user' && typeof record.data.report === 'string') facts[1] = true;
        if (safe && actor.role === 'user' && record.status === 403 && record.data?.error === 'FORBIDDEN') facts[2] = true;
        if (facts[3] && safe && actor.role === 'admin' && record.status === 200 && record.data?.user?.id === actor.id && record.data.user.role === 'admin' && typeof record.data.report === 'string') facts[4] = true;
      }
      // Free exploration can gather the same evidence in any order, without opening hints.
      if (kind !== 'authz' && kind !== 'xss') facts[3] = [...discoveries].some(value => safeComparisons.has(value));
      return snapshot();
    },
  };
}
