# 4-A: API 요청과 서버 진입점 연결

이번 변경은 AST 메타데이터와 BehaviorFlow 데이터 계층에만 적용했다. UI, 기존 그래프, 인증·권한 검증, API 핸들러, DB, 기능 분류, AI 설명은 수정하지 않았다.

## 파일

수정: `src/types/analysis.ts`, `src/types/behavior.ts`, `src/lib/ast/analyzer.ts`, `src/lib/ast/apiRelations.ts`, `src/lib/behavior/flowBuilder.ts`, `src/lib/behavior/flowValidator.ts`.

추가: `src/types/http.ts`, `src/lib/ast/staticRequestValues.ts`, `src/lib/ast/httpRequests.ts`, `src/lib/ast/httpRequests.test.ts`, `src/lib/behavior/httpDetails.ts`, `src/lib/behavior/fixtures/httpBoundary.ts`, 본 문서, `docs/examples/behavior-http-requests.json`.

## 검토 결과와 설계

기존 분석기는 리터럴 fetch/axios 요청과 HTTP 메서드 export를 정적 라우트 우선순위로 연결했다. 기존 FunctionRelation/CodeEdge는 줄 번호를 기준으로 중복을 합치므로 같은 줄의 동일 요청 위치를 구별할 수 없고, 상수 URL은 해석하지 않았다. 3단계 callContexts는 기존 call edge와 저장소 내부 callee ID에 의존하므로 네이티브 fetch에는 그대로 사용할 수 없다.

새 `RepositoryAnalysis.httpRequests`는 호출식의 정확한 UTF-16 시작·끝 오프셋을 ID에 포함한다. 파일 경로, 1-based 행·열, 소유 함수, 원문, URL/메서드 표현식과 해석값, 상수 선언 근거를 보존한다. 원본 CFG callSite를 소유 함수와 정확한 위치로 찾아 statement, branchPath, graphNodeIds, reachability를 참조한다. finally로 복제된 statement 인스턴스도 목록으로 보존한다. 이는 호출 횟수나 실행 순서를 뜻하지 않는다.

`BehaviorFlow.httpRequests`는 별도 HTTP 관계 계층이다. `ownerBehaviorNodeId`로 기존 이벤트→핸들러→함수 노드에 연결한다. 확정된 요청만 `boundary`를 가진다. 경계는 `semantics: http-boundary`, `relation: http-request-to-entry`이며 서버 entryPoint, 기존 서버 BehaviorFlow ID, 유효한 서버 CFG ID를 참조한다. 기존 outer nodes/edges와 함수 내부 CFG에 HTTP를 일반 call/next edge로 추가하지 않는다. 서버 내부 호출은 해당 API의 기존 BehaviorFlow에서, 내부 제어 흐름은 기존 CFG에서 확인한다.

이전 단계 JSON과 httpRequests 없는 분석 결과는 계속 사용할 수 있다. 새 JSON 계층은 원문 위치, 소유 함수, 상수 근거, 원본 CFG 및 entry metadata와 비교 검증한다. 잘못된 근거는 투영하지 않으며 출력의 메서드·경로·조건 문맥·서버 참조·경계 의미를 변조하면 검증에 실패한다. 원본 AST 분석 snapshot은 신뢰 기준이며, 검증기가 새 AST를 다시 파싱하는 것은 아니다.

## 확정 연결 규칙

1. 저장소의 지역/수입 함수에 가려지지 않은 직접 `fetch(...)`만 새 계층에서 지원한다.
2. 문자열 리터럴, const 문자열·별칭·import/reexport, 모든 피연산자가 정적 문자열인 +/템플릿을 해석한다. let, 객체 속성, 함수 반환값, 매개변수는 해석하지 않는다. 순환, 깊이 32 초과, 해석 작업 256 초과, 결과 문자열 8192자 초과는 미해결이다.
3. 옵션이 없거나 검증 가능한 객체 리터럴에 method가 없을 때 GET이다. 알 수 없는 옵션·spread·computed key·동적 메서드는 GET으로 가정하지 않는다. 알려진 HTTP 메서드만 정규화한다.
4. 루트 상대 URL만 내부 후보이다. query/hash는 원문 URL에 보존하고 경로 매칭에서만 제외한다. 외부/프로토콜 상대 URL, 잘못된 경로, 인코딩된 경로 구분자는 연결하지 않는다.
5. 동일 애플리케이션의 App Router `app/api/**/route` 또는 `src/app/api/**/route` 런타임 HTTP export를 찾는다. 기존 matcher를 공유하며 root app 우선, route group 제거, private/parallel/interception 제외, 정적→동적→catch-all→optional catch-all 우선순위를 유지한다.
6. 경로를 먼저 선택하고 메서드를 검사한다. 정적 경로에 요청 메서드가 없다고 동적 경로로 대체하지 않는다. 최상위 동률 경로가 둘이면 메서드가 달라도 모호성으로 남긴다.
7. 실제 등록된 RepositoryEntryPoint와 route 파일·메서드·함수 ID가 모두 일치해야 확정한다. 동적 세그먼트는 정적 요청 URL에 한해 실제 매개변수 값을 기록한다. `/api/users/${id}`의 id는 만들어내지 않는다.

## 입력과 출력

전체 실제 생성 예제: [behavior-http-requests.json](examples/behavior-http-requests.json). synthetic TSX 입력, 실제 분석기의 요청 메타데이터, 생성된 BehaviorFlow의 HTTP 계층과 CFG ID 목록을 담은 발췌 artifact이다. 전체 기존 outer graph/CFG 본문은 반복하지 않았다. 입력 fixture는 `src/lib/behavior/fixtures/httpBoundary.ts`이다.

```tsx
const URL = "/api/users/42";
if (allowed) { await fetch(URL, { method: "POST" }); }
fetch(dynamicUrl);
```

`app/api/users/[id]/route.ts`에 POST export가 있을 때 첫 요청은 다음 필드를 생성한다. 아래 JSON은 긴 ID/코드 위치를 생략한 구조 설명이며 정확한 실제 값은 artifact에 있다.

```json
{
  "request": {
    "status": "matched",
    "url": "/api/users/42",
    "path": "/api/users/42",
    "method": "POST",
    "target": {"matchKind": "dynamic", "parameters": {"id": "42"}},
    "contextStatus": "mapped"
  },
  "boundary": {
    "relation": "http-request-to-entry",
    "semantics": "http-boundary",
    "confidence": "confirmed",
    "runtimeTransfer": "not-observed",
    "executionOrder": "not-established",
    "response": "not-analyzed",
    "exceptionPropagation": "not-modeled"
  }
}
```

첫 요청 context에는 조건문의 true 경로가 들어간다. 두 번째는 `status: unresolved`, `reason: dynamic-url`이며 boundary가 없다. 미해결 요청도 위치·소유 함수·가능한 CFG 근거는 남긴다.

## 미해결과 범위 제한

미해결 사유: dynamic-url, dynamic-method, unknown-transport, optional-call, unsupported-method, external-url, invalid-path, encoded-path-separator, unknown-application, route-not-found, method-not-exported, ambiguous-route, entry-point-unavailable. 조건/반복문 내부 요청은 위치를 추출하되 CFG의 unsupported-region/unknown을 그대로 보존한다. 함수 매개변수 초기식은 CFG 범위 밖이므로 contextStatus=not-available이다.

모듈 초기화 시 요청, fetch 별칭/globalThis.fetch, Request 객체, axios의 새 위치 메타데이터, 객체 기반 설정 상수, 실행 중 URL 생성은 이번 확장에 포함하지 않았다. 기존 axios 및 API 그래프는 그대로 유지한다. 새 HTTP 계층이 위치·문맥이 필요한 소비자의 기준이며, 이전 줄 단위 그래프는 상수/동적 경로 등에서 새 계층과 표현 범위가 다르다.

확정은 소스의 일반적인 App Router 경로 규칙에 대한 정적 일치이며, 배포 시 실제 전송을 뜻하지 않는다. next.config의 basePath/rewrites, middleware, reverse proxy, DOM base URL, fetch 재할당, 런타임 설정은 분석하지 않는다. 이를 다루려면 별도 설정 해석과 불확실성 모델이 필요하다. HTTP 성공/실패, 응답값 계보, 서버 throw와 클라이언트 catch의 직접 관계, 비동기 완료 순서는 추론하지 않는다.

실제 RepoTutor 코드의 동적 connectionId/params 요청 3건을 분석하는 회귀 테스트도 추가했다. 이들은 경로 값을 확정할 수 없어 미해결로 남으며, 인증/네트워크 호출은 수행하지 않는다.

## 검증

최종 명령 결과는 작업 완료 보고에 기록한다. 새 테스트는 정적 요청/GET 기본값/메서드 불일치/상수·import·템플릿/동적·외부 URL/조건·조기 반환/지원하지 않는 CFG 문맥/동적 라우트 및 충돌/중복 위치/서버 별도 흐름/변조 거부/원본 불변성/기존 분석 호환/실제 RepoTutor 소스를 포함한다. 외부 GitHub 및 AI 통합 테스트는 기존 환경변수 조건에 따라 생략된다.

## 다음 4-B: DB 분석

1. 서버 entryPoint→기존 함수 호출 및 CFG 문맥을 출발점으로 삼는다.
2. 실제 ORM/DB 패키지 import와 클라이언트 선언을 확인하고 재할당/동적 alias는 미해결로 둔다.
3. Prisma 등 확인된 클라이언트의 실제 호출 위치·모델·작업 종류를 근거로 데이터 접근 기록을 만든다. save/find 같은 함수명만으로 DB 처리를 확정하지 않는다.
4. 조건 경로/try/finally/미지원 문맥을 보존하고 쿼리 성공, 트랜잭션 커밋, 반환값 계보는 별도 단계로 둔다.
5. DB 연결 없이 synthetic 소스로 테스트한다. 읽기/쓰기/트랜잭션/alias/동적 모델/무관한 동일 이름 함수의 음성 사례를 우선 검증한다.

최종 검증 결과: `npm.cmd run typecheck` 통과, `npm.cmd run lint` 통과(경고 없음), `npm.cmd test -- --maxWorkers=2` 통과(38개 파일, 506개 테스트 통과 / 기존 5개 생략, 신규 HTTP 테스트 41개). 생략된 테스트는 RUN_GITHUB_INTEGRATION, RUN_ACTUAL_FEATURE_DISCOVERY, RUN_ACTUAL_REPO_AI 또는 INTEGRATION_REPO_DIR을 요구하는 기존 선택 실행 테스트다. 실제 GitHub/AI 원격 호출과 배포 환경의 HTTP 전송은 검증하지 않았다.
`npm.cmd run build`도 통과했다. Next.js 프로덕션 컴파일, TypeScript 확인, 정적 페이지 생성이 완료되었다.
