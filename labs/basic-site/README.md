# VulnLab 기본 실습 사이트 · IDOR 학습

## 같은 커뮤니티에서 가이드 선택

일반 영역의 상단 메뉴·브랜드·제목·푸터·검색 안내·검색 결과 메시지에는 취약점/개발/실습 표시를 노출하지 않습니다. 로그인 페이지의 학습용 계정 안내는 선택한 가이드 패널로 이동했습니다. 게시글 상세의 HTTP 요청 확인도 IDOR 가이드 패널에서만 제공합니다. `/lab/idor`의 기존 학습 화면은 그대로 유지합니다.

- `/`: 기존 일반 커뮤니티입니다. 학습 가이드 패널은 생성하지 않습니다.
- `/?lab=idor`: 같은 커뮤니티의 가이드 패널에서 IDOR 6단계를 끝까지 진행합니다. 기존 `/lab/idor`도 계속 사용할 수 있습니다. 두 화면은 `lessonPage.ts`의 학습·편집기 마크업, `lab.js`의 컨트롤러와 판정·퀴즈·코드 조회 로직을 공유합니다.
- `/?lab=sqli`: 같은 커뮤니티에 검색 학습 목표와 준비 안내만 표시합니다. SQL Injection 학습 UI는 아직 제공하지 않습니다.
- 미지원·빈 값·중복 `lab` 값은 일반 접속으로 처리합니다. 파라미터는 UI 선택 전용이며 취약 API 활성화와 무관합니다.

패널은 데스크톱에서 오른쪽에, 900px 이하에서는 본문 위에 표시합니다. 기본 펼침 상태의 네이티브 `details/summary`로 마우스·터치·키보드 접기/펼치기를 지원하며 접은 상태에서도 선택한 취약점 이름이 보입니다. IDOR의 단계·기준 요청·공격 성공·비교·퀴즈 상태는 패널 컨트롤러의 메모리에서 관리합니다. 접기·펼치기와 커뮤니티 내 목록·상세·뒤로/앞으로 이동은 이 DOM을 유지하므로 진도가 보존됩니다. 새로고침·가이드 이탈·로그인 전환·로그아웃 시에는 초기화됩니다.

일반 게시글 상세 조회에서 실행한 `requestPost()`의 실제 응답 기록을 `http-client.js`의 구독 채널로 전달합니다. 아직 조회하지 않았다면 요청 기록을 만들지 않습니다. 가이드에는 메서드·URL·게시글 ID·상태 코드·응답 본문을 표시합니다. user-a의 정상 비공개 글 조회를 수집한 뒤 **3단계** 버튼을 누르면 그 기록을 재사용하여 취약 API의 기준 요청을 실제 전송합니다. 이후 직접 ID를 수정·재전송하며 기존 성공 판정을 그대로 사용합니다. 공개 글 탐색은 공격 성공이 아니며 이미 수집한 기준 요청과 학습 완료를 지우지 않습니다.

가이드 선택은 로그인·로그아웃·게시글 상세·목록 탐색 링크에 유지됩니다. 정상 API 경로는 바뀌지 않습니다. **가이드 없이 일반 사이트 보기**를 누르면 `/`로 돌아갑니다. 기존 `/lab/idor`는 안내 패널을 붙이지 않고 그대로 제공합니다.

직접 브라우저에서 확인할 사항: 데스크톱 오른쪽 배치, 375px 정도의 모바일 상단 배치와 스크롤, summary를 클릭하거나 Enter/Space로 접기·펼치기, 접은 상태에서 게시판·검색 사용, user-a 로그인 → 자기 비공개 글 조회 → 가이드의 6단계 완료, 중간 목록·상세·뒤로/앞으로 탐색 시 진도와 패널 접힘 상태 유지, 로그아웃·새로고침 초기화. 자동 테스트는 실제 UI 이벤트 핸들러·커뮤니티 화면 교체·HTTP 요청 전달·6단계 완료와 기존 IDOR/SQLI 회귀를 검사합니다. DOM 대역을 사용하므로 실제 브라우저 레이아웃·포커스·네이티브 disclosure 동작 검증을 대신하지 않습니다.

## SQL Injection 검색 백엔드

Node.js 24.14.0의 내장 `node:sqlite`를 사용합니다. 추가 패키지·운영 DB·파일 DB를 사용하지 않습니다. 현재 Node에서는 SQLite 실험 기능 경고가 출력될 수 있습니다.

- 게시글 화면 아래 **게시글 검색**은 `GET /api/search?q=검색어`를 호출합니다. 제목의 부분 일치 검색이며 파라미터 바인딩 및 공개 범위 조건을 적용합니다. `%`, `_`도 검색어 문자로 취급합니다. 빈 검색어는 공개 실습 글 전체를 반환합니다.
- `GET /api/lab/vulnerable/search?q=검색어`는 로그인과 별도 활성화가 필요합니다. SQL 문자열 결합을 교육 목적으로 사용합니다. IDOR 활성화 여부와 독립적입니다. 전체 SQLI 학습 UI는 아직 제공하지 않습니다.
- 두 검색 API는 서버 인스턴스별 동일한 `:memory:` SQLite의 `search_posts`를 조회합니다. 검색 결과의 ID 1001~1004는 기존 게시판·IDOR 저장소와 별도 가상 데이터입니다. 기존 게시글 상세 페이지로 연결하지 않습니다. 서버 종료 시 DB를 닫으며 재시작하면 초기화됩니다.

```powershell
Set-Location D:\likelion-repo
$env:NODE_ENV = "development"
$env:BASIC_SITE_ENABLE_SQLI = "1"
# 기존 IDOR도 사용할 때만 추가
$env:BASIC_SITE_ENABLE_IDOR = "1"
npm.cmd --prefix labs/basic-site start
```

기본적으로 SQLI 취약 API는 404입니다. `NODE_ENV`가 명시적인 `development` 또는 `test`가 아니면 SQLI 활성화를 거부합니다. `production`에서는 기존 정책대로 서버 자체를 실행할 수 없습니다. 서버는 `127.0.0.1`에 바인딩하고 원격 소켓 주소·Host를 검사하며 프록시 헤더를 신뢰하지 않습니다. 검색 API에는 CORS를 허용하지 않습니다.

정상 검색 예: `/api/search?q=산책` → 공개 글 한 개. 로그인 후 취약 검색에 `' OR 1=1 --`를 URL 인코딩하여 전달하면 공개 범위 조건이 우회되어 가상 비공개 글까지 실제 SQL 결과로 반환됩니다. 정상 API에 같은 입력을 전달하면 검색 문자열로 처리되어 결과가 없습니다.

SQLite는 초기 가상 데이터 삽입 후 `query_only=ON`, `trusted_schema=OFF`, `temp_store=MEMORY`, defensive 모드를 적용합니다. authorizer는 단일 SELECT, `main.search_posts`의 네 필드 읽기, LIKE만 허용합니다. 다른 테이블·스키마·함수·중첩/UNION/재귀 SELECT·쓰기·DDL·PRAGMA 변경·ATTACH·확장 로딩은 허용하지 않습니다. 취약 입력의 세미콜론도 거부합니다. 검색어는 최대 200자이며 제어문자를 거부합니다. 이 제한은 로컬 가상 데이터의 검색 조건 우회만 재현하기 위한 것입니다.

검증: `npm.cmd test --prefix labs/basic-site`는 기존 로그인·게시판·IDOR 6단계와 함께 `tests/search.node.ts`의 실제 SQL·HTTP·SQLite 권한 제한 테스트를 실행합니다. `npm.cmd run typecheck --prefix labs/basic-site`, 루트의 `npm.cmd exec eslint -- labs/basic-site`로 검사합니다.

## IDOR 6단계 학습

`/lab/idor`는 개념·목표 → 게시판과 정상 GET 요청 관찰 → ID 수정·재전송 → 실제 응답 분석 → 원본 코드·정상 API 비교 → 이해도 확인·완료 순서로 진행합니다. user-a로 로그인한 뒤 시작하세요.

```powershell
Set-Location D:\likelion-repo
$env:NODE_ENV = "development"
$env:BASIC_SITE_ENABLE_IDOR = "1"
npm.cmd --prefix labs/basic-site start
```

- 힌트 버튼은 관찰 지점 → 로그인과 권한의 차이 → 주변 번호 탐색 순으로 안내합니다. 정확한 공격 ID는 알려주지 않습니다.
- 공격 성공은 기존 기준 요청·현재 사용자·대상 ID·타인 소유·비공개·본문 반환 조건을 유지합니다. HTTP 200만으로 성공 처리하지 않습니다.
- 결과 분석은 실제 응답이 검증된 후에만 표시합니다. 정상 API는 같은 ID·세션에서 403 FORBIDDEN 및 게시글 미반환을 확인해야 합니다.
- 학습 완료는 공격 재현 + 정상 API 비교 + 퀴즈 3문제 전부 정답이 모두 필요합니다. 답 수정 또는 새 공격 시 관련 완료 상태를 초기화합니다. 새로고침하면 전체 학습 상태가 초기화됩니다.
- 코드 비교는 서버 시작 시 `src/features/posts.ts`의 `getVulnerablePost`, `getPost`, `canReadPost` 선언을 그대로 읽습니다. 코드 변경 후 서버를 재시작하세요. `/api/lab/idor-code`는 실습 활성화와 로그인이 필요합니다.
- `public/lesson.js`에 퀴즈 채점·비교 판정·완료 조건·분석 데이터 추출을 분리했습니다. 단계 화면 구성은 `src/lessonPage.ts`에 있습니다. 다른 실습에서 흐름을 참고할 수 있지만 IDOR 판정 조건은 이 실습 전용입니다.

검증 명령: `npm.cmd test --prefix labs/basic-site`, `npm.cmd run typecheck --prefix labs/basic-site`, 루트에서 `npm.cmd exec eslint -- labs/basic-site`.

`tests/lesson-ui.node.js`는 실제 UI 이벤트 핸들러를 최소 DOM 대역과 실제 HTTP 서버에 연결해 단계 이동·완료 조건을 검사합니다. 브라우저 레이아웃 검증을 대신하지 않습니다. 직접 확인할 항목: 6단계 클릭 이동, 키보드·라디오 선택과 필수 입력, 좁은 화면의 요청·코드 가독성, 힌트 순서, 새로고침 초기화, 로그아웃·서버 비활성 상태. 테스트가 띄운 서버는 종료 시 자동으로 닫힙니다.

Node.js + TypeScript로 작성한 **로컬 개발 전용** 독립 사이트입니다. VulnLab 플랫폼·OAuth·Prisma DB·기존 Runner·VulnBoard를 사용하지 않습니다. Node.js 24.14 이상에서 TypeScript를 직접 실행하며 런타임 의존 패키지는 없습니다.

정상 로그인과 소유권 검사, 명시적으로 활성화하는 IDOR 학습과 SQL Injection 검색 실습을 제공합니다. XSS·관리자 권한 우회는 구현하지 않았습니다. 공개 배포용 격리·다중 사용자 샌드박스는 완성되지 않았습니다.

## 실행

```powershell
Set-Location D:\likelion-repo\labs\basic-site
npm.cmd start
```

`http://127.0.0.1:4400`에 접속합니다. VulnLab 플랫폼을 실행하지 않아도 됩니다. 소스 변경 시 자동 재시작하려면 `npm.cmd run dev`를 사용합니다. 기본 포트가 사용 중이면 기존 프로세스를 종료하지 말고 다른 포트로 실행합니다.

```powershell
$env:BASIC_SITE_PORT = "4401"
npm.cmd start
```

서버는 항상 `127.0.0.1`에 바인딩합니다. 임의의 바인딩 주소·외부 URL을 받지 않으며 `NODE_ENV=production` 실행은 거부합니다. `localhost`도 허용하지만 쿠키 호스트가 다르므로 탐색 중에는 접속 주소를 통일해주세요. 종료는 Ctrl+C입니다.

## 실습 전용 계정

| 아이디 | 비밀번호 | 역할 | 소유 비공개 글 |
|---|---|---|---|
| user-a | practice-a | 일반 사용자 | 101 |
| user-b | practice-b | 일반 사용자 | 102 |
| admin | practice-admin | 관리자 | 103 |

위 정보는 공개된 가상 실습 계정이며 실제 비밀번호를 입력하지 마세요. 관리자도 다른 사용자의 비공개 글을 읽을 수 없습니다. 이 단계에서 관리자 역할은 계정 정보이며 별도 관리자 기능을 제공하지 않습니다. 공개 글은 201, 202입니다.

## 페이지와 API

| 메서드 | 경로 | 동작 |
|---|---|---|
| GET | `/`, `/posts` | 게시글 목록 페이지. 브라우저가 `/api/posts` 호출 |
| GET | `/posts/:id` | 상세 페이지. 브라우저가 `/api/posts/:id` 호출 |
| GET | `/login` | 로그인 페이지·실습 계정 안내 |
| POST | `/api/auth/login` | JSON `{ "userId": "user-a", "password": "practice-a" }`로 로그인 |
| POST | `/api/auth/logout` | JSON `{}`로 세션 폐기 |
| GET | `/api/me` | 인증된 사용자 ID·이름·역할. 비로그인 401 |
| GET | `/api/posts` | 공개 글과 로그인 사용자 소유 비공개 글의 메타데이터. 본문 제외 |
| GET | `/api/posts/:id` | 공개 또는 본인 소유 게시글의 본문 |

비공개 상세 API는 비로그인 401, 타인 접근 403, 존재하지 않는 글 404를 반환합니다. 상세 HTML은 데이터 없는 공통 화면이며 실제 접근 결과는 API 응답으로 표시됩니다. API 오류에는 비공개 게시글 제목·소유자·본문을 포함하지 않습니다.

변경 요청은 정확히 일치하는 `Origin`과 `application/json`을 요구합니다. API 도구로 호출할 때는 `Origin: http://127.0.0.1:4400`과 로그인 응답의 쿠키를 직접 이어서 보내야 합니다. CORS 허용이나 외부 프록시를 제공하지 않습니다.

## 데이터와 구조

- `src/seed.ts`: 고정 가상 계정·게시글. 비밀번호는 기동 시 임의 salt와 scrypt로 해시합니다.
- `src/auth.ts`: 실습 전용 쿠키·서버 메모리 세션. 1시간 만료, 로그아웃·계정 전환 시 이전 세션 폐기. 서버 전체 로그인 시도는 분당 20회로 제한합니다.
- `src/store.ts`: 서버 인스턴스별 메모리 저장소. **디스크·SQLite·플랫폼 DB를 사용하지 않으며 재시작하면 초기화**됩니다.
- `src/features/posts.ts`: 게시글 접근 정책과 조회. 향후 기능별 모듈을 추가할 위치입니다.
- `src/routes.ts`, `http.ts`: HTTP 라우팅·JSON 처리·오류 응답.
- `src/pages.ts`, `public/`: 독립 UI와 실제 브라우저 API 호출. 게시글은 `textContent`로 출력합니다.
- `src/server.ts`: 로컬 바인딩·Host/Origin 검사·기동·종료.

게시글 데이터는 읽기 전용입니다. 플랫폼 세션이나 인증 쿠키를 해석하지 않습니다. 실습 인증 쿠키는 별도 이름이며 HttpOnly·SameSite=Strict입니다. 로컬 HTTP이므로 Secure 속성을 사용하지 않습니다. **쿠키는 포트로 격리되지 않으므로 별도 포트·쿠키 이름만으로 공개 배포용 격리가 확보되지는 않습니다.**

## 확인

루트 프로젝트의 개발 의존성이 이미 설치되어 있으면 아래 명령을 바로 사용할 수 있습니다. 이 폴더만 별도로 사용하는 경우 타입 검사용 의존성은 `npm.cmd install`로 설치합니다. 실행·HTTP 테스트에는 추가 의존성이 필요하지 않습니다.

```powershell
npm.cmd run typecheck
npm.cmd test
```

테스트는 임시 루프백 포트에 실제 서버를 띄워 세 계정 로그인, 본인·타인 글 접근, 로그아웃, 세션 만료, Host/Origin 검사, 입력 제한을 확인합니다. 종료 시 서버를 닫으며 플랫폼과 외부 서비스에는 요청하지 않습니다. 화면 자동화 테스트는 포함하지 않습니다.

## 다음 단계

요청 기록·편집·재실행, 취약/수정 상태, SQLite 검색, 댓글, 관리자 기능, 네 종류의 취약점 및 판정, 초기화 API, 플랫폼 연결, 컨테이너 격리는 후속 구현입니다. 취약 동작은 격리와 실행 범위를 먼저 확인한 뒤 추가해야 합니다.
