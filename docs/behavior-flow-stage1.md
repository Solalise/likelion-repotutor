# BehaviorFlow 1단계 설계·구현 결과

작성일: 2026-11-09 (Asia/Seoul)

## 범위

기존 RepositoryAnalysis, CodeNode, CodeEdge, RepositoryFeature 및 기존 AST·DFS·학습/개발자 그래프를 그대로 유지했다. 새 계층은 이미 생성된 RepositoryAnalysis를 읽는 독립적인 순수 변환기다. UI, 인증·GitHub 권한, DB/API, AI 컨텍스트·프롬프트·설명 생성에는 연결하지 않았다.

이 단계의 결과는 실행 흐름도 완성본이 아니라 **근거가 있는 정적 관계의 부분 투영**이다. 배열 순서나 화살표를 실제 실행 순서·호출 횟수·조건 충족·성공 결과로 해석하면 안 된다.

## 1. 현재 AST가 실제로 제공하는 정보

| 항목 | 실제 추출 및 사용 범위 | 근거/관련 코드 |
| --- | --- | --- |
| Next.js 페이지 | app/**/page.ts(x), src/app/**/page.ts(x) 등 파일 기반 default runtime export를 기존 함수 ID로 연결. 이름이 Page/LoginPage라는 이유만으로 진입점으로 정하지 않음 | entryPointMetadata.ts, RepositoryEntryPoint |
| API 진입점 | route.ts(x)의 실제 export된 GET/POST 등 HTTP 메서드. 별칭·재-export도 선언 해석이 가능할 때 연결 | entryPointMetadata.ts, apiRelations.ts |
| 기존 모바일 파일 라우트 | app/**/index.tsx 형태도 app-index로 제공. next-app과 구별해야 함 | RepositoryEntryPoint.framework |
| 함수 선언과 호출 | 함수·arrow·method·inline callback, 위치/lexical scope 기반 ID, 직접 해석 가능한 선언/const 별칭/import 대상 호출. 외부 패키지나 해석할 수 없는 심벌은 targetId 없음 | analyzer.ts의 collectCandidates, targetId, analyzeRelations |
| React/JSX | 컴포넌트 사용과 JSX 속성에 전달되는 함수 참조, 함수 인자로 전달된 콜백 참조. inline callback 본문은 별도 함수 경계 | FunctionRelation의 component/reference |
| API 요청 | 기본 fetch, 실제 default axios import 등 확인 가능한 transport의 정적 경로·메서드. 동일 앱의 유일한 Next route handler와 정적으로 연결 가능한 경우 api 관계 생성 | apiRelations.ts의 analyzeApiRequest/connectApiRequests |
| API 라우트 선택 | 정적 경로 우선, 동적 segment/catch-all/optional catch-all, HTTP 메서드, monorepo 앱 경계, root app 우선, runtime export를 고려 | 기존 apiRelations.ts의 라우트 매칭 |
| 코드 위치 | CodeNode 및 FunctionInfo의 filePath/line/endLine/sourceCode. FunctionRelation/CodeEdge의 시작 line, 최대 240자로 정규화·잘린 evidence | analysis.ts, analyzer.ts, graphBuilder.ts |
| 확정 여부 | 선언 대상을 해석한 관계의 confirmed와 미해석/추정 관계의 inferred. 미해석 관계는 files[].functions[].relations에 남고 CodeEdge는 targetId가 존재해야 만들어짐 | FunctionRelation, CodeEdge |
| 파일 의존성 | import 파일 간 관계. 함수 실행 관계와 다르므로 새 흐름에서는 연결선으로 사용하지 않음 | graphBuilder.ts |

페이지/API 메타데이터는 private/parallel/intercepting route 등 기존 추출기가 제외하는 경우를 그대로 따른다. 모든 Next.js 라우팅 기능이나 모든 프레임워크를 지원한다고 주장하지 않는다.

## 2. 아직 구조적으로 추출하지 않는 정보

- if/switch/삼항식/반복문/예외/조기 종료의 제어 흐름과 조건 참·거짓 경로.
- await/Promise/콜백/이벤트/렌더링의 실제 실행 시점, 함수 간 전체 실행 순서, 호출 횟수, 실행 가능성.
- JSX 속성이 실제 React 이벤트인지, 사용자 행동이 실제 발생하는지, 사용자 정의 컴포넌트의 prop이 내부에서 어떻게 호출되는지에 대한 의미적 연결.
- DB 클라이언트/모델/조회·변경/트랜잭션의 의미적 식별. db.user.findMany 등은 일반 미해석 호출 문자열로 남을 수 있고, 로컬 저장소 헬퍼는 일반 함수 호출일 뿐이다.
- 반환값, 응답 상태/필드, 요청 인자와 DB·화면 결과 사이의 데이터 계보.
- 동적 URL/메서드, spread 옵션, 사용자 정의 API 클라이언트, 일부 별칭/패키지 외부 구현, 서버 액션·middleware·rewrite의 종합 의미.
- 업무 기능 단위의 완전한 자동 분류. 기존 RepositoryFeature의 경로 기반 한글 제목 등은 표시용 추정일 수 있다.
- 열/offset과 export 구문의 정확한 위치. 재-export의 route 파일과 실제 함수 정의 파일이 다를 수 있다.
- 같은 source/relation/target/line의 관계는 기존 추출기에서 중복 제거될 수 있다. 이미 소실된 동일 행의 여러 호출/여러 JSX 속성을 복원하거나 호출 횟수로 계산할 수 없다.
- 실제 회귀 예제에서 같은 행의 GET·POST 요청이 같은 재-export 핸들러를 가리키면 원본 FunctionRelation에는 2개가 남지만 CodeEdge의 ID가 같아 1개로 줄었다. 새 계층은 남은 1개만 확정 연결하고 나머지는 evidence-unavailable로 보존한다. 서로 다른 행의 요청은 두 요청 위치와 각 메서드 근거를 보존한다.
- 구문/타입 오류 진단은 RepositoryAnalysis에 구조화돼 전달되지 않는다. 정적 관계를 찾았다고 해서 저장소가 타입 검사되거나 실행 가능한 상태라는 뜻은 아니다.

함수 본문의 원문에 조건문·DB 코드·return이 포함돼 있어도 구조화된 추출 결과는 아니다. 특히 기존 learningGraphBuilder의 sample 전용 로그인 설명·조건/결과 노드는 교육용 데모다. 새 계층은 해당 그래프나 labelGenerator를 가져오지 않는다.

현재 AST 호출 흐름은 analyzeSourceFiles → 관계/API 연결 → buildGraph → entryPoints 및 RepositoryAnalysis 반환이다. featureDiscovery는 확인된 outgoing 관계와 진입점 경계를 사용하고, RepositoryWorkspace는 이를 기존 학습/개발자 그래프로 투영한다. 새 생성기는 이 호출부를 수정하지 않았다. callAnalyzer.ts의 이름 목록 헬퍼를 새 확정 근거로 사용하지도 않는다.

## 3. 추가 파일 및 데이터 모델

| 파일 | 역할 |
| --- | --- |
| src/types/behavior.ts | BehaviorFlow, BehaviorNode, BehaviorEdge, BehaviorEvidence, 미해결 관계·제한·검증 결과 및 옵션 |
| src/lib/behavior/flowBuilder.ts | 단일 진입점 및 저장소 단위 정적 관계 투영 |
| src/lib/behavior/evidenceMapper.ts | 원본 선언·관계·파일의 근거 매핑, 불명확한 중복 ID 배제 |
| src/lib/behavior/flowValidator.ts | 생성 결과의 원본 근거·참조 무결성과 V1 계약 검증 |
| src/lib/behavior/fixtures/nextLogin.ts | 작은 Next.js/React/TypeScript 입력 예제 |
| src/lib/behavior/flowBuilder.test.ts | 생성·경계·미해결·순환·불변성·실제 소스 테스트 |
| src/lib/behavior/evidenceMapper.test.ts | 원본 위치·다중 행·잘못된 위치/ID/근거 테스트 |
| src/lib/behavior/flowValidator.test.ts | 위조 근거, 실행 순서 주장, 근거 없는 노드 역할 등의 거부 테스트 |
| docs/examples/behavior-login.json | 생성기를 실제 실행해 저장한 전체 입력 및 출력 |
| docs/behavior-flow-stage1.md | 이 설계·결과 보고서 |

### 모델의 중요한 구분

- BehaviorFlow: schemaVersion=1, repository/선택 진입점/선택적 commitSha, 노드·연결·근거·미해결 관계·제한. semantics=static-code-relations, executionOrder=not-established.
- status는 partial 또는 unavailable이다. 정상 생성도 지원하지 않는 실행·분기·DB·결과 의미가 있으므로 완성 상태로 표시하지 않는다.
- BehaviorNode의 확장 어휘에는 screen/event/function/api-request/server/data-access/condition/result/unknown이 있다. **V1이 생성하는 종류는 screen/function/api-request/server뿐**이다.
- screen/server는 CodeNode.type이나 함수 이름이 아니라 기존 실제 진입점 메타데이터로 결정한다. 나머지는 선언된 함수라는 사실만 표현한다.
- api-request는 원본 코드의 정적 요청 위치에 추가되는 투영 노드다. 별도의 AST 함수가 있는 것처럼 꾸미지 않고, 호출자 sourceNodeIds 및 실제 요청 sourceEdgeIds를 가리킨다.
- BehaviorEdge는 관계 의미, confidence, semantics, executionOrder를 별도 필드로 가진다. V1은 confirmed/static-relation/not-established만 생성한다. call/reference/component는 서로 바꾸지 않는다.
- confirmed는 실행 확정이 아니라 정적 코드 근거의 확인이다. inferred/unknown 어휘는 유지하지만, V1에서 추정 관계를 확정 연결선으로 승격하거나 탐색 범위를 넓히지 않는다. 원래 inferred 관계는 unresolved에 원래 신뢰도로 남는다.
- BehaviorEvidence는 원본 선언, 기존 entry metadata 또는 FunctionRelation을 출처로 가진다. 파일 경로·1부터 시작하는 줄 범위·실제 파일의 excerpt와 기존 노드/연결 ID를 보존한다.
- entry metadata에는 export 줄 번호가 없으므로 precision=file을 사용한다. 실제 선언은 별도 근거의 정확한 파일·줄 범위에 연결한다. export 줄 번호를 1로 가정하지 않는다.
- 관계 근거의 endLine은 기존 evidence 문자열을 포함하는 최소 원본 범위다. 기존 문자열은 잘릴 수 있으므로 전체 표현식의 정밀한 끝 위치라고 주장하지 않는다. 시작 근거가 실제 해당 시작 행에 있는지도 검사한다.

## 4. 생성 규칙과 경계

공개 함수:

```ts
buildBehaviorFlows(analysis, options?) // BehaviorAnalysis
buildBehaviorFlow(analysis, entryPoint, options?) // BehaviorFlow
validateBehaviorFlow(flow, analysis) // { valid, errors }
```

1. 기존 analysis.entryPoints에 실제로 등록되고 선언과 entry 파일 근거를 매핑할 수 있는 진입점만 선택한다. 지원 진입점이 없으면 flows=[]와 제한 사항을 반환한다. 잘못된 단일 선택은 unavailable 및 빈 그래프다.
2. 선언 ID로 함수를 찾고, CodeNode와 FunctionInfo, 파일 원문·줄 범위가 일치하는지 확인한다. 동일 ID의 서로 다른 레코드는 임의 선택하지 않는다.
3. 해당 함수의 원본 FunctionRelation과 CodeEdge의 source/target/relation/line/evidence/confidence를 대조한다. confirmed와 원본 근거를 모두 충족해야 연결한다.
4. 확인된 outgoing call/reference/component만 따라간다. incoming을 역추적해 같은 헬퍼를 사용하는 다른 기능을 끌어오지 않는다. 함수 이름으로 업무 역할이나 DB를 분류하지 않는다.
5. 다른 페이지/API 진입점으로 직접 건너가는 일반 호출·참조는 경계로 남긴다. 동일 흐름의 자기 참조·순환은 ID 기준으로 한 번만 확장한다.
6. 기존 API 관계가 confirmed이며 대상이 해당 HTTP 메서드의 실제 API 진입점으로 등록된 경우에만 요청 위치 노드와 두 연결선을 생성한다: 호출자 --api-request--> 요청 위치 --api-route--> API 진입점. 두 선은 같은 원본 요청 근거를 공유한다.
7. API 진입점은 페이지 흐름에서 leaf 경계다. API 내부 호출은 그 API를 시작점으로 생성한 별도 흐름에서 확인한다. API 이후 DB·반환 결과를 만들지 않는다.
8. 경로/메서드/대상/근거가 확인되지 않으면 미해결 관계와 가능한 근거만 남긴다. 가짜 대상 노드나 인접 API 경로 fallback은 만들지 않는다.
9. 같은 정적 연결은 합치되 다른 행의 원본 sourceEdgeIds와 evidenceIds를 보존한다. 순환은 queue+visited로 처리하며 정렬은 출력 결정성을 위한 것이지 실행 순서가 아니다.
10. 기본 탐색 예산은 깊이 12, 노드 200, 연결 400이다. 옵션의 상한은 각각 50/1,000/2,000이며, 제외된 관계는 traversal-limit로 기록한다. API 요청의 두 연결은 함께 예산을 검사해 반쪽 요청 단계를 만들지 않는다.
11. 최종 검증에서 무효한 결과는 빈 unavailable 흐름으로 반환하고 invalid-analysis 제한을 남긴다. 검증기가 실행 순서나 업무 의미를 새로 분석하는 것은 아니다.

RepositoryFeature는 변경하거나 자동 재분류하지 않는다. 후속 호출자는 feature.entryNodeId/entryFilePath/routePath/httpMethod와 일치하는 실제 analysis.entryPoints 항목을 선택할 수 있다. 수동/internal feature를 임의의 라우트 진입점으로 바꾸지 않는다.

## 5. 실제 입력 및 출력 예시

전체 입력과 원본 ID·근거를 포함한 실제 출력은 [behavior-login.json](examples/behavior-login.json)에 있다. 이 파일은 문서용으로 손으로 구성한 그래프가 아니라 새 생성기를 실행한 결과다.

입력 중 핵심 파일:

```tsx
// app/login/page.tsx
import { submit } from "../../lib/submit";
export default function LoginPage() {
  const onSubmit = () => submit();
  return <button onClick={onSubmit}>Sign in</button>;
}
```

```ts
// lib/submit.ts
export function submit() {
  return fetch("/api/login", { method: "POST" });
}
```

```ts
// app/api/login/route.ts
import { save } from "../../../lib/storage";
export async function POST() {
  return save();
}
// lib/storage.ts
export function save() { return { ok: true }; }
```

입력에는 같은 submit을 참조하는 별도 SettingsPage도 있다. /login 흐름에 SettingsPage나 API 내부의 save를 합치지 않는다.

출력 요약(가독성을 위해 ID를 label로 표시한 투영):

| source | relation | target | 실제 관계 근거 |
| --- | --- | --- | --- |
| LoginPage (screen) | reference | onSubmit (function) | app/login/page.tsx:4, onClick={onSubmit} |
| onSubmit | call | submit (function) | app/login/page.tsx:3, submit() |
| submit | api-request | POST /api/login (api-request) | lib/submit.ts:2, fetch 요청 |
| POST /api/login | api-route | POST (server) | 같은 lib/submit.ts:2 요청 근거 + API route export 메타데이터 |

실제 결과는 노드 5개, 연결 4개, 근거 11개, status=partial이다. 4개 연결 모두 static-relation/not-established다. 원래의 native button 참조, 외부 fetch 함수 호출처럼 대상이 미해석인 관계도 unresolved에 남는다.

별도로 /api/login POST에서 생성하면 POST → save의 일반 call 관계가 나온다. save라는 이름과 객체 반환만으로 DB 접근이나 성공 응답을 확정하지 않는다. /login에서 /api/missing, 동적 URL, 알 수 없는 메서드를 요청하면 그 요청을 임의의 POST 엔드포인트로 연결하지 않는다.

## 6. 테스트 및 검증

새 테스트는 네트워크·DB·AI 호출 없이 기존 analyzeSourceFiles로 예제 소스를 분석한다. 실제 RepoTutor 테스트도 로컬의 아래 네 파일 일부만 사용한 subset 검증이며 저장소 전체를 완전하게 해석했다는 의미는 아니다.

- src/app/repository/page.tsx
- src/components/repository/RepositoryWorkspace.tsx
- src/app/api/repositories/[connectionId]/analyze/route.ts
- src/lib/github/repositoryAccess.ts

확인한 시나리오:

- 페이지·이벤트 속성 참조·함수 호출·정적 API 요청의 원래 관계 보존.
- 다른 페이지 및 API 내부 구현의 무분별한 합류 방지.
- 동적/미일치/외부 URL, 알 수 없는 옵션/메서드, 로컬 fetch 이름의 오연결 방지.
- 컴포넌트/콜백 참조를 이벤트 실행으로 승격하지 않음.
- 같은 행·서로 다른 행의 호출, 중복 ID, 순환, 탐색 예산, 입력 순서 변경과 출력 결정성.
- 재-export된 페이지와 하나의 핸들러를 GET/POST로 함께 export한 API.
- 원본 관계·sourceCode·위치·confidence와 맞지 않는 연결, 위조된 이벤트/분기/DB/결과 역할 및 실행 순서 주장의 거부.
- frozen RepositoryAnalysis/RepositoryFeature 불변성, 미지원/빈 저장소의 제한 반환.

| 최종 검증 | 결과 |
| --- | --- |
| npm.cmd run typecheck | 통과 |
| npm.cmd run lint | 통과, 경고·오류 없음 |
| npm.cmd test -- --maxWorkers=2 | 33개 파일, 368개 테스트 통과; 기존 4개 파일/5개 테스트 건너뜀 |
| 신규 behavior 테스트 | 위 결과에 포함: 생성기 27, 근거 매퍼 6, 검증기 19, 합계 52개 통과 |
| npm.cmd run build | 통과, 컴파일·타입 검사·페이지 생성 완료 |
| git diff --check | 통과 |

첫 기본 전체 테스트는 빌드와 동시에 실행해 여러 AST 테스트가 기존 5초 제한을 초과했다. 테스트나 시간 제한 설정을 변경하지 않고, 빌드 종료 후 --maxWorkers=2로 재검증해 기존 테스트의 시간 초과가 해소됨을 확인했다. 이 재실행에서 드러난 신규 동일 행 다중 API 예제의 기대치는 기존 AST 소실 동작을 명시적으로 반영했고, 서로 다른 행의 보존 및 같은 행의 미해결 처리 테스트를 분리했다. 최종 전체 재실행은 모두 통과했다.

건너뛴 5개는 기존 외부 연동 환경 설정에 따른 결과다. 실제 GitHub/운영 DB/AI 서비스 E2E 검증을 수행한 결과가 아니다. 이번 신규 실제 소스 테스트는 로컬 파일 분석만 수행한다.

PowerShell 실행 정책 때문에 npm.cmd를 사용했고, 테스트·빌드는 하위 프로세스 실행이 허용되는 환경에서 실행했다. 자동 변경된 next-env.d.ts와 tsconfig.tsbuildinfo는 작업 시작 상태로 복구했다. 예제 JSON 생성을 위한 임시 테스트 파일은 산출물 생성·검증 후 제거했으며 최종 52개 테스트 수에는 포함하지 않았다.

## 7. 다음 단계 AST 확장 추천 순서

1. **위치·근거 구조화**: declaration/export/call/JSX/API 요청별 시작/끝 행·열·offset, 원문 범위, 원본 식별자, 미해결 이유를 추출한다. 관계 evidence의 240자 문자열은 표시용으로 두고 정밀 근거와 분리한다. entryPointMetadata.ts, analyzer.ts, analysis.ts부터 설계한다.
2. **이벤트 바인딩**: intrinsic JSX 이벤트와 사용자 정의 컴포넌트 prop 전달을 구분하고 실제 바인딩/인라인 콜백 경계를 추출한다. 단순 on 접두사나 handler 이름으로 이벤트 실행을 확정하지 않는다. 컴포넌트 간 prop→parameter→호출 연결은 별도 근거가 있어야 한다.
3. **함수 내부 제어 흐름**: if/switch/return/throw/loop/try와 await를 AST statement 단위로 기록한다. 호출 그래프 위에 임의의 앞뒤 순서를 추가하지 말고 함수 내부 CFG의 분기/합류/예외 경로부터 테스트한다. 정적으로 가능한 제어 흐름과 실제 runtime 관측도 구분한다.
4. **API 연결 확장**: 현재 confirmed 매칭을 보존하면서 안전한 상수 해석, 알려진 클라이언트 어댑터와 라우팅 지원을 확장한다. 동적·외부 요청은 미해결 이유를 보존한다. API boundary를 확장할 때는 별도 subflow의 실제 handler 근거로 연결하고 다른 기능 범위를 무분별하게 합치지 않는다.
5. **DB 어댑터**: 실제 import/타입/생성 경로로 확인한 Prisma·다른 ORM/드라이버만 의미를 부여한다. read/write/모델/트랜잭션 근거를 추출하고, 함수 이름이나 db/save/query 문자열은 확정 기준으로 쓰지 않는다.
6. **반환 및 데이터 계보**: 반환 식, 응답 상태·필드, 함수 인자·요청·조회 결과 사이의 연결을 구조화한다. 반환값이 존재한다는 사실과 성공/실패의 업무 의미를 분리한다.
7. **통합은 별도 단계**: 추출 회귀 테스트가 통과한 뒤 BehaviorEvidence와 validator의 버전을 확장한다. 이후 기존 GitHub 권한 검사 뒤에서만 새 분석기를 호출하고 UI를 opt-in으로 추가한다. 이번 단계에서는 API/DB/기존 그래프를 교체하거나 새 출력에 연결하지 않았다.

현재 validator는 신뢰할 수 있는 기존 RepositoryAnalysis 스냅샷과의 일관성을 검사한다. AST 라우트/심벌 해석기를 독립 재실행하지 않으며, 임의 외부 JSON의 완전한 스키마 검증기나 런타임 증명기는 아니다. 향후 API 입력으로 받을 경우 별도 런타임 스키마 검증 및 기존 권한 경계가 필요하다.
