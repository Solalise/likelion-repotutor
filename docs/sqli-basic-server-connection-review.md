# 기초 SQLi 서버와 새 요청 편집기 연결 검토

## 결론

현재 연결하지 않는다. 기존 서버는 **로컬 개발 전용·인스턴스 단위 가상 데이터 실습**이며, VulnLab 사용자의 계정에 묶인 전용 샌드박스와 실행 승인 체계가 없다. 읽기 전용 SQL 제한과 사용자별 격리는 다른 조건이다. 이번 작업에서는 실행 API·프록시·외부 URL 요청 기능을 추가하지 않았고 새 편집기의 실행 버튼은 계속 비활성화했다.

기존 기초 사이트에서는 SQLi가 활성화되고 실습 계정으로 로그인한 경우 실제 HTTP/SQLite 검색 실습이 가능하다. 이것이 새 편집기의 실행 가능 상태를 의미하지 않는다.

## 기존 서버 조사

근거: `labs/basic-site/src/server.ts`, `routes.ts`, `auth.ts`, `store.ts`, `features/search.ts`, `public/http-client.js`, `public/sqli-lesson.js`.

### 실행 환경

- Node.js 24.14 이상에서 `node src/server.ts`로 기동. 기본 주소 `http://127.0.0.1:4400`. `BASIC_SITE_PORT`로 로컬 포트 변경 가능.
- SQLi는 기본 비활성. `BASIC_SITE_ENABLE_SQLI=1` 또는 생성 옵션 활성화와 명시적인 `NODE_ENV=development/test`가 필요하다. `production` 기동은 거부한다.
- `127.0.0.1` 바인딩, 실제 연결의 루프백 주소, 정확한 Host 검사. 변경 메서드는 동일 Origin 검사. 일반 API는 CORS를 허용하지 않으며 health만 비인증·무자격 증명 CORS를 제공한다.
- HTTP 요청 수신 제한 10초, 헤더 수신 5초, 헤더 수 30개. 이는 SQL 실행 중단 시간이나 새 실행기의 쌍별 요청 예산을 보장하지 않는다.
- 공개 다중 사용자 서비스의 관리형 샌드박스가 아니다. 배포된 VulnLab 서버의 localhost는 사용자의 PC가 아니라 VulnLab 서버 자신이므로 고정 4400 프록시로 연결할 수 없다.

### API

| 메서드·경로 | 인증·조건 | 데이터 |
|---|---|---|
| POST `/api/auth/login` | 정확한 로컬 Origin, JSON, 공개 실습 계정 | `{userId,password}` → `{user}` 및 전용 세션 쿠키 |
| POST `/api/auth/logout` | 동일 Origin·JSON | `{}` → `{ok:true}`, 쿠키 폐기 |
| GET `/api/me` | 실습 세션 필요 | `{user}` 또는 401 |
| GET `/api/search?q=...` | 비로그인 가능 | 안전한 바인딩 검색, 공개 가상 글만 반환 |
| GET `/api/lab/vulnerable/search?q=...` | SQLi 활성화 + 실습 세션 | 의도적 SQL 문자열 결합 검색 |
| GET `/api/lab/sqli-code` | SQLi 활성화 + 실습 세션 | `{file,line,snippet}` |
| GET `/api/health` | 비로그인 가능 | 서비스 이름과 실습 활성화 boolean. 사용자·sandbox ID·승인 증거 없음 |

검색 성공 응답은 `{posts:[{id,title,body,visibility}],dataset:"sqli-practice"}`. 오류는 `{error,message}`와 실제 HTTP 상태다. `q`는 정확히 1개만 허용하고 다른 키는 거부한다. 200자 초과·제어문자는 400, 취약 검색의 세미콜론은 400이다. SQL 오류도 400 `SEARCH_REJECTED`로 표시한다. 비로그인 취약 검색은 401, 비활성 API는 404다.

### 인증과 격리

- `createAuth`는 인스턴스 내부 Map에 랜덤 세션과 user ID를 저장한다. 만료 1시간, 최대 100개, 로그인 시도 제한은 인스턴스 전체 분당 20회다.
- `vulnlab_basic_session`은 HttpOnly·SameSite=Strict이며 로컬 HTTP라 Secure 속성이 없다. VulnLab OAuth/Prisma 사용자와 무관한 가상 계정이다. 쿠키는 포트별로 격리되지 않으며 공개 실습 계정은 플랫폼 권한 증명이 아니다.
- `createStore()`와 `createSearchDatabase()`는 서버 생성당 각 1회 호출된다. 게시판 fixture와 검색 SQLite는 분리되고 플랫폼 DB를 사용하지 않는다. **동일 서버 내 모든 실습 계정이 같은 검색 DB를 사용**한다. 라우터는 실습 로그인 유무만 검사하고 `searchDb.search(q,vulnerable)`에 사용자/세션 ID를 넘기지 않는다.
- SQLi DB는 `:memory:`이며 공개/비공개 가상 글 4개다. 파일 DB가 아니고 종료 시 폐기된다. 별도 서버 인스턴스는 세션 Map과 메모리 DB를 따로 생성하지만, 사용자에게 인스턴스를 할당·인증·회수하는 관리 계층은 없다.
- SQLite defensive/query_only, 확장 로딩 금지, 단일 SELECT와 지정 테이블·컬럼·LIKE만 허용하는 authorizer가 있다. mutation, schema/file 접근, 위험 함수·서브쿼리를 제한한다. 이 제한은 유용하지만 플랫폼 사용자별 샌드박스의 대체물이 아니다.

## 새 인터페이스와 비교

`src/lib/security-lab/sqliTypes.ts`의 계약을 그대로 유지했다.

| 새 인터페이스 | 기존 서버·브라우저 레코드 | 연결 시 필요한 처리 |
|---|---|---|
| `target.method="GET"`, `inputLocation="query"` | 검색 API도 GET/query | 형식 호환 |
| `target.apiPath`, `parameter` | 고정된 두 검색 경로, 파라미터는 `q`만 | 서버가 허용 목록에서 결정해야 함. 임의 AST 경로/파라미터와 호환되는 것은 아님 |
| `baseline.value`, `test.value` | `q`, 최대 200자·제어문자 금지 | 편집기의 512자 한도와 다름. 실행 경계에서 기존 제한 재사용 |
| `connectionId/repository/commitSha/findingId` | 기존 API에는 없음 | 플랫폼 권한과 원본 후보 연결을 별도 검증 |
| `runId`, `requestId`, `observedAt` | 기존 레코드에 없음 | 서버가 발급·기록해야 함 |
| `statusCode`, `body` | 브라우저 레코드의 `status`, `body`, `data` | 실제 응답을 매핑 가능. 오류 JSON도 보존 |
| `durationMs` | 기존 레코드에는 시간 계측 없음 | 실행기에서 단조 시간으로 계측 |
| `outcome/errorMessage` | HTTP 오류 JSON, fetch 예외 | 타임아웃·인증 차단·네트워크 오류를 구분하는 어댑터 필요 |
| `bodyTruncated` | 기존 클라이언트는 response.text 전체 읽기 | 응답 바이트 제한과 잘림 정책 필요 |
| `assessment/evidenceReferences` | 기초 SQLi 전용 비교 함수 | 서버에서 실행·대상·입력·응답 연계를 검증해야 함 |

기초 `compareSearchResponses`는 **같은 입력을 취약 API와 안전 API에 보내** 가상 비공개 글의 실제 노출 차이를 확인하는 실습 전용 기준이다. 새 편집기는 **같은 대상에 서로 다른 정상값·테스트값을 보내는 비교**다. 요청 의미가 다르므로 기존 판정을 그대로 대입하지 않는다. 가상 글/전용 dataset 판정은 외부 프로젝트의 SQLi 증거로 사용할 수 없다.

정상값·테스트값을 기존 취약 API에 각각 보내 실제 응답을 비교하는 것 자체는 로컬 단일 사용자 실습에서 가능하다. 하지만 이번 요구 조건인 플랫폼 사용자별 격리가 없으므로 새 편집기의 전송 기능은 연결하지 않는다. `checkBasicSite`의 health 조회나 기존 IDOR Runner 페어링도 SQLi 사용자별 격리·실행 승인 증거가 아니다.

## 관리형 환경에 연결하기 위한 최소 변경

1. 플랫폼 인증 사용자와 서버 발급 `sandboxId`를 연결하는 관리자 구현. 사용자/실행별 전용 인스턴스·세션·메모리 DB, 만료·초기화·종료·할당 수 제한을 보장하고 다른 사용자의 sandbox 접근을 거부한다. 코드가 인스턴스 생성기를 제공하는 것만으로 자동 격리가 성립하지 않는다.
2. 공개 실습 계정/브라우저 쿠키를 공유하지 않는 전용 실행 자격 증명을 구현한다. VulnLab OAuth/GitHub/Vercel 토큰을 대상에 전달하지 않는다. 서버 간 단기 자격 증명은 sandbox·사용자·경로·메서드·실행 승인에 묶는다.
3. 기존 `createBasicSite`, `createSearchDatabase`, 검색 API의 읽기 전용 제한과 입력 검증을 재사용하는 관리형 래퍼를 만든다. 기존 기초 사이트의 인증·API 동작은 유지한다. 배포 인프라의 OS/컨테이너·네트워크 경계도 별도로 검증한다.
4. 요청 계약에 관리형 sandbox 대상과 프로젝트 배포 대상을 구분하는 식별자를 추가한다. 관리형 모드는 서버가 고정 경로/메서드/q를 결정하고 브라우저 origin/URL을 실행 대상으로 신뢰하지 않는다. AST 후보를 가상 실습 API로 몰래 치환하지 말고, 가상 실습 결과와 실제 프로젝트 검증을 화면·데이터에서 구분한다.
5. 승인 후 최대 2회 요청, 요청 전체 타임아웃, 응답 크기 제한, 자동 redirect/retry 금지, 사용자별 동시 실행·요청 예산, 실제 evidence와 요청 snapshot 연계를 구현한다. 실제 증거가 없는 결과는 계속 미실행/판정 불가다.

## 사용자 외부 배포 URL은 별도 단계

현재 연결 대상에 포함되지 않는다. 추후에는 기존 GitHub 권한·Vercel 소유권·분석/배포 커밋 검증 외에 비운영 격리 환경과 명시적 실행 승인, 정확한 host/path/method/parameter 허용 목록, 실제 데이터·부작용 검토, DNS 재바인딩 방어와 공개 IP 고정, 내부망/메타데이터/localhost 차단, TLS 검증, redirect 금지, 실행 시점 재검증과 지속적인 요청 제한이 필요하다. 관리형 서버에 대한 로컬 접근 예외를 외부 URL 실행기로 확장하면 안 된다.

## 이번 검증

명령: `node --test --test-isolation=none labs/basic-site/tests/sqli-isolation-review.node.ts`

관련 테스트 **2개 통과**. 기존 서버가 사용하는 포트를 건드리지 않고 테스트가 생성한 임시 루프백 포트만 사용했다. 종료 시 모든 테스트 서버와 DB를 닫았다. 외부 사이트·사용자 배포 URL로 요청하지 않았다.

1. 실습 계정 A/B는 서로 다른 세션이나 동일 SQLi 가상 결과를 조회함을 확인. 비로그인 401, 정상 검색 결과와 취약 조건 우회 결과, 안전 API의 바인딩 동작 확인. 사용자별 DB가 아니라는 결론은 `server.ts/routes.ts`의 생성·전달 구조와 함께 판단했다.
2. 다른 인스턴스는 첫 인스턴스 쿠키를 인정하지 않음, 비활성 SQLi 404, mutation 요청 400 및 이후 검색 정상, health에 격리/승인 증거 없음, production 기동 거부 확인.

새 편집기에서는 실제 요청을 실행하지 않았다. 기존 기초 코드·API·스키마는 변경하지 않았고 검토 테스트만 추가했다. 전체 테스트·빌드·ESLint·마이그레이션·commit/push는 실행하지 않았다. 이번 작업에서는 타입 검사를 실행하지 않았다.
