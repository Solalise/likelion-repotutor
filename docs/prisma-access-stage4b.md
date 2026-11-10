# 4-B: 서버 Prisma 접근 분석

이번 변경은 기존 AST 결과에 추가하는 메타데이터와 BehaviorFlow 분석 계층에 한정한다. UI, 기존 그래프, OAuth/App/권한 검증, DB 스키마·실제 쿼리, API 핸들러 동작, AI 설명 로직은 수정하지 않았다. 분석 과정에서 Prisma를 실행하거나 DB에 접속하지 않는다.

## 수정·추가 파일

수정:
- `src/types/analysis.ts`: 선택적 `databaseAccess` 메타데이터.
- `src/types/behavior.ts`: 선택적 `databaseAccesses` 투영 결과.
- `src/lib/ast/analyzer.ts`: 기존 추출이 끝난 뒤 독립 DB 추출기 호출.
- `src/lib/behavior/flowBuilder.ts`: DB 메타데이터 투영 및 분석 한계 안내.
- `src/lib/behavior/flowValidator.ts`: DB 투영 근거 검증.

추가:
- `src/types/database.ts`: 호출 위치, 클라이언트 근거, 서버별 문맥, 작업 유형, 투영 타입.
- `src/lib/ast/prismaClientResolver.ts`: 생성자 import, 클라이언트 생성, 별칭·전달·제한된 팩토리 해석.
- `src/lib/ast/databaseAccess.ts`: 서버 호출 경로와 DB 후보 위치 추출.
- `src/lib/ast/databaseAccess.test.ts`: 새 회귀 테스트.
- `src/lib/behavior/databaseDetails.ts`: 원본 근거 검증 및 서버 Flow 투영.
- `src/lib/behavior/fixtures/prismaAccess.ts`: 합성 TypeScript/TSX 예제.
- `docs/examples/behavior-prisma-access.json`: 실제 생성기로 작성한 입력·출력 발췌.
- 본 문서.

총 13개 파일이다. 이전 단계의 미커밋 변경은 유지했다.

## 기존 구조와 서버 추적 범위

기존 RepositoryEntryPoint는 실제 Next App Router HTTP export의 함수 ID를 제공한다. 기존 함수 ID·call CodeEdge와 함수별 CFG에는 소유 함수, 호출 대상 ID, 정확한 호출 위치, 조건 문맥이 있다. 기존 4-A HTTP boundary의 serverFlowId는 API entry의 BehaviorFlow를 참조하므로 HTTP 관계를 변경하지 않고 서버 DB 정보를 연결할 수 있다.

DB 추적은 확인된 Next App Router API 진입점에서 시작한다. 직접 해석된 함수 호출의 CFG callSite targetNodeId를 따라간다. 기존 call CodeEdge가 있으면 그 ID도 보존한다. 같은 줄의 여러 호출은 이전 줄 단위 관계 병합으로 일부 CodeEdge/FunctionRelation 근거가 없을 수 있다. 이때 정확한 원문 위치와 resolved target을 가진 CFG 호출 근거를 사용하며 새 CodeEdge를 만들어 보완하지 않는다.

단순 함수 참조, 임의의 콜백 props, 외부 라이브러리 콜백 실행, 다른 API/page 구현은 서버 호출 경로에 자동 포함하지 않는다. Prisma `$transaction`에 직접 전달된 인라인 콜백만 별도의 transaction-callback 관계로 연결한다. 함수 간 호출 경로와 함수 내부 CFG는 서로 다른 데이터다. 호출 순서·실행 횟수·분기 선택은 확정하지 않는다.

한 API entry당 최대 128회 함수 방문, 호출 경로 깊이 12를 사용한다. 현재 경로에서 재귀가 나타나면 중단한다. 중단 사유는 `RepositoryAnalysis.databaseAccess.limitations`에 명시한다. 이 메타데이터의 누락은 DB 접근이 없다는 증거가 아니다.

## 클라이언트 식별

- 런타임 `@prisma/client`의 named import `PrismaClient` 또는 namespace import의 `PrismaClient` 생성자를 확인한다. import 별칭도 원래 선언으로 확인한다.
- 실제 `new PrismaClient(...)` 생성식과 import의 원문·위치를 근거로 남긴다. 동일한 이름의 지역 클래스·다른 패키지·타입 전용 import·타입 단언은 클라이언트 증거가 아니다.
- const 클라이언트 별칭, 로컬 모듈의 import/reexport, namespace로 import한 const 클라이언트를 추적한다. mutable binding 및 확인된 재할당/속성 변경(단순 별칭 경유 포함)은 보수적으로 거부한다.
- 동기 zero-argument 팩토리는 기존 CFG가 supported이고 정상 fall-through가 없으며 모든 return이 클라이언트 생성 근거로 해석될 때만 허용한다. async factory, 매개변수 factory, 알려지지 않은 분기 결과는 미해결이다.
- 헬퍼 인수→매개변수는 확인된 호출 위치별로 연결한다. 같은 헬퍼를 `query(prisma)`와 `query(unknown)`로 호출하면 서로 다른 서버 문맥에서 confirmed/unresolved를 따로 기록한다. export 함수의 모든 호출자를 안다고 가정하지 않는다. spread 인수·구조분해/rest 매개변수는 임의로 바인딩하지 않는다.
- `$transaction(async tx => ...)`는 외부 클라이언트가 확인됐을 때만 해당 매개변수를 transaction client로 바인딩한다. 이 클라이언트를 헬퍼에 전달한 경우에도 transactionSiteId를 보존한다.

클라이언트 해석은 깊이 24와 작업 128회 한도를 두고 순환 별칭을 중단한다. 이름에 db/save/find가 포함됐는지는 사용하지 않는다.

## 지원 작업

정적 모델 delegate의 아래 메서드를 지원한다.

| 유형 | 작업 |
| --- | --- |
| read | findUnique, findUniqueOrThrow, findFirst, findFirstOrThrow, findMany, count, aggregate, groupBy |
| write | create, createMany, update, updateMany, delete, deleteMany, upsert |
| transaction | 클라이언트의 $transaction 호출 |

모델명은 `prisma.user`의 user처럼 코드에 적힌 정적 delegate 이름이다. generated schema에 실제 모델이 있는지, 쿼리 인수가 유효한지, 실행이 성공하는지는 검증하지 않는다. 읽기/쓰기 분류는 지원하는 Prisma API의 정적 작업 유형이며 실제 부작용의 판정이 아니다.

`$transaction([...])` 및 직접 전달된 인라인 함수의 코드를 처리한다. 배열의 각 쿼리 위치는 별도로 기록하지만 배열 순서를 실행 순서로 바꾸지 않는다. 콜백 안에서 outer prisma를 사용한 쿼리는 코드 경로상 콜백에 속하더라도 tx 클라이언트 쿼리로 간주하지 않는다. 트랜잭션 등록/콜백 바인딩은 실제 실행·원자성·커밋/롤백의 증거가 아니다.

## 메타데이터와 BehaviorFlow

`RepositoryAnalysis.databaseAccess.sites`에는 위치별 후보를 넣는다. ID는 파일 경로와 UTF-16 시작/끝 오프셋으로 구별한다. 파일, 1-based 시작·끝 행/열, 원문, 소유 함수 ID, 모델/작업 표현식, CFG callSite·statement·graphNodeIds·branchPath·reachability·미지원 문맥을 보존한다.

serverContexts에는 연결된 실제 API entry, 함수 간 callPath, 해당 경로의 클라이언트 근거와 상태를 기록한다. site.status=confirmed는 적어도 한 서버 문맥이 확인됐다는 집계 상태다. 다른 호출 경로에서도 확인됐다는 의미가 아니다. 작업 유형 역시 확인된 문맥이 있을 때만 read/write/transaction이며 미확정 후보는 unknown이다.

API `BehaviorFlow.databaseAccesses`는 entry가 일치하는 서버 문맥별로 따로 투영한다. 따라서 동일 site라도 잘못된 인수로 호출한 서버 경로는 unresolved/unknown을 유지한다. 기존 함수 노드가 있으면 ownerBehaviorNodeId도 연결하고, 없으면 새 그래프 노드를 만들지 않는다.

```
page.httpRequests[].boundary.serverFlowId
  → API BehaviorFlow.id
  → API BehaviorFlow.databaseAccesses[]
  → site.context.controlFlowId / callSiteId / statementId
```

DB 투영의 semantics는 static-database-access다. runtimeExecution=not-observed, queryResult=not-analyzed, transactionCommit=not-established를 항상 명시한다. HTTP 경계를 함수 call로 바꾸지 않으며 서버 예외를 클라이언트 catch에 연결하지 않는다.

검증기는 원본 AST snapshot과 실제 코드 위치, 서버 entry, 직접 호출 대상/CFG 문맥, 기존 edge ID(있는 경우), transaction 콜백의 출처, 클라이언트 근거 위치를 확인한다. 출력의 메서드·조건 경로·클라이언트 근거·entry·커밋 상태 변조는 거부한다. 신뢰 기준은 분석기의 원본 AST snapshot이며 검증기가 외부 JSON을 새로 AST 파싱하는 것은 아니다. 기존 JSON 및 databaseAccess 없는 분석 결과도 유지한다.

## 실제 입력·출력 예제

[behavior-prisma-access.json](examples/behavior-prisma-access.json)은 fixture의 실제 분석 결과다. input에는 전체 예제 소스, output에는 databaseAccess 및 생성된 Flow의 HTTP/DB 계층·CFG ID를 발췌했다. 전체 outer graph와 CFG 본문은 중복해서 싣지 않았다.

```ts
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
function query(client) {
  if (allowed) return client.user.findUnique({ where: { id: 42 } });
}
export function POST() { return query(prisma); }
```

일반 `.ts` 함수만으로는 API entry를 만들지 않는다. 위 서버 코드가 실제 `app/api/**/route.ts` entry에 있고 호출 대상이 확인될 때 findUnique는 read 작업으로 기록된다. 정확한 ID와 위치를 생략한 형태 설명은 다음과 같다.

```json
{
  "site": {
    "model": "user",
    "operation": "findUnique",
    "operationType": "read",
    "status": "confirmed",
    "contextStatus": "mapped"
  },
  "semantics": "static-database-access",
  "runtimeExecution": "not-observed",
  "queryResult": "not-analyzed",
  "transactionCommit": "not-established"
}
```

실제 artifact의 helper query에는 true branchPath와 API→helper callPath가 있다. 트랜잭션 및 tx.user.update는 별도로 확인되고 unknownDb.user.findMany는 unverified-client/unknown으로 남는다.

## 미해결 및 분석 한계

- no-confirmed-server-path: 지원하는 API entry에서 확인된 호출 경로가 없음.
- unverified-client: 클라이언트의 실제 생성/전달 근거를 확인하지 못함.
- dynamic-operation: computed/동적 메서드. 문자열 리터럴 bracket 표기도 현재 보수적으로 미해결 처리.
- optional-access: optional client/member/call을 확정된 접근으로 투영하지 않음.
- unsupported-operation, model-unresolved, unsupported-transaction-operation: 지원하지 않는 구조나 transaction client의 중첩 transaction 등.

일반 객체나 다른 ORM의 동명 메서드는 미확정 후보로 남을 수 있지만 Prisma 접근으로 확정하거나 read/write로 분류하지 않는다. 모든 미지원 문법을 후보로 빠짐없이 수집하는 것은 아니다. 동적 모델, delegate/method의 분리 별칭, 객체 컨테이너를 통한 전달, 복잡한 client factory, `$extends`, 사용자 정의 생성 경로, raw/tagged SQL, 별도 변수로 전달한 transaction 콜백, Prisma 이외 DB 라이브러리는 후속 확장 대상이다.

함수 매개변수 초기식은 기존 CFG의 body 범위 밖이므로 contextStatus=not-available이다. 지원하지 않는 loop/switch/복잡한 표현식은 기존 CFG의 unsupported-region/unknown을 그대로 보존한다. 호출 경로가 있어도 unreachable-in-model인 코드를 실제 실행됐다고 해석하지 않는다. getter/proxy, 외부 함수에 의한 런타임 mutation, 가능한 모든 alias/side effect는 분석하지 않는다.

### 실제 RepoTutor 결과에서의 주의점

`src/lib/db.ts`는 `globalForPrisma.prisma ?? createPrismaClient()`로 db를 내보낸다. 생성자와 팩토리 코드는 존재하지만 전역 캐시에 이미 있던 값의 실제 출처는 타입 단언만으로 확인할 수 없다. 따라서 이 singleton을 사용하는 실제 API/helper 쿼리는 현재 **미해결**이다. 실제 RepoTutor의 db/권한 helper/분석 API 소스를 함께 읽는 회귀 테스트로 확인했다. 이를 임의로 Prisma 확인 완료 처리하지 않았으며 실제 DB 코드도 수정하지 않았다. 향후 전역 캐시 초기화·모든 쓰기 경로를 검증하는 별도 provenance 모델이 필요하다.

## 검증

검증 명령: `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd test -- --maxWorkers=2`, `npm.cmd run build`. 테스트는 실제 DB 없이 합성 소스와 실제 RepoTutor 코드의 정적 분석으로 수행했다.

| 검증 | 최종 결과 |
| --- | --- |
| TypeScript 타입 검사 | 통과 |
| ESLint | 통과, 경고 없음 |
| 전체 테스트 | 39개 파일 통과 / 4개 파일 생략, 555개 테스트 통과 / 기존 선택 실행 5개 생략 |
| 신규 DB 테스트 | 49개 통과 |
| 프로덕션 빌드 | 컴파일·TypeScript·정적 페이지 생성 통과 |

생략된 기존 통합 테스트는 RUN_GITHUB_INTEGRATION, RUN_ACTUAL_FEATURE_DISCOVERY, RUN_ACTUAL_REPO_AI 또는 INTEGRATION_REPO_DIR 조건을 요구한다. 실제 GitHub/AI 원격 연동, 실제 DB 실행/트랜잭션 커밋, 브라우저 런타임은 이번 검증에 포함하지 않았다.

새 테스트는 직접 호출/생성자 및 클라이언트 import별칭/namespace/reexport/타입전용 import 거부/헬퍼 및 다단계 인수 전달/서버별 문맥 분리/조건·조기 반환/트랜잭션 배열·콜백/여러 작업과 중복 위치/일반 객체와 다른 ORM/동적 메서드/잘못된 인수와 spread/변경된 alias/팩토리 한계/재귀·미지원 CFG/HTTP 호환/원본 불변성/변조 거부/실제 소스를 검증한다.

## 다음 단계: 서버 응답 분석

1. 확인된 API entry의 실제 return/throw와 CFG 종료 경로를 수집한다.
2. `Response`/`NextResponse.json` 등의 import·실제 호출 구조를 식별하고 status/body 표현식을 근거로 연결한다. 사용자 함수의 json이라는 이름만으로 응답을 확정하지 않는다.
3. 함수 반환값→API 응답으로 이어지는 할당·인수·return의 정의/사용 관계를 별도 모델로 만든다. DB 작업과 응답이 같은 함수에 있다는 이유만으로 결과 계보를 연결하지 않는다.
4. 조건·catch/finally의 응답 대체·재throw와 알 수 없는 alias/부분 수집을 구별한다.
5. 클라이언트의 response.ok/status/json 처리 및 await/catch는 별도 HTTP 응답 관계로 연결한다. HTTP 오류 status, 네트워크 rejection, 서버 throw를 동일한 사건으로 합치지 않는다.
6. DB 쿼리 성공, 반환 레코드의 실제 내용, 트랜잭션 커밋은 여전히 런타임 관측 없이는 확정하지 않는다.
