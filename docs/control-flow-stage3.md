# 함수 내부 제어 흐름 분석 — 3단계 결과

작성일: 2026-11-09 (Asia/Seoul)

## 1. 수정·추가 파일과 변경 범위

| 파일 | 변경 |
| --- | --- |
| src/types/controlFlow.ts | 추가: 함수 CFG, statement·call·await 위치, 조건 경로, 완료 상태·finally context 타입 |
| src/types/analysis.ts | 선택적 functionControlFlows 메타데이터 추가 |
| src/lib/ast/controlFlowExtractor.ts | 추가: 기존 AST 함수/심벌 ID를 재사용하는 statement·호출·await 추출 |
| src/lib/ast/analyzer.ts | 기존 함수 후보에서 함수 내부 메타데이터 생성 호출만 추가 |
| src/lib/controlFlow/graphBuilder.ts | 추가: 구조적 분기·완료 상태 전파, finally context별 그래프 생성 |
| src/lib/controlFlow/validator.ts | 추가: 원본 함수·코드 위치·그래프·호출 근거 검증 |
| src/lib/controlFlow/controlFlow.test.ts | 추가: CFG 중심 32개 테스트 |
| src/types/behavior.ts | 선택적 상세 그래프 참조, callContexts, 확장 옵션 추가 |
| src/lib/behavior/controlFlowDetails.ts | 추가: 바깥 그래프를 바꾸지 않는 함수 상세 연결 |
| src/lib/behavior/flowBuilder.ts | 상세 CFG 부착 및 기존 제한 안내 문구 보완 |
| src/lib/behavior/flowValidator.ts | 상세 CFG 소유 함수와 호출 위치·조건 경로 검증 |
| src/lib/behavior/controlFlowDetails.test.ts | 추가: 이벤트/호출 유지·선택 확장·호환성·위조 거부 등 12개 테스트 |
| src/lib/behavior/fixtures/controlFlow.ts | 추가: 이벤트 핸들러의 if/await/return/throw/catch/finally 예제 |
| docs/examples/behavior-control-flow.json | 추가: 실제 입력과 생성된 CFG/BehaviorFlow 전체 JSON |
| docs/control-flow-stage3.md | 추가: 이 보고서 |

UI, 기존 그래프 컴포넌트, GitHub 인증·권한 검증, DB/API 구현, AI 생성, 기존 기능 분류와 AST 호출·JSX 관계 생성 규칙은 변경하지 않았다. CodeNode/CodeEdge/RepositoryFeature와 기존 source/target ID·stats 의미를 유지했다. 기존 API 핸들러는 수정하지 않았으며 RepositoryAnalysis 결과에 선택적 메타데이터만 추가했다.

## 2. 지원 구문 및 데이터 모델

### 지원하는 범위

- 함수 본문의 순차 statement, block, 간단한 변수 선언·표현식 statement.
- if/else if/else, 중첩 조건문. 조건 원문을 보존하고 참·거짓 양쪽 경로를 구성하되 조건 값을 계산하지 않는다.
- 조기 return, throw, 인라인 arrow의 표현식 본문에 대한 implicit return.
- try/catch/finally, catch 생략·catch 변수 생략, 정상 진행 및 abrupt completion의 finalizer 통과.
- await의 정확한 위치. 하나의 statement 안에 여러 표현식이 있어도 표현식 내부 호출 순서나 비동기 완료 순서를 만들지 않는다.
- 함수 선언·type/interface 선언 등은 바깥 함수가 내부 함수 본문을 실행하는 것으로 해석하지 않는다. 별도 함수 후보는 자기 CFG를 갖는다.

각 ControlFlowStatement는 ownerFunctionId, 종류, syntaxKind, 정확한 파일·행·열·offset·원문, depth, parentStatementId, branchPath, 조건 원문·위치, callSiteIds/awaitSiteIds, mayThrow, reachability를 가진다.

루트 statement의 depth는 0이며 block/분기/try/catch/finally 같은 어휘적 컨테이너를 내려갈 때 증가한다. finally context의 수는 어휘적 중첩 깊이와 다르다.

일반 syntaxKind는 TS AST 종류명이다. FinallyClause, ArrowExpressionBody, TruncatedStatements는 어댑터가 표시하는 명시적 파생 구간명이며 TypeScript SyntaxKind enum이 해당 이름을 제공한다고 주장하지 않는다. 그 경우에도 sourceCode와 위치는 실제 코드의 정확한 구간이다.

### 위치와 근거

- 행·열은 1부터, offset은 0부터 시작하며 끝 offset은 exclusive다. JavaScript/TypeScript 문자열의 UTF-16 위치다.
- 실제 statement는 원문 위치를 가진다. 그래프 entry/normal-exit/return-exit/throw-exit/analysis-boundary는 합성 제어 anchor이며 가짜 코드 줄 번호를 부여하지 않는다.
- graph node는 statementId로 실제 원문 statement를 참조한다. finally가 여러 context에 복제돼도 같은 원문 statement가 여러 코드 위치인 것처럼 꾸미지 않는다.
- call site는 각 실제 CallExpression의 위치로 고유 ID를 만들고 기존 resolver가 확인한 targetNodeId를 기록한다. sourceEdgeIds에는 실제로 일치하는 기존 call CodeEdge ID만 넣는다. 기존 병합으로 직접 대응하는 연결선이 없으면 ID를 생성해서 채우지 않는다.
- 동일 행의 같은 호출도 실제 call site 위치는 구분한다. 같은 기존 관계 ID를 공유할 수 있으나 이것을 실제 실행 횟수로 해석하지 않는다.
- 중첩 함수 본문은 바깥 함수의 statement/call/await로 가져오지 않는다. 기존 함수 ID/소유 함수 resolver로 경계를 확인한다.

## 3. 그래프 생성 규칙

FunctionControlFlow는 scope=function-body, semantics=intra-function-static-control-flow, runtimeExecution=not-observed를 명시한다. 함수 간 CodeEdge 그래프와는 별도 그래프다.

### 순차·분기·종료

- 정상 완료한 statement의 normal continuation만 다음 statement에 연결한다.
- if의 true/false 선은 문법상 가능한 분기다. 실제로 어느 쪽이 실행됐다고 결정하지 않는다.
- return은 return completion, throw는 throw completion을 만든다. 이 완료 상태는 정상 continuation에 포함하지 않는다.
- return/throw 뒤의 소스도 statement와 call site로 기록하되 정상 다음 단계로 잇지 않는다.
- 빈 함수는 entry → normal-exit이고, 표현식 arrow 본문은 실제 표현식 원문을 가진 implicit-return statement로 표현한다.

### 예외의 확실성 구분

명시적 throw와 표현식 평가 중 발생할 수 있는 예외를 구분한다.

- 명시적 throw 경로는 certainty=structural이다. 이것도 해당 statement가 실제 실행됐다는 뜻은 아니다.
- primitive literal/함수 값 생성처럼 처리한 단순 경우 외의 평가에는 보수적인 possible exceptional completion을 둘 수 있다. kind=exception, certainty=possible, reason=expression-may-throw로 표시한다.
- await rejection, 외부 호출/프로퍼티 평가 등의 정확한 예외 발생 여부는 확인하지 않는다. possible edge는 관측된 throw가 아니며, 현재 빈 로컬 함수라고 해서 그 호출의 부작용·예외를 interprocedural 분석으로 제거하지도 않는다.
- catch는 try 본문의 throw/possible exception만 받는다. catch 내부나 finally 내부의 새 throw를 같은 catch로 되돌리지 않는다.

### finally 완료 상태

정상 진행·return·throw가 같은 finalizer 입구에서 섞여 잘못된 출구로 나가지 않도록 context를 분리한다.

1. try/catch 결과를 normal/return/throw 완료 상태별로 모은다.
2. finally의 그래프 인스턴스를 pendingCompletion별로 구성한다. 원문 statement는 공유하고 graph node의 context만 구별한다.
3. finally가 정상 완료하면 원래 pending completion을 resume한다. return은 return-exit 쪽으로, throw는 바깥 catch 또는 throw-exit 쪽으로 전파된다.
4. finally 자체가 return/throw하면 이전 pending completion을 덮어쓴다.
5. 중첩 finally는 context stack을 유지한다. inner finalizer를 거친 완료 상태가 outer finalizer에 전달된다.

이 context별 복제는 서로 다른 정적 대안이며 cleanup 함수가 실제로 여러 번 호출됐다는 뜻이 아니다. return-exit은 함수 본문의 return completion이고 async 함수의 Promise가 외부에서 settle됐다는 뜻도 아니다.

### 미지원 및 예산

미지원 구간은 unsupported statement로 표시하고 analysis-boundary에서 모델링을 중단한다. 이 anchor는 실제 함수 종료가 아니다. 그 구간이 정상 종료·무한 반복·return·throw 중 무엇을 할지 가정하지 않는다. 따라서 미지원 try 본문이 반드시 finally로 진행한다고 잇지 않는다.

지원 구간의 조기 return 뒤는 unreachable-in-model로 표시할 수 있다. 반면 도달 가능한 opaque 구간이나 예산 초과 때문에 경로가 끊긴 경우, 연결되지 않은 statement는 unknown으로 보수적으로 표시한다. 현재는 함수 전체에 적용하는 보수적 fallback이므로 일부 사실상 도달 불가 구간도 unknown이 될 수 있다.

reachable-in-model은 모델 안에 가능한 경로가 하나 이상 있다는 뜻이며 무조건/실제 실행을 의미하지 않는다. possible exception edge를 포함한 도달성이며 런타임 증명이 아니다.

기본 상한은 함수별 statement 500, 어휘적 깊이 32, CFG node 2,000, CFG edge 4,000이다. 추가 opaque marker나 clause metadata가 생길 수 있다. 예산을 넘으면 partial과 제한 사항을 남기고 정상 continuation을 만들지 않는다.

## 4. BehaviorFlow 연결 방식

기존 이벤트 → 핸들러 → 함수 호출 노드와 연결선은 유지한다. CFG statement를 바깥 BehaviorFlow.nodes에 섞거나 기존 call 선을 실행 순서 선으로 바꾸지 않는다.

```ts
const flow = buildBehaviorFlow(analysis, entryPoint);

// 실제 AST 함수 ID 하나만 상세 확장할 데이터
const selected = buildBehaviorFlow(analysis, entryPoint, {
  expandFunctionIds: [handlerFunctionId],
});

// 이전 표현이 필요한 경우
const legacy = buildBehaviorFlow(analysis, entryPoint, {
  includeControlFlow: false,
});
```

- BehaviorNode.controlFlowId는 screen/function/server 선언의 상세 그래프를 가리킨다. event/api-request 같은 투영 노드에는 함수 CFG를 잘못 붙이지 않는다.
- BehaviorFlow.controlFlows에는 선택된 기존 함수 ID의 검증된 상세 그래프만 담는다. 기존 분석에 CFG 메타데이터가 없으면 추가하지 않으며, 소스 문자열로 임의 복원하지 않는다.
- 기존 call edge의 callContexts는 실제 callSiteId, statementId, CFG 인스턴스 ID, 어휘적 branchPath와 도달 상태를 제공한다.
- 조건문 안의 호출에는 해당 if statement ID 및 true/false 경로가 연결된다. if 뒤의 continuation처럼 단순 어휘적 guard 목록만으로 설명되지 않는 제어 의존성은 CFG 경로로 확인해야 한다.
- 한 call site가 finally의 여러 pending context에 존재하면 graphNodeIds가 여러 개일 수 있다. 호출 횟수나 실행 순서를 의미하지 않는다.
- outer call graph에는 return 뒤의 기존 정적 호출 관계가 남을 수 있다. 그 callContexts는 unreachable-in-model을 표시하고 상세 CFG에는 그 지점으로 가는 정상 경로가 없다.
- callContexts가 없다고 해서 호출이 무조건 실행된다는 뜻이 아니다. 파라미터 초기화, 미해석 호출, 원본 관계 병합 등으로 상세 연결이 없을 수 있다.
- 모든 바깥 연결선은 기존대로 static-relation/not-established를 유지한다. API 요청 선을 함수 호출의 제어 흐름으로 연결하는 작업은 이번 단계에 하지 않았다.

1·2단계의 JSON 예제는 덮어쓰지 않았다. 새 validator가 기존 출력도 유효하게 받아들이는 테스트를 유지했다. frozen RepositoryAnalysis를 변경하지 않는 테스트도 통과했다.

## 5. 실제 입력 및 JSON 출력

전체 원본 입력, 함수 CFG 및 BehaviorFlow는 [behavior-control-flow.json](examples/behavior-control-flow.json)에 있다. 생성기를 실행하고 두 검증기를 통과한 실제 결과다.

핵심 입력:

```tsx
const handle = async (ready: boolean) => {
  try {
    if (!ready) return;
    const value = await work();
    if (value) return value;
    throw new Error("missing");
  } catch (error) {
    recover();
    throw error;
  } finally {
    cleanup();
  }
  after();
};
return <button onClick={handle}>Run</button>;
```

입력은 work/recover/cleanup/after의 선언도 포함한다. 업무 성공/실패·DB 의미를 부여하지 않는 작은 예제다.

실제 핸들러 CFG 결과:

- statement 14개, graph node 21개, edge 25개.
- call site 4개(work/recover/cleanup/after), await site 1개.
- status=supported는 이 함수 본문의 문법이 현재 지원 범위에 든다는 뜻이다. 전체 기능/런타임 분석 완료를 뜻하지 않는다.
- cleanup의 동일 원문 statement는 pending return/throw에 대응하는 그래프 인스턴스로 구분된다.
- 모든 알려진 try/catch 경로가 return 또는 throw로 끝나므로 finally 뒤 after()는 unreachable-in-model이다. CFG에서 after()로 향하는 정상 continuation은 없다.
- 바깥 BehaviorFlow는 기존 이벤트·함수 관계의 노드 7개와 연결 6개를 유지한다. after 호출선이 남아도 callContexts가 도달 불가임을 보여준다.

핵심 제어 규칙 예시:

```text
try { return 1; } finally { cleanup(); }
  return -> finally[pending=return] -> resume(return) -> return-exit

try { throw 1; } finally { return 2; }
  throw -> finally[pending=throw] -> new return -> return-exit

try { const value = 1; } finally { cleanup(); }
after();
  normal -> finally[pending=normal] -> resume(normal) -> after
```

위 텍스트는 구조적 경로의 요약이다. cleanup의 possible exception 경로, 실제 ID 및 코드 위치 등 전체 데이터는 JSON에 있다. 어떤 경로가 실제 실행됐는지 결정하지 않는다.

## 6. 미지원 및 분석 한계

- for/for-of/for-in/while/do, switch, break/continue/label, with, class/enum 등 지원 집합 밖의 statement는 opaque 구간이다.
- ternary, 논리 short-circuit 및 논리 대입, optional chain, yield, comma expression의 내부 분기는 모델링하지 않는다. 해당 표현식이 지원 statement의 평가 부분에 있으면 unsupported 구간으로 남긴다.
- destructuring/using 변수 선언, destructuring catch binding도 이 버전에서는 미지원이다.
- 일반 표현식은 하나의 statement 평가 단위다. 지원되는 원문 안의 호출 위치가 여러 개여도 subexpression 평가 순서나 각 호출의 실제 실행을 증명하지 않는다.
- 함수 파라미터 초기화, module initialization, 중첩 함수의 호출·반환 연결은 scope 밖이다. 중첩 함수는 자기 본문 CFG만 가진다.
- 구문·타입 진단을 RepositoryAnalysis가 완전하게 제공하지 않으므로 CFG를 만들었다고 컴파일 가능성이나 정상 실행을 보장하지 않는다.
- expression-may-throw는 보수적인 가능성이다. 명시적 throw 이외에 정확히 어떤 평가가 실제로 throw하는지는 확인하지 않는다.
- 반환값/응답 상태/업무 결과, DB 모델·쿼리·트랜잭션, 외부 부작용, Promise 완료 및 이벤트 실행 순서는 추론하지 않는다.
- 원본 AST 스냅샷과 코드 범위의 일관성을 검증한다. 임의 외부 JSON의 완전한 스키마 검증이나 런타임 실행 증명은 아니다.

## 7. 테스트·빌드 검증

추가 회귀 테스트는 CFG 32개, BehaviorFlow 상세 연결 12개, 합계 44개다.

검증 항목:

- 순차 statement, if/else/else-if·중첩 조건 경로, 조기 return/throw 이후의 비정상 fallthrough 방지.
- explicit throw→catch와 possible exception의 확실성 구분.
- 정상/return/throw 각각의 finally 통과, finally return/throw의 덮어쓰기, 중첩 finalizer, context 간 잘못된 경로 혼합 방지.
- catch/finally의 throw를 같은 catch로 되돌리지 않음.
- 조건 안 호출과 await 위치, 실제 함수/연결 ID와 분리된 call site 위치.
- loop/switch/복잡 표현식·불투명 try 본문·예산 초과를 정상 경로로 연결하지 않음.
- 빈 함수, 중첩 callback/표현식 arrow, 같은 행의 여러 호출, source range 검증.
- 이벤트/호출 그래프 유지, 선택 함수 확장, 도달 불가 호출 context, frozen 입력 불변성, 과거 JSON 호환, 위조 근거 거부.

| 최종 검증 | 결과 |
| --- | --- |
| npm.cmd run typecheck | 통과 |
| npm.cmd run lint | 통과, 경고·오류 없음 |
| npm.cmd test -- --maxWorkers=2 | 37개 파일, 465개 테스트 통과; 기존 4개 파일/5개 테스트 건너뜀 |
| 신규 테스트 | 위 결과에 포함: CFG 32개 + BehaviorFlow 상세 연결 12개 = 44개 통과 |
| npm.cmd run build | 통과, 컴파일·타입 검사·페이지 생성 완료 |
| git diff --check | 통과 |

전체 테스트는 기존과 같이 --maxWorkers=2로 실행하고, 빌드는 테스트 종료 후 별도로 실행했다. 테스트 제한 시간을 늘리거나 기존 테스트를 비활성화하지 않았다. 마지막 린트의 미사용 타입 import 경고는 정리 후 재검사하여 해소했다.

건너뛴 5개는 기존 외부 연동 설정에 따른 결과다. 실제 GitHub·운영 DB·AI 서비스나 브라우저 런타임 실행을 검증한 것은 아니다. 기존 실제 로컬 RepoTutor 소스 subset 회귀 테스트도 새 메타데이터를 포함한 상태로 통과했지만 저장소 전체의 완전한 제어 흐름 해석을 보장하지 않는다.

테스트·빌드는 하위 프로세스 실행을 허용한 환경에서 npm.cmd로 실행했다. JSON 생성용 임시 테스트 파일은 검증 후 제거했고 최종 44개 수에 포함하지 않았다. 자동 변경된 next-env.d.ts와 tsconfig.tsbuildinfo는 작업 시작 상태로 복구했다.

## 8. 다음 단계: API 경계 및 함수 간 흐름

1. 현재 callSiteId/statementId/targetNodeId와 caller CFG의 정상·예외 continuation을 기준으로 명시적인 interprocedural call context를 설계한다. callee의 모든 exit를 임의의 caller로 합치지 말고, 호출 위치별 정상 복귀·예외 전파 위치를 구분한다.
2. 재귀·공유 함수를 무제한 펼치지 않고 문맥 ID·깊이/노드 예산·함수 요약을 둔다. finally의 pending completion처럼 서로 다른 호출 문맥이 섞이지 않도록 한다.
3. API 요청은 기존의 확인된 URL/메서드/라우트 export 근거와 request site의 정확한 offset·statement/branch를 결합하는 별도 경계로 연결한다. native fetch 호출의 대상 함수 ID와 서버 handler ID를 동일한 것으로 취급하지 않는다.
4. 서버 throw가 곧바로 클라이언트 catch로 전달된다고 가정하지 않는다. HTTP 응답, 네트워크 실패, 클라이언트 await/상태 검사 사이에는 별도의 확인된 근거가 필요하다. HTTP 오류 상태와 Promise rejection도 구분해야 한다.
5. 반환 expression 원문과 실제 반환 데이터 계보·응답 의미는 별도 분석이다. DB 어댑터와 데이터 흐름 증거가 생기기 전에는 DB/성공/실패 단계를 생성하지 않는다.
6. 통합 API·캐시는 기존 GitHub 권한 검사 뒤에서 사용해야 한다. 과거 캐시에는 새 메타데이터가 없을 수 있으므로 버전/재분석 정책을 별도 설계해야 하며, 이번 단계에는 인증·API·DB·UI를 변경하지 않았다.
