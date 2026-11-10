# 4-C: 서버 응답 및 제한된 데이터 출처 분석

기존 UI/그래프, 인증·권한 검증, DB 스키마·쿼리, API 핸들러와 AI 생성 로직은 수정하지 않았다. 코드는 실행하지 않고 ts-morph AST와 기존 CFG/Prisma 메타데이터를 읽는다.

## 수정·추가 파일

수정 5개:
- `src/types/analysis.ts`: 선택적 serverResponses.
- `src/types/behavior.ts`: 응답 분석 참조 투영 타입.
- `src/lib/ast/analyzer.ts`: 기존 분석 후 별도 응답 분석기 호출.
- `src/lib/behavior/flowBuilder.ts`: 응답 참조 투영, 실제 분석 범위에 맞춘 한계 안내.
- `src/lib/behavior/flowValidator.ts`: 응답 투영 검증.

추가 8개:
- `src/types/response.ts`: 생성/반환/출처/서버 문맥/투영 타입.
- `src/lib/ast/responseValues.ts`: 위치, CFG 문맥, const 선언, 변경 검사, 정적 상태 코드, 정의 우선성.
- `src/lib/ast/serverResponses.ts`: 응답 생성·반환·출처 추출.
- `src/lib/behavior/responseDetails.ts`: 기존 분석 근거와 대조하여 서버별 참조 생성.
- `src/lib/ast/serverResponses.test.ts`: 회귀 테스트.
- `src/lib/behavior/fixtures/serverResponse.ts`: 합성 예제 입력.
- `docs/examples/behavior-server-responses.json`: 실제 생성기를 통과한 입출력 JSON.
- 본 보고서.

총 13개 파일. 이전 단계의 미커밋 변경은 유지했다. 기존 AST/DFS/HTTP/Prisma 추출 알고리즘과 출력 그래프는 교체하지 않았다.

## 기존 구조 재사용

RepositoryEntryPoint의 실제 App Router HTTP export를 서버 출발점으로 사용한다. 서버 경로는 기존 CFG의 resolved callSite ID를 참조하며 별도 함수 호출 분석을 재수행하거나 새 CodeEdge를 만들지 않는다. 4-B DB 접근 ID 및 서버별 databaseContext ID도 참조한다.

RepositoryAnalysis.serverResponses에 원본 의미 메타데이터를 한 번 저장한다. BehaviorFlow.serverResponses는 creation/return/source/server-context ID를 연결하며 응답 코드·CFG·DB 코드 본문을 다시 복사하지 않는다. 각 response server context는 기존 호출 위치 ID 배열만 보관하고 함수 본문이나 전체 callPath를 복제하지 않는다.

```
page.httpRequests[].boundary.serverFlowId
  → API BehaviorFlow.id
  → API BehaviorFlow.serverResponses
  → RepositoryAnalysis.serverResponses의 creation/return/source ID
  → databaseSiteId / databaseContextId / 기존 CFG ID
```

HTTP 경계의 response=not-analyzed는 클라이언트까지 이어지는 응답 전송/소비를 아직 연결하지 않았다는 의미로 유지했다. 이번 단계는 서버의 정적 응답 참조만 추가하며 HTTP 성공/실패·클라이언트 catch로 확장하지 않는다.

## 지원 응답 패턴

- 런타임 named import인 `NextResponse`의 `.json(...)`. `import {NextResponse as NR} from "next/server"; NR.json(...)`도 지원.
- 지역 선언/import에 가려지지 않은 전역 `Response.json(...)`.
- 전역 `new Response(...)`.
- 직접 return, await로 감싼 응답, 같은 함수의 const 응답 객체와 단순 별칭 return.
- `export const GET=()=>Response.json(...)` 같은 표현식 본문의 암시적 반환.

응답 생성식과 반환문은 별도 레코드다. 생성만 한 객체는 creation으로 남고 returnedBy는 비어 있다. 식을 만든 사실만으로 서버 응답을 반환한다고 연결하지 않는다.

HTTP 상태는 숫자 리터럴/const 숫자 별칭을 지원한다. 확인된 응답 생성자의 옵션이 없거나 검증 가능한 객체 리터럴에 status가 없으면 기본 200을 기록한다. 동적 옵션/status, spread/computed key/getter, 지원 범위 밖 숫자는 unresolved다. 상태 코드는 200~599의 정수만 정적으로 기록한다. 실제 Response 생성·직렬화 성공 및 실제 전달 상태는 확인하지 않는다. 이름이 같은 가짜 객체는 constructorResolution=unresolved이며 기본 200도 가정하지 않는다.

파일·UTF-16 오프셋·1-based 행/열·원문·소유 함수 ID를 보존한다. CFG statement/graphNodeIds/branchPath/reachability를 참조한다. new Response에는 기존 CallExpression callSite가 없을 수 있으므로 소유 statement로 연결하며 callSite ID를 만들지 않는다. HTTP 메서드와 실제 서버 entry는 serverContexts의 RepositoryEntryPoint를 통해 확인한다.

## 반환 관계의 의미

- entry-return-reference: API 함수의 return 식이 확인된 응답 생성 객체를 참조함.
- helper-local-return: API에서 확인된 호출 경로에 있는 헬퍼의 로컬 반환임. 해당 응답이 API 반환값이 된다고 합성하지 않음.
- unresolved-return: 동적/가변/다른 함수 호출/확인하지 못한 객체 반환 등.

모든 투영의 runtimeDelivery는 not-established다. `try { return ... } finally { return ... }`는 두 정적 반환과 기존 finally CFG 문맥을 보존한다. 최종 전달될 반환을 예측하지 않는다. unreachable-in-model 및 미지원 구간도 실제 실행된 것으로 해석하지 않는다.

서버 경로는 일반 resolved 함수 호출만 따른다. 다른 API/page entry를 가로질러 구현을 합치지 않는다. 일반 콜백 실행 및 transaction 콜백의 응답을 서버 결과로 끌어올리지 않는다. 경로당 재귀는 중단하며 API당 방문 128, 호출 깊이 12 초과는 limitations에 남긴다.

## 제한적인 값 출처 규칙

```ts
const user = await prisma.user.findUnique({});
const alias = user;
return Response.json({ user: alias });
```

1. 이름 문자열 대신 TypeScript symbol의 실제 VariableDeclaration을 사용한다. 같은 이름의 서로 다른 블록 const는 별개다.
2. 같은 함수의 const만 추적한다. let/var, 매개변수, 외부 함수/모듈에서 캡처한 값은 데이터 계보로 확정하지 않는다.
3. 정의가 사용보다 앞에 있어야 한다. 지원하는 CFG에서 정의 statement가 사용 statement를 지배하는지도 검사한다. 정의를 통과하지 않고 사용에 도달하는 경로, 도달 불가능/미지원 문맥, 복잡한 동일 statement 정의·사용은 확정하지 않는다.
4. 단순 const 별칭, 정적 객체 필드와 중첩 객체, `payload.user` 같은 제한된 객체 투영, `user.id` 같은 DB 출처 속성 경로를 지원한다. 필드 경로는 문자열 배열로 기록한다.
5. DB 결과는 동일 함수의 `await`가 기존 4-B DB 호출 위치와 정확히 일치할 때 후보로 연결한다. 새 DB 식별기를 만들지 않는다. 미await PrismaPromise, transaction 반환값, 다른 함수의 반환값은 결과로 해석하지 않는다.
6. 최종 확정에는 같은 API entry와 같은 호출 경로의 검증된 DB serverContext가 필요하다. 다른 서버 경로에서만 확인된 클라이언트 근거를 재사용하지 않는다.
7. 확인된 재할당·단순 별칭 경유 속성 변경은 거부한다. 복잡한 변환, JSON.stringify/임의 함수 호출, 동적 속성, spread/getter/method/중복 객체 키는 미해결이다. 객체 리터럴의 __proto__ setter를 JSON 필드로 잘못 처리하지 않는다.
8. 리터럴 값은 literal 출처로 구별한다. 데이터 추적 깊이 24/작업 128 한도를 넘으면 미해결이다.

DB site.status는 여러 서버 문맥을 합친 상태일 수 있다. 따라서 원본 source는 syntactic databaseSiteId를 참조하더라도 Flow의 해당 entry/call-path에 DB 근거가 없으면 database-source-unverified-in-server-context로 표시한다. 이것은 조회 성공이나 값 존재를 뜻하지 않는다.

## 실제 입력·출력

[behavior-server-responses.json](examples/behavior-server-responses.json)에 전체 합성 입력과 실제 생성 결과가 있다. output은 원본 serverResponses와 databaseAccess, Flow의 HTTP·응답 참조 계층 및 CFG ID를 발췌했다. 기존 전체 outer graph와 CFG 본문은 생략했다.

예제에는 아래 세 생성식이 있다.

```ts
const user=await prisma.user.findUnique({where:{id:42}});
const alias=user;
const unused=NextResponse.json({preview:true});
if (!user) return NextResponse.json({error:"missing"},{status:404});
const response=NextResponse.json({user:alias},{status:200});
return response;
```

unused는 생성 사실만 기록되고 반환 참조가 없다. 404/200 생성과 반환의 조건 경로가 각각 남는다. 200 응답의 user 필드는 기존 DB site/context에 연결된다. 이는 코드 구조이며 user가 존재하거나 요청에 200이 반환됐다는 뜻이 아니다.

아래는 긴 ID를 생략한 구조 설명이다. 정확한 실제 값은 artifact에 있다.

```json
{
  "semantics": "static-response-references",
  "runtimeDelivery": "not-established",
  "returns": [{
    "kind": "entry-return-reference",
    "returnSiteId": "(actual return ID)",
    "responseSiteId": "(actual creation ID)",
    "dataSources": [{
      "sourceId": "(actual user-field source ID)",
      "status": "confirmed",
      "databaseContextId": "(existing 4-B context ID)"
    }]
  }]
}
```

## 미해결 관계와 실제 프로젝트 한계

미해결 사유에는 mutable-or-nonlocal-value/response, definition-not-established-before-use, response-definition-not-established, awaited-source-unresolved, call-result-or-transform-unresolved, unsupported-value-expression/object-shape, duplicate-object-key, object-field-unresolved, return-value-unresolved, response-constructor-unverified, lineage-limit 등이 있다.

- const 숫자/객체 설정의 모든 표현식 평가나 전체 TypeScript 타입 추론은 하지 않는다.
- 생성자 namespace import, 전역/생성자 별칭, module-scope 응답 객체, 반환 객체의 복잡한 래핑, 배열/구조분해/동적 프로퍼티/대부분의 변환은 후속 범위다.
- CFG는 정적 구조다. 입력에 따른 분기, async 완료 순서, 실제 직렬화, getter/proxy/외부 함수에 의한 mutation 및 전역 생성자 monkey-patch는 분석하지 않는다.
- ResponseDataSource의 DB 속성 경로는 코드상 접근을 뜻한다. 모델/필드 존재, 반환 shape, null 여부, 데이터 내용은 확인하지 않는다.
- 코드 근거 검증은 신뢰된 원본 AST snapshot과 비교한다. 임의 외부 JSON을 다시 파싱하여 검증하는 보안 경계는 아니다.
- 실제 RepoTutor의 `repositoryJson(...)` 래퍼는 별도 헬퍼에서 NextResponse.json을 만들지만 API의 `return repositoryJson(...)` 값은 이번 함수 간 반환값 추적 범위 밖이다. 헬퍼의 로컬 반환과 API의 미해결 반환을 구분하는 실제 소스 회귀 테스트를 추가했다.
- 4-B의 전역 캐시 Prisma singleton 출처 제한도 유지된다. DB 출처가 확인되지 않으면 응답 계보를 임의로 확정하지 않는다.

## 검증

테스트는 합성 TS/TSX 및 실제 RepoTutor 소스의 정적 분석이며 실제 요청·DB·응답 실행은 하지 않았다.

| 검증 | 최종 결과 |
| --- | --- |
| npm.cmd run typecheck | 통과 |
| npm.cmd run lint | 통과, 경고 없음 |
| npm.cmd test -- --maxWorkers=2 | 40개 파일 통과 / 4개 파일 생략, 589개 테스트 통과 / 기존 5개 생략 |
| 신규 응답 테스트 | 34개 통과 |
| npm.cmd run build | 프로덕션 컴파일·TypeScript·정적 페이지 생성 통과 |

초기 전체 실행에서 기존 실제 소스 테스트 1개가 5초 제한을 초과했다. 응답과 무관한 함수의 CFG를 검증하지 않도록 지연 검증하고, 서버/응답과 무관한 반환식의 추적을 생략했다. 제한 시간을 늘리지 않고 최종 전체 테스트를 통과했다.

생략된 기존 통합 테스트는 RUN_GITHUB_INTEGRATION, RUN_ACTUAL_FEATURE_DISCOVERY, RUN_ACTUAL_REPO_AI 또는 INTEGRATION_REPO_DIR 조건을 요구한다. 실제 GitHub/AI 원격 연동, DB 쿼리 실행, 브라우저 및 응답의 런타임 전달은 검증하지 않았다.

## 5단계 UI 통합 전 우선 작업

1. **참조 해석과 상태 표시:** creation/return/source/server-context/CFG/DB ID를 원본 메타데이터와 연결하고, 생성만 한 객체·헬퍼 반환·entry 반환·미해결을 다른 상태로 표시한다. 생성만으로 서버 응답 노드를 활성화하지 않는다.
2. **불확실성 보존:** static/default/unresolved status, DB 문맥별 출처 상태, CFG의 unsupported/unreachable/finally 문맥, 부분 수집·순환·예산 제한을 화면에 노출한다. 실행 결과나 성공률처럼 표현하지 않는다.
3. **실제 프로젝트의 미해결 범위:** repositoryJson 같은 래퍼의 함수 간 반환값 추적과 전역 캐시 클라이언트 provenance는 별도 설계·검증이 필요하다. 현재 결과를 완성된 end-to-end 데이터 계보로 소개하지 않는다.
4. **범위와 지연 로딩:** 기존 UI depth/node budget과 별도 응답 분석의 범위가 다를 수 있다. 원본 CFG의 ID를 필요할 때 로드하고, 존재하지 않는 UI 노드를 만들지 않는다. DB/response 분석 예산과 누락 사유도 전달한다.
5. **HTTP 응답 경계:** 이후 response.ok/status/json 소비를 명시적 HTTP 응답 관계로 설계한다. 서버 throw, HTTP 오류 상태, 네트워크 rejection, 클라이언트 catch를 같은 관계로 합치지 않는다.
6. **UI 회귀 테스트:** 기존 두 그래프와 선택 상태를 보존한 채 참조 패널·빈 상태·미해결 상태·응답 생성/반환 구분을 검증한다. 이번에는 UI 변경을 수행하지 않았다.
