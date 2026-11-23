export const steps = ["취약점 개념 이해", "취약점 발생 원리", "실제 공격 시나리오", "취약한 코드 분석", "방어 및 대응 방법", "이해도 확인 및 실습"];
export type Quiz = {
    question: string;
    options: string[];
    answer: number;
    explanation: string;
};
export type Course = {
    id: string;
    title: string;
    subtitle: string;
    minutes: number;
    lab: string;
    concept: string[];
    analogy: string;
    distinction: string;
    flow: string[];
    mechanism: string[];
    normal: string;
    vulnerable: string;
    scenario: string;
    requests: [
        string,
        string
    ];
    impact: string;
    bad: string[];
    safe: string[];
    danger: number[];
    notes: string[];
    defenses: string[];
    mistakes: string;
    verification: string;
    quizzes: Quiz[];
};
export const courses: Course[] = [
    {
        id: "idor", title: "IDOR", subtitle: "데이터 번호와 접근 권한은 다릅니다", minutes: 20, lab: "http://127.0.0.1:4400/?lab=idor",
        concept: ["IDOR(Insecure Direct Object Reference)는 요청에 들어 있는 객체 식별자로 데이터를 찾으면서, 그 데이터를 요청자가 읽어도 되는지 확인하지 않는 접근 제어 취약점입니다. 객체는 게시글, 주문, 파일처럼 개별적으로 구분하는 데이터를 뜻합니다.", "로그인 성공은 사용자 신원만 증명합니다. 다른 사람의 비공개 글을 볼 권리까지 주지는 않습니다. URL의 번호뿐 아니라 요청 본문이나 파일 이름을 바꾸는 경우에도 발생할 수 있습니다.", "읽기 API라면 비공개 정보가 노출되고, 수정·삭제 API라면 다른 사람의 데이터가 바뀔 수 있습니다. 이 로컬 실습은 가상 비공개 게시글 조회만 다룹니다."],
        analogy: "도서관 보관함 번호를 안다고 그 안의 물건을 가져갈 수는 없습니다. 번호는 물건을 찾는 표지이고, 열쇠를 가진 사람인지 확인하는 과정이 별도로 필요합니다.",
        distinction: "IDOR는 ‘이 데이터에 접근할 수 있는가?’라는 객체 단위 권한 문제입니다. 권한 검증 과정에서는 ‘이 관리자 기능을 사용할 수 있는가?’라는 역할 단위 문제를 배웁니다. 둘 다 접근 제어 실패지만 검사 대상이 다릅니다.",
        flow: ["A의 세션 + 글 번호", "서버가 글 조회", "공개 여부·소유자 검사", "허용된 글만 응답"],
        mechanism: ["브라우저가 세션 쿠키와 게시글 번호를 전송하면 서버는 쿠키로 사용자를 식별합니다. 요청자가 보낸 ownerId를 신뢰해서는 안 됩니다.", "서버는 번호로 글을 찾은 뒤 공개 글인지, 비공개라면 소유자가 현재 사용자인지 검사해야 합니다. 취약 모드는 이 두 번째 경계를 생략합니다.", "목록에서 남의 글을 숨겨도 상세 API를 직접 호출할 수 있습니다. 목록과 상세 조회 양쪽에 같은 접근 정책을 적용해야 합니다."],
        normal: "A → 자신의 101번 글 → 소유자 일치 → 200. 공개 글 201은 다른 사용자도 읽을 수 있습니다.",
        vulnerable: "A → B의 102번 글 → 로그인만 검사 → 200. 안전 API는 같은 요청을 403으로 거부합니다.",
        scenario: "가상 커뮤니티에서 A는 자신의 여행 메모(101)를 읽고 있습니다. 주소의 번호를 B의 독서 메모(102)로 바꿉니다. 두 요청의 사용자 세션은 동일하며 객체 번호만 달라집니다.",
        requests: ["GET /api/lab/vulnerable/posts/101 HTTP/1.1\nCookie: <A의 실습 세션>\n\n200 OK\n{ post: { id: 101, ownerId: 'user-a', … } }", "GET /api/lab/vulnerable/posts/102 HTTP/1.1\nCookie: <동일한 A의 실습 세션>\n\n200 OK · 취약 모드\n{ post: { id: 102, ownerId: 'user-b', … } }\n\nGET /api/posts/102 → 403 Forbidden · 안전 API"],
        impact: "B의 비공개 제목과 본문이 A에게 노출됩니다. 번호가 존재한다는 사실과 그 글을 읽을 권한이 있다는 사실을 분리해서 판단해야 합니다.",
        bad: ["if (!user) throw new HttpError(401, 'LOGIN_REQUIRED', '로그인 필요');", "const post = store.posts.find(p => p.id === id);", "if (!post) throw new HttpError(404, 'NOT_FOUND', '글 없음');", "return post;"],
        safe: ["const post = store.posts.find(p => p.id === id);", "if (!post) throw new HttpError(404, 'NOT_FOUND', '글 없음');", "const allowed = post.visibility === 'public' || post.ownerId === user?.id;", "if (!allowed) {", "  throw new HttpError(user ? 403 : 401, 'DENIED', '접근 거부');", "}", "return post;"], danger: [4],
        notes: ["취약 코드 1행은 신원만 확인합니다. 2~3행은 글의 존재를 확인하지만 소유권은 확인하지 않습니다.", "취약 코드 4행에서 접근 정책 없이 응답이 나갑니다. 안전 코드 3행은 공개 글 또는 본인 글만 허용합니다.", "안전 코드 4~6행은 권한이 없을 때 응답 전에 중단합니다. 실습 서버의 공개 글 정책까지 반영한 축약 예시입니다."],
        defenses: ["서버 세션으로 사용자를 식별하고, 객체를 반환하기 직전에 공개·소유권·공유 정책을 평가합니다.", "목록, 상세, 다운로드, 수정·삭제 각각에서 객체 단위 검사를 적용합니다. 가능하면 권한 범위를 포함한 조회 조건으로 중앙화합니다.", "노출을 발견하면 해당 경로를 차단·수정하고 접근 로그에서 다른 사용자 데이터 조회 범위를 조사합니다. 민감한 본문은 로그에 남기지 않습니다."],
        mistakes: "UUID나 추측하기 어려운 번호로 바꾸기, 목록에서 링크만 제거하기, 요청 본문의 ownerId를 믿기는 소유권 검사 대체 수단이 아닙니다.",
        verification: "A→101 허용, A→102 거부, B→102 허용, 비로그인→비공개 거부, 공개 글→허용을 함께 확인합니다. 남의 글을 막다가 공개 글까지 막지 않았는지도 확인하세요.",
        quizzes: [
            { question: "A가 로그인한 상태로 B의 비공개 글 번호를 요청했습니다. 핵심 검사는?", options: ["번호의 길이", "현재 사용자의 객체 접근 권한", "로그인 버튼 표시"], answer: 1, explanation: "로그인은 신원을 확인할 뿐입니다. 서버가 해당 글의 소유권 또는 공유 정책을 검사해야 합니다." },
            { question: "실습의 공개 글 201에 적용할 정책은?", options: ["소유자만 허용", "모두 거부", "공개 여부를 확인하고 읽기 허용"], answer: 2, explanation: "실습의 정상 정책은 공개 글 또는 본인 소유 글을 허용합니다. 무조건 소유자만 허용하면 정상 기능도 깨집니다." },
            { question: "번호를 UUID로 바꾸면 IDOR가 해결될까요?", options: ["아니요, 권한 검사가 필요합니다", "네, 추측이 어려우면 충분합니다", "클라이언트에서만 검사하면 됩니다"], answer: 0, explanation: "식별자는 다른 경로로 알려질 수 있습니다. 식별자의 복잡성과 접근 허용 여부는 별개입니다." },
        ],
    },
    {
        id: "sqli", title: "SQL Injection", subtitle: "입력값이 데이터베이스 명령이 되는 순간", minutes: 25, lab: "http://127.0.0.1:4400/?lab=sqli",
        concept: ["SQL은 데이터베이스에 어떤 데이터를 조회할지 전달하는 명령 언어입니다. SQL Injection은 외부 입력이 SQL 구문의 일부로 해석되어 원래 조회 조건을 바꾸는 취약점입니다.", "검색어를 쿼리 문자열에 이어 붙이면 따옴표, 논리 연산자, 주석이 입력값을 넘어 명령으로 동작할 수 있습니다. 입력을 데이터로만 전달하는 경계가 사라지는 것이 원인입니다.", "실제 서비스에서는 정보 노출이나 데이터 변경으로 이어질 수 있습니다. 이 실습은 별도 메모리 DB의 제한된 단일 SELECT로 공개 조건 우회만 관찰하며, 운영 DB를 사용하지 않습니다."],
        analogy: "주문서의 ‘요청 사항’ 칸에 적힌 문장을 주방의 운영 지시로 받아들이는 상황입니다. 파라미터 바인딩은 요청 사항을 정해진 칸의 값으로만 전달해 주문서 구조를 바꾸지 못하게 합니다.",
        distinction: "SQL Injection은 DB가 입력을 명령으로 해석하는 문제입니다. XSS는 브라우저가 입력을 코드로 해석하는 문제입니다. 해석하는 주체와 방어 경계를 구분하세요.",
        flow: ["검색어 q 전송", "서버가 SQL 구성", "DB가 구문·값 해석", "검색 결과 응답"],
        mechanism: ["정상 검색은 visibility = 'public' 조건과 제목 검색 조건을 모두 만족하는 행만 반환합니다. AND는 두 조건이 참이어야 한다는 뜻입니다.", "문자열 결합으로 넣은 작은따옴표는 검색 문자열을 닫을 수 있습니다. OR 1=1은 항상 참인 조건을 더하고, --는 뒤의 문자열을 주석으로 처리합니다. AND가 OR보다 먼저 평가되므로 공개 조건 밖의 행도 선택됩니다.", "바인딩은 고정된 SQL의 ? 자리에 값을 별도로 전달합니다. 값 안의 따옴표가 SQL 문법으로 다시 해석되지 않습니다. prepare()를 호출해도 이미 문자열 결합을 했다면 안전해지지 않습니다."],
        normal: "‘산책’ 검색 → 공개 산책 안내만 반환. 비공개 산책 메모는 제외됩니다.",
        vulnerable: "' OR 1=1 -- 입력 → 공개 조건 우회 → 가상 비공개 행까지 반환. 안전 모드는 입력 전체를 검색어로 처리합니다.",
        scenario: "가상 커뮤니티의 검색 DB에는 공개 글 1001·1002와 비공개 글 1003·1004가 있습니다. 사용자는 ‘산책’을 검색하지만 공격자는 제목 대신 조건을 바꾸는 문자열을 보냅니다.",
        requests: ["GET /api/lab/vulnerable/search?q=%EC%82%B0%EC%B1%85 HTTP/1.1\nCookie: <실습 세션>\n\n200 OK\nposts: [1001 · 공개 산책 안내]", "GET /api/lab/vulnerable/search?q=%27%20OR%201%3D1%20--%20 HTTP/1.1\nCookie: <동일한 실습 세션>\n\n200 OK · posts: [1001, 1002, 1003, 1004]\n\nGET /api/search?q=<동일한 값을 URL 인코딩>\n200 OK · posts: [] · 입력을 문자로 검색"],
        impact: "읽을 수 없어야 할 가상 비공개 기록이 결과에 포함됩니다. HTTP 200 자체는 성공 판정이 아닙니다. 반환된 행의 공개 여부와 ID를 비교하세요.",
        bad: ["const prefix = \"SELECT id, title, body, visibility FROM search_posts WHERE visibility = 'public' AND title LIKE \";", "const sql = prefix + \"'%\" + query + \"%' ORDER BY id LIMIT 20\";", "const statement = db.prepare(sql);", "return statement.all();"],
        safe: ["const prefix = \"SELECT id, title, body, visibility FROM search_posts WHERE visibility = 'public' AND title LIKE \";", "const statement = db.prepare(prefix + \"? ESCAPE '!' ORDER BY id LIMIT 20\");", "const escaped = query.replace(/[!%_]/g, value => '!' + value);", "const pattern = '%' + escaped + '%';", "return statement.all(pattern);"], danger: [2],
        notes: ["취약 코드 2행은 입력을 SQL 본문에 붙입니다. DB에 전달되기 전에 명령과 데이터가 합쳐집니다.", "안전 코드 2행은 입력 없이 쿼리 구조를 고정하고 5행에서 값만 바인딩합니다. 이는 로컬 SQLite API의 .all(pattern) 사용 방식입니다.", "안전 코드 3~4행은 LIKE의 %와 _도 일반 문자로 검색하도록 처리합니다. 이 처리는 검색 의미를 보존하기 위한 것이며 SQL Injection을 막는 핵심은 바인딩입니다."],
        defenses: ["모든 외부 입력값에 파라미터 바인딩을 적용하고, 문자열을 붙여 만든 SQL을 prepare하는 패턴을 제거합니다.", "테이블·열 이름이나 정렬 방향은 보통 값 파라미터로 바인딩할 수 없습니다. 고정된 허용 목록에서 서버가 선택하도록 구성합니다.", "DB 최소 권한, 오류 메시지 제한, 접근 기록을 추가합니다. 이 실습의 단일 SELECT 제한도 보조 경계이며 바인딩을 대신하지 않습니다."],
        mistakes: "작은따옴표만 제거하기, 공격 문자열을 몇 개 차단하기, prepare()라는 이름만 보고 안전하다고 판단하기는 우회되거나 정상 입력을 깨뜨립니다.",
        verification: "같은 검색어와 공격 입력을 두 모드에 보냅니다. 공개 글 검색은 유지되고 비공개 글은 나오지 않아야 합니다. %, _, !를 검색할 때 의도한 문자 검색이 유지되는지도 확인합니다.",
        quizzes: [
            { question: "db.prepare()를 사용했지만 그 전에 입력을 SQL에 이어 붙였습니다. 안전한가요?", options: ["항상 안전합니다", "문자열 길이가 짧으면 안전합니다", "아니요, 입력이 이미 구문에 포함됩니다"], answer: 2, explanation: "prepare는 이미 합쳐진 SQL도 해석합니다. 고정 쿼리와 별도로 바인딩한 값으로 분리해야 합니다." },
            { question: "파라미터에 작은따옴표가 있으면 어떻게 되나요?", options: ["문자열 값의 일부로 처리됩니다", "자동으로 조건이 추가됩니다", "모든 행이 삭제됩니다"], answer: 0, explanation: "바인딩한 값은 SQL 문법으로 재해석되지 않습니다. 따옴표가 포함된 정상 검색어도 데이터로 처리합니다." },
            { question: "안전 코드가 LIKE의 %와 _를 이스케이프하는 주된 이유는?", options: ["인증을 대신하려고", "와일드카드를 일반 문자로 검색하려고", "열 이름을 바인딩하려고"], answer: 1, explanation: "LIKE 패턴 의미와 SQL 구문 안전성은 별개입니다. 바인딩이 구문 경계를 지키고 LIKE 이스케이프는 문자 검색 의미를 지킵니다." },
        ],
    },
    {
        id: "xss", title: "XSS", subtitle: "사용자 입력이 브라우저에서 코드로 실행되는 문제", minutes: 25, lab: "http://127.0.0.1:4400/lab/xss",
        concept: ["XSS는 Cross-Site Scripting의 약자입니다. 웹사이트가 사용자 입력을 안전하게 출력하지 않아, 입력에 담긴 코드가 브라우저에서 실행되는 취약점입니다.", "댓글에 ‘안녕하세요’를 입력하면 화면에는 글자만 나와야 합니다. 하지만 태그나 이벤트 코드를 넣었을 때 브라우저가 이를 명령으로 해석하면 문제가 생길 수 있습니다.", "실제 서비스에서는 화면을 바꾸거나 가짜 입력창으로 사용자를 속이고, 사용자 권한으로 원치 않는 동작을 수행할 수 있습니다. 이번 학습에서는 그 원인과 안전한 출력 방법을 비교합니다."],
        analogy: "전광판에 손님 메시지를 글자로 보여줘야 하는데, 메시지 속 제어 명령까지 실행하는 상황입니다. 출력 인코딩은 제어 기호를 화면에 보일 문자로 바꿉니다.",
        distinction: "저장형은 악성 입력이 저장되어 다른 방문자에게 전달되고, 반사형은 요청의 입력이 응답에 되돌아옵니다. DOM 기반 XSS는 클라이언트의 DOM 처리에서 발생합니다. 이번 미리보기 실습을 저장형 공격으로 혼동하지 마세요.",
        flow: ["댓글 입력", "서버가 HTML 문서 구성", "브라우저가 HTML 파싱", "태그·이벤트 해석"],
        mechanism: ["정상 텍스트 ‘안녕하세요’는 HTML 문서 안에서 글자로 보입니다. 그러나 <와 >가 그대로 삽입되면 브라우저는 이를 태그 경계로 해석할 수 있습니다.", "예를 들어 SVG의 onload 속성은 요소를 불러올 때 실행할 코드를 담습니다. 입력을 HTML에 그대로 삽입하면 입력자가 만든 이벤트 코드가 실행될 수 있습니다.", "HTML 텍스트 문맥에서는 &를 &amp;로, <를 &lt;로 변환해 태그 생성을 막습니다. URL·속성·스크립트 문맥에는 각각 맞는 검증과 인코딩이 필요하며 HTML 인코딩 하나로 모두 해결할 수 없습니다."],
        normal: "안녕하세요 → HTML 텍스트 노드 → 댓글만 표시됩니다.",
        vulnerable: "SVG 이벤트 입력 → 실제 SVG 요소 → 이벤트 실행. 안전 모드는 꺾쇠까지 글자로 표시합니다.",
        scenario: "가상 게시판에서 댓글을 저장하기 전에 미리보기로 확인합니다. 사용자는 인사말을 넣지만 공격자는 <svg onload=alert(1)>를 넣어 입력이 HTML로 해석되는지 확인합니다. 이 학습 화면의 예시는 실행되지 않는 텍스트입니다.",
        requests: ["POST /api/lab/xss HTTP/1.1\nContent-Type: application/json\nCookie: <실습 세션>\n\n{\"mode\":\"vulnerable\",\"text\":\"안녕하세요\"}\n\n200 OK · document 내부: <div>안녕하세요</div>", "POST /api/lab/xss HTTP/1.1\nContent-Type: application/json\nCookie: <동일한 실습 세션>\n\n{\"mode\":\"vulnerable\",\"text\":\"<svg onload=alert(1)>\"}\n\n200 OK · document 내부에 SVG 태그 포함\nmode=safe → &lt;svg onload=alert(1)&gt;"],
        impact: "응답을 받았다는 사실보다 브라우저가 입력을 실행했는지 확인해야 합니다. 로컬 실습은 alert를 감지 신호로 바꾸며 네트워크·쿠키·부모 페이지 접근을 제한합니다. 실제 서비스의 세션 탈취 결과를 재현하는 실습은 아닙니다.",
        bad: ["const content = input;", "const document =", "  '<div>' + content + '</div>';", "return document;"],
        safe: ["function escapeHtml(value: string): string {", "  return value", "    .replace(/&/g, '&amp;')", "    .replace(/</g, '&lt;')", "    .replace(/>/g, '&gt;')", "    .replace(/[\"']/g, c => c === '\"' ? '&quot;' : '&#39;');", "}", "const content = escapeHtml(input);", "const document =", "  '<div>' + content + '</div>';", "return document;"], danger: [3],
        notes: ["1행: 사용자가 입력한 내용을 content 변수에 저장합니다.", "2~3행: 원본 입력을 HTML 문자열에 그대로 결합합니다. 취약점은 3행에서 입력이 HTML 코드의 일부가 되는 데 있습니다.", "4행: 문자열을 반환합니다. 이후 브라우저가 이를 HTML로 읽으면 입력의 태그와 이벤트도 해석됩니다."],
        defenses: ["일반 텍스트는 HTML 코드로 직접 삽입하지 않습니다. 댓글 요소의 textContent나 React의 기본 문자열 출력을 사용합니다.", "출력 위치에 맞게 처리합니다. HTML 텍스트는 인코딩하고, 속성과 URL은 각각의 문법과 허용값을 검사합니다. 스크립트 문자열에 입력을 직접 넣지 않습니다.", "서식 있는 HTML이 꼭 필요하면 검증된 HTML 정화 도구로 위험한 태그와 속성을 제한합니다. 정화는 HTML에서 위험한 부분을 제거하는 처리입니다.", "CSP(콘텐츠 보안 정책)로 실행 가능한 스크립트 등을 제한합니다. 추가 방어 수단이며 안전한 출력 처리나 정화를 대신하지 않습니다."],
        mistakes: "<script>만 제거하면 이벤트 속성 등 다른 실행 경로가 남습니다. innerHTML이나 dangerouslySetInnerHTML로 기본 이스케이프를 우회하거나, CSP만으로 출력 처리를 대체하지 마세요.",
        verification: "인사말과 SVG 입력을 두 모드에 넣습니다. 안전 모드에서는 실행 신호가 없어야 하고 원본 문자열이 글자로 보여야 합니다. &와 꺾쇠가 중복 인코딩되어 잘못 표시되지 않는지도 확인하세요.",
        quizzes: [
            { question: "댓글을 innerHTML에 그대로 넣었습니다. 가장 먼저 확인할 문제는 무엇인가요?", options: ["서버의 실행 속도", "사용자 입력이 HTML로 해석될 가능성", "데이터베이스 저장 공간"], answer: 1, explanation: "innerHTML은 입력을 HTML로 해석해 요소를 만듭니다. 이벤트 코드가 실행될 수 있으므로 일반 댓글에는 textContent 등 안전한 출력 방식을 사용해야 합니다." },
            { question: "일반 댓글을 DOM에 표시할 때 적절한 방법은?", options: ["innerHTML에 그대로 대입", "script 태그만 지우기", "textContent로 대입"], answer: 2, explanation: "textContent는 입력을 텍스트로 표시합니다. HTML 구조를 만들지 않아 이벤트 속성도 코드로 실행되지 않습니다." },
            { question: "HTML 텍스트용 인코딩을 모든 출력 위치에 그대로 적용해도 될까요?", options: ["아니요, 출력 문맥에 맞춰야 합니다", "네, URL과 스크립트도 같습니다", "CSP가 있으면 인코딩이 필요 없습니다"], answer: 0, explanation: "HTML 텍스트, 속성, URL, JavaScript는 해석 규칙이 다릅니다. 문맥에 맞는 처리와 안전한 API가 필요합니다." },
        ],
    },
    {
        id: "authz", title: "권한 검증", subtitle: "로그인 이후에도 확인해야 하는 권한", minutes: 20, lab: "http://127.0.0.1:4400/lab/authz",
        concept: ["인증(Authentication)은 ‘누구인가’를 확인하고, 인가(Authorization)는 ‘이 행동을 할 수 있는가’를 판단합니다. 로그인한 일반 사용자도 관리자 전용 기능에는 접근할 수 없어야 합니다.", "권한 검증이 누락되면 일반 사용자가 API를 직접 호출해 관리자 전용 정보를 보거나 작업을 수행할 수 있습니다. 메뉴 숨김은 화면 구성일 뿐 서버의 접근 제어가 아닙니다.", "이번 실습에서는 일반 사용자와 관리자가 같은 통계 API를 요청합니다. 취약 모드는 로그인만 검사하고, 안전 모드는 서버가 확인한 역할까지 검사합니다."],
        analogy: "회사 출입증으로 건물에 들어왔다고 재무실까지 들어갈 수는 없습니다. 출입증 확인이 인증이라면, 재무실 문에서 업무 권한을 확인하는 것이 인가입니다.",
        distinction: "IDOR는 ‘누구의 글인가?’를 확인하는 객체 단위 문제입니다. 이 과정은 ‘관리자 통계 기능을 사용할 역할인가?’를 확인합니다. 실제 서비스에서는 역할 검사와 객체 소유권 검사가 함께 필요할 수 있습니다.",
        flow: ["세션 쿠키 전송", "서버가 사용자 식별", "서버 역할·정책 검사", "관리자만 통계 응답"],
        mechanism: ["서버는 세션 쿠키를 검증해 사용자와 역할을 가져옵니다. 브라우저가 보내는 role=admin, 숨겨진 필드, localStorage 값은 권한의 근거가 될 수 없습니다.", "취약 API는 사용자가 존재하면 통계를 반환합니다. 인증 경계는 있지만 관리자 역할을 검사하는 인가 경계가 빠져 있습니다.", "안전 API는 로그인하지 않았으면 401, 로그인했지만 관리자 권한이 없으면 403으로 중단합니다. 관리자는 200을 받습니다. 모든 보호 경로에 일관된 정책이 필요합니다."],
        normal: "관리자 세션 → 역할 admin 확인 → 200과 가상 통계. 일반 사용자는 403.",
        vulnerable: "일반 사용자 세션 → 로그인만 확인 → 200과 관리자 전용 가상 통계.",
        scenario: "커뮤니티 관리 대시보드는 관리자에게만 통계를 보여줍니다. 일반 사용자 A의 화면에는 버튼이 없지만 A가 API 주소를 직접 요청합니다. 버튼 유무와 관계없이 서버가 거부해야 합니다.",
        requests: ["GET /api/lab/authz?mode=safe HTTP/1.1\nCookie: <관리자 실습 세션>\n\n200 OK\nreport: 관리자 전용 가상 통계: 실습 회원 3명", "GET /api/lab/authz?mode=vulnerable HTTP/1.1\nCookie: <일반 사용자 A의 세션>\n\n200 OK · 같은 관리자 통계 노출\n\nGET /api/lab/authz?mode=safe · 동일한 A 세션\n403 Forbidden"],
        impact: "일반 사용자가 관리자 전용 가상 통계에 접근합니다. 이 실습은 읽기 동작이지만 실제 기능에서는 설정 변경이나 사용자 관리로 영향이 확대될 수 있습니다.",
        bad: ["if (!user) throw new HttpError(401, 'LOGIN_REQUIRED', '로그인 필요');", "return { report: '관리자 전용 가상 통계: 실습 회원 3명' };"],
        safe: ["if (!user) throw new HttpError(401, 'LOGIN_REQUIRED', '로그인 필요');", "if (user.role !== 'admin') {", "  throw new HttpError(403, 'FORBIDDEN', '관리자 권한 필요');", "}", "return { report: '관리자 전용 가상 통계: 실습 회원 3명' };"], danger: [2],
        notes: ["두 예시의 user는 검증된 서버 세션에서 얻었다고 가정합니다. 클라이언트 입력으로 만든 user가 아닙니다.", "취약 코드 1행은 인증만 검사하고 2행에서 통계를 반환합니다. 로그인한 누구든 같은 결과를 받는 것이 문제입니다.", "안전 코드 2~4행에서 관리자 역할이 아니면 응답 전에 중단합니다. 권한 검사는 조회뿐 아니라 부작용이 생기는 작업보다 먼저 실행해야 합니다."],
        defenses: ["보호 API마다 서버 세션의 역할과 정책을 검사합니다. 기본은 거부로 하고 명시적으로 허용한 역할·행동만 통과시킵니다.", "공통 권한 검사 함수를 사용하되 모든 진입 경로에 적용됐는지 확인합니다. HTTP 메서드나 다른 URL로 같은 작업에 접근할 때도 검사해야 합니다.", "권한 변경·회수 정책을 세션 수명과 함께 설계하고, 과도한 역할 부여와 접근 로그를 점검합니다. 정보 노출 발견 시 정책을 수정하고 계정별로 재검증합니다."],
        mistakes: "관리자 메뉴만 숨기기, 브라우저가 보낸 역할을 신뢰하기, 로그인 여부만 검사하기, 한 API에만 검사를 추가하기는 권한 우회를 남깁니다.",
        verification: "비로그인 401, 일반 사용자 403, 관리자 200을 각각 확인합니다. 거부 응답에 통계가 섞이지 않는지, 일반 사용자 기능은 계속 동작하는지도 검사합니다.",
        quizzes: [
            { question: "로그인했지만 관리자 권한이 없는 사용자에게 적절한 상태 코드는?", options: ["200", "401", "403"], answer: 2, explanation: "401은 인증이 필요할 때, 403은 신원은 확인됐지만 접근 권한이 없을 때 사용합니다." },
            { question: "역할 검사의 신뢰할 수 있는 근거는?", options: ["검증된 서버 세션의 역할", "요청 본문의 role", "관리자 버튼 표시 여부"], answer: 0, explanation: "클라이언트 입력은 변경할 수 있습니다. 서버가 검증한 신원과 권한 정책을 기준으로 판단해야 합니다." },
            { question: "IDOR와 이번 관리자 권한 검증 과정의 차이는?", options: ["IDOR는 인증과 무관한 디자인 문제", "객체 접근 권한과 기능·역할 권한의 차이", "관리자는 모든 비공개 글을 자동으로 읽음"], answer: 1, explanation: "둘 다 접근 제어입니다. 실습의 글 정책은 공개 또는 소유자이며 관리자 역할만으로 다른 사람의 비공개 글이 허용되지는 않습니다." },
        ],
    },
];
export function getCourse(id: string) { return courses.find(course => course.id === id); }
