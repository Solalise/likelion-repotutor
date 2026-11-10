# 4-D: BehaviorFlow 실제 저장소 통합 검증

**판정: 완전한 자동 end-to-end 흐름 UI의 준비 기준은 충족하지 못했다.** 확인된 코드와 미해결 상태를 분리하는 근거 탐색 UI는 조건부로 가능하다. 테스트 통과, ID 무결성, 작은 fixture의 성공을 실제 저장소의 의미적 완성도로 해석하지 않는다.

이번 단계에서는 분석 기능을 확장하거나 UI/기존 그래프/인증/API/DB/AI 코드를 수정하지 않았다. 검증 코드와 보고서만 추가했다.

작업 후 manifest와 SHA-256을 다시 대조해 분석 대상 운영 소스 91개 파일이 모두 변경되지 않았음을 확인했다.

## 1. 대상과 재현 방법

대상은 `D:/likelion-repo`의 **현재 미커밋 작업 트리**다. GitHub 원격 최신 상태를 내려받은 검증이 아니다. `src`의 production TS/TSX/JS/JSX 91개 파일, 입력 490,532 bytes를 읽었다. 테스트, `.d.ts`, fixture, 이번 validation 디렉터리는 제외했다. 외부 React/Next/Prisma 패키지 내부, Prisma schema/실제 DB, 브라우저 실행은 검증 범위 밖이다.

[기계 판독 보고서](validation/behavior-audit-stage4d.json)에 HEAD, 파일별 SHA-256, Node/OS, 실제 관측 ID·소스 위치, 정답 행, 시간·크기, 미지원 구간을 기록했다. HEAD만 체크아웃해서는 이 미커밋 스냅샷을 재현할 수 없다. 파일 해시가 기준이다. next.config.ts는 별도로 확인했으며 serverExternalPackages만 있고 basePath/rewrites 설정은 없었다.

수동 정답은 [gold.ts](../src/lib/behavior/validation/gold.ts)에 작성했다. 실제 결과에서 정답을 역으로 생성하지 않았다. 문자열 anchor가 바뀌거나 사라지면 테스트가 실패하므로 소스 변경 시 수동 재검토가 필요하다. 인라인 DOM 이벤트는 **DOM→콜백**과 **콜백→함수 호출**을 별도 행으로 검토한다.

```powershell
$env:REPOTUTOR_WRITE_AUDIT = "1"
npm.cmd test -- src/lib/behavior/validation/pipelineAudit.test.ts --maxWorkers=1
Remove-Item Env:REPOTUTOR_WRITE_AUDIT
```

환경변수는 보고서 쓰기만 제어한다. 일반 전체 테스트에서도 실제 91개 파일과 fixture 검증을 실행한다. 중량 통합 검증의 beforeAll에만 180초 상한을 두었고 기존 테스트의 제한 시간은 바꾸지 않았다. 네트워크·DB 쿼리·OAuth·AI 호출은 하지 않는다.

fixture는 정적 AST 입력이며 별도 Next 개발 서버나 Prisma DB를 실행하는 애플리케이션이 아니다. 루트 타입 검사/빌드는 기존 RepoTutor와 검증 코드를 검사하며, 문자열 fixture를 독립 Prisma 애플리케이션으로 빌드했다는 뜻은 아니다.

추가 파일 8개:
- `src/lib/behavior/validation/pipelineFixture.ts`: 합성 Next/React/Prisma AST 입력.
- `src/lib/behavior/validation/gold.ts`: 실제/fixture 수동 정답.
- `src/lib/behavior/validation/oracle.ts`: 관찰·분류·분모 정의.
- `src/lib/behavior/validation/auditRunner.ts`: 실제 소스 수집, 파이프라인, ID 무결성, 성능 측정.
- `src/lib/behavior/validation/pipelineAudit.test.ts`: 10개 통합/측정 검증.
- `docs/validation/behavior-audit-stage4d.json`: 실제 측정 보고서.
- `docs/validation/behavior-audit-fixture.json`: fixture 입력과 수동 정답 스냅샷.
- 본 보고서.

## 2. 파이프라인과 ID 연결

분석 결과는 1,128개 함수, 1,931개 원본 관계, 12개 진입점을 포함했다. 이 중 페이지 1개와 API 3개의 최종 Flow를 생성·검증했다. 전체 12개 진입점의 모든 관계를 수동 검토한 것은 아니다.

| 단계 | 실제 연결 키/근거 | 검증 결과와 의미 |
| --- | --- | --- |
| AST | CodeNode.id, CodeEdge.id, FunctionInfo.id, 원문·위치 | 기존 코드 ID를 기준으로 연결. 관계는 호출/참조/컴포넌트/API 의미를 보존 |
| 기능 발견 | RepositoryFeature.entryNodeId/nodeIds/edgeIds, routePath/httpMethod | 선택한 4개 진입점의 기능 발견 확인. 업무 이름은 이 보고서에서 수동으로 붙였으며 자동 의미 분류 성공을 주장하지 않음 |
| React 이벤트 | binding.id, ownerNodeId, targetNodeId, JSX 원문 | DOM binding과 inline callback/함수 호출을 구분. custom component prop은 DOM 이벤트로 확정하지 않음 |
| 함수/CFG | ownerFunctionId, callSite.id, statement.id, graphNodeIds, branchPath, callContexts | 정확한 위치와 함수 대상 연결. 함수 간 호출선과 함수 내부 제어 흐름을 구분 |
| HTTP | request.id, context.callSiteId, boundary.serverEntryPoint/serverFlowId | fixture의 정적 POST는 연결. 실제 검증 대상 URL은 동적이라 경계 미해결 |
| Prisma | database site.id, serverContext.id/callPath, clientEvidence | fixture의 생성자 출처는 확인. 실제 캐시 singleton 관련 검토 4건은 unverified-client |
| 응답 | creation.id, return.responseSiteId, serverContext.callSiteIds, source.databaseSiteId, databaseContextId | fixture 직접 반환·출처 확인. 실제 wrapper는 로컬 생성과 API 반환이 합성되지 않음 |
| 최종 Flow | BehaviorNode.sourceNodeIds/sourceEdgeIds, controlFlowId, 각 metadata ID | 선택한 실제 Flow 4개와 fixture Flow 3개의 provenance 검증 및 참조 해석 오류 0건 |

ID 무결성 통과는 모든 의미가 정확하다는 뜻이 아니다. 실제 코드를 실행한 분기·순서·성공·커밋·응답 전달은 관측하지 않았다.

**운영 경로 연결의 별도 공백:** 현재 분석 API는 RepositoryAnalysis를 반환한다. `src/app`/`src/components`에서 buildBehaviorFlow(s)를 호출하는 운영 호출부는 없다. 현재 Workspace는 기존 학습용/개발자용 그래프를 사용한다. 이번 테스트는 이 독립 계층을 순서대로 호출한 오프라인 통합이며, 최종 Flow를 UI에 공급하는 운영 통합 완료가 아니다.

## 3. 실제 기능별 결과

### A. 샘플 저장소 분석

진입점: `/repository` → RepositoryPage, 별도 서버 `GET /api/analyze`. `RepositoryWorkspace.tsx:253`의 샘플 버튼 DOM→인라인 콜백→runAnalysis, `:96`의 fetchAnalysis 호출을 확인했다. `/api/analyze/route.ts:69`의 analyzeSample 호출과 json wrapper 호출, `:14`의 실제 NextResponse.json 생성도 확인했다.

- 올바른 연결: 페이지→Workspace, 이벤트→콜백→runAnalysis, runAnalysis→fetchAnalysis, GET→analyzeSample/json, wrapper의 응답 생성.
- 미해결: `RepositoryWorkspace.tsx:35`의 `/api/analyze?${params}` 전체 URL이 dynamic-url. 사람은 pathname이 고정임을 알 수 있지만 추출기는 query와 분리하지 않는다.
- 미해결: `return json(await analyzeSample())`의 반환 합성은 return-value-unresolved. helper의 NextResponse 생성이 API 반환으로 자동 연결되지는 않는다.
- DB: 이 샘플 경로의 검증 대상으로 두지 않았으며 N/A다.

### B. 연결 저장소 분석과 분석 기록 저장

진입점: 같은 페이지의 다시 시도 이벤트(`RepositoryWorkspace.tsx:265`) 및 별도 서버 `GET /api/repositories/[connectionId]/analyze`. 인라인 콜백→runAnalysis, fetchAnalysis의 connected 분기(`:26`), 서버의 requireRepositoryAccess 호출(`route.ts:19`)을 확인했다. 다시 시도 이벤트에 실제로 어떤 lastRequest가 들어갔는지 실행 관측한 것은 아니다.

- 올바른 연결: DOM/콜백/함수 호출 및 connected 요청의 true CFG 경로, API→권한 helper.
- 미해결: connectionId로 구성한 구체 URL은 dynamic-url. 수동 정답의 API 대응은 유효한 식별자와 일반 App Router 라우팅을 전제로 한 코드상 가능한 대상이며 실제 전송 증거가 아니다.
- 출처 불명: `db.analysisRun.create`(`route.ts:21`), `db.userRepository.findFirst`(`repositoryAccess.ts:15`)는 후보/서버 문맥만 남고 unverified-client다. 이를 DB 성공 연결로 계산하지 않았다.
- 미해결: `return repositoryJson(cached ? ...)`(`route.ts:51`)은 wrapper 반환. `repositoryAccess.ts:63`의 NextResponse 생성은 별도 helper 근거로 확인됐다.

### C. AI 설명 요청과 학습 기록

진입점: `/repository`에서 포함되는 AiLearningPanel의 첫 생성 버튼(`AiLearningPanel.tsx:62`) 및 별도 서버 `POST /api/repositories/[connectionId]/learn`. DOM→인라인 콜백→generate를 확인했다. `:36`의 요청 소유 함수/CFG, 서버 `route.ts:45`의 권한 helper 호출을 확인했다.

- 미해결: 동적 connectionId URL로 HTTP 경계를 확정하지 않는다.
- 출처 불명: `db.learningRecord.findUnique`(`:86`) 및 upsert(`:109`)의 전역 캐시 클라이언트 출처는 미확인이다.
- 미해결: `return repositoryJson({ explanation: ... })`(`:124`)은 직접 응답 반환으로 합성되지 않는다.
- 데이터 계보: record.updatedAt.toISOString()은 변환이고 DB 출처도 불명확하며 wrapper까지 있으므로 createdAt의 DB→응답 계보를 확인했다고 계산하지 않았다.
- 실제 AI 생성/저장/반환 성공을 검증한 결과가 아니다.

실제 각 Flow의 확정 관계 중 이번 수동 정답에 포함되지 않은 outer edge가 각각 473/476/358개 남는다(공통 페이지 중복 포함). 이것들은 옳다고 계산하지 않았다. 추가 수동 검토 없이는 전체 precision을 확정할 수 없다.

## 4. 정량 평가의 정의와 결과

### 단위와 분모

기계 보고서의 한 행은 사전에 정의한 registry/binding/call/CFG/HTTP/DB/response/lineage/안전성 사실이다. 원본 CodeEdge 하나와 항상 1:1인 것은 아니다. 진입점/기능 발견/CFG 진단이 연결 recall을 부풀리지 않도록 아래 주표는 `kind ∉ {entry, feature, cfg, runtime}`만 사용했다. JSON의 전체 사실 지표와 이 엄격한 연결 지표를 혼동하지 않는다.

- positive: 사람이 코드 근거로 확인한 정적 연결. wrapper/동적 경로의 의도된 대응처럼 현재 구현 밖인 경우도 미확정이면 FN에 포함한다. 실제 런타임의 보편적 결과를 정답으로 둔 것이 아니다.
- negative: plain object DB, DOM으로 보장되지 않는 custom prop, 외부 URL→내부 API, 미반환 객체 등 연결하면 안 되는 관계.
- unknown: DB cache 출처나 런타임 URL처럼 정답을 독립적으로 확정할 수 없는 관계. TP/FN 분모에서 제외하며 별도 표시한다.
- missing: 대응하는 근거 레코드까지 완전히 없음.
- unresolved: 레코드/문맥은 있으나 확정 연결이 없음. known positive의 unresolved도 recall에서는 누락이다.
- false-confirmed: 음성 대조군을 확정하거나 검토한 호출/HTTP/DB 출처의 잘못된 대상을 확정함.

precision=TP/(TP+FP), recall=TP/(수동 positive 수). 분모 0은 null이며 100%로 바꾸지 않는다. 잘못된 HTTP 대상/outer call 대상을 일부러 주입해 scorer가 false-confirmed로 검출하는지도 검증했다. 이 주입은 실제 추출기의 발견 오류로 세지 않는다.

### 엄격한 연결 관계

| 대상 | 검토 연결 행 | positive 정답 | 올바른 확정 TP | 완전 누락 | 잘못 확정 FP | 미해결 전체(그중 unknown) | 표본 precision | 표본 recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 실제 샘플 분석 | 9 | 9 | 7 | 0 | 0 | 2 (0) | 7/7 | 7/9 = 77.8% |
| 실제 연결 분석 | 9 | 7 | 5 | 0 | 0 | 4 (2) | 5/5 | 5/7 = 71.4% |
| 실제 AI 설명 | 9 | 6 | 4 | 0 | 0 | 5 (3) | 4/4 | 4/6 = 66.7% |
| 합성 fixture | 15 | 8 | 7 | 0 | 0 | 3 (2) | 7/7 | 7/8 = 87.5% |

fixture의 나머지 5개는 올바른 음성 거부다. 실제 각 기능은 이 엄격한 부분집합에서 별도 음성 행이 없으므로 낮은 FP를 일반화할 수 없다. 전체 사실 표본의 runtime 안전성 음성 행과 fixture/기존 회귀 테스트가 별도 안전성 검사를 제공한다. **표본 precision의 분수가 모두 맞았다는 사실을 저장소 정확도 100%로 해석하지 않는다.** 수백 개의 미검토 출력과 unknown truth가 남는다.

### 파이프라인 사실 전체(JSON 지표)

| 대상 | 사실 행 | positive | 올바른 확정 | 미해결 known positive | 음성 정답/정상 거부 | unknown | 사실 recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 실제 샘플 | 12 | 11 | 9 | 2 | 1/1 | 0 | 9/11 |
| 실제 연결 | 13 | 10 | 8 | 2 | 1/1 | 2 | 8/10 |
| 실제 AI | 13 | 9 | 7 | 2 | 1/1 | 3 | 7/9 |
| fixture | 22 | 14 | 13 | 1 | 6/6 | 2 | 13/14 |

검토한 범위에서 완전 소실/잘못 확정/unknown 확정은 0이다. 그러나 실제 기능마다 HTTP와 wrapper 반환이라는 **의미상 연결 공백 2건**이 있으므로 누락이 없다고 판단해서는 안 된다. 공통 페이지/호출을 반복 검토한 행이 있으므로 세 기능을 합쳐 독립 표본 정확도를 계산하지 않았다.

### 단계별 판정

| 단계 | 실제 샘플 | 실제 연결 | 실제 AI | fixture |
| --- | --- | --- | --- | --- |
| AST/진입점/기능 발견 | 선택 범위 확인 | 선택 범위 확인 | 선택 범위 확인 | 확인 |
| React 이벤트/직접 호출 | 확인 | 확인 | 확인 | 확인, custom prop 거부 |
| 내부 CFG | 일부 지원/불투명 구간 존재 | 일부 지원 | 일부 지원 | if 경로 확인, loop/switch 미지원 표시 |
| HTTP 경계 | 미해결 | 미해결 | 미해결 | 정적 POST 확인, 동적/외부 거부 |
| Prisma | N/A | 출처 미확인 | 출처 미확인 | 생성자/조회 근거 확인, cache/fake 거부 |
| 응답 생성 | helper 생성 확인 | helper 생성 확인 | helper 생성 확인 | 직접 생성 확인 |
| API 반환/DB→응답 | wrapper 미해결 | wrapper 미해결 | wrapper/변환/DB 출처 미해결 | 직접 const 경로 확인, 별도 wrapper 미해결 |
| 최종 Flow | 구조 valid, partial | 구조 valid, partial | 구조 valid, partial | 지원 경로 확인, 전체 의미 완성은 아님 |

## 5. 성능·크기·제한

최종 저장된 **단일 로컬 실행**(Node v24.14.0, Windows x64)이다. fixture 뒤 같은 프로세스에서 측정했으며 cold start/p95/반복 평균이 아니다. 파일 I/O·프로세스 시작·manifest hashing은 제외했다. 다른 호스트 부하를 통제한 벤치마크도 아니다. 최종 값을 보고하며 더 빠른 탐색 실행을 골라 성능으로 사용하지 않았다.

- AST 및 이벤트/CFG/HTTP/DB/응답 추출 전체: 30.52초.
- 기능 발견: 0.10초.
- 선택 Flow 생성·추가 검증·크기 측정을 포함한 총 작업: 48.59초.
- 추출 단계별 시간은 현재 analyzer가 분리 계측하지 않으므로 개별 시간을 만들지 않았다.
- RepositoryAnalysis: 25,495,307 bytes (24.31 MiB).
- 기능 발견 결과: 676,931 bytes (0.65 MiB).
- 선택 Flow 4개: 28,073,152 bytes (26.77 MiB).
- 크기는 압축하지 않은 compact UTF-8 JSON이다. 네트워크 전송/압축/브라우저 렌더 성능은 측정하지 않았다.

| Flow | 생성 | 추가 검증 | JSON | 노드/관계 | 제한 |
| --- | ---: | ---: | ---: | --- | --- |
| 공통 /repository | 2.05초 | 1.01초 | 6.07 MiB | 200 / 217 | 기본 노드 한도 도달 |
| GET /api/analyze | 3.47초 | 1.76초 | 8.29 MiB | 200 / 261 | 기본 노드 한도 도달 |
| GET connected analyze | 3.49초 | 1.76초 | 8.69 MiB | 200 / 262 | 기본 노드 한도 도달 |
| POST learn | 2.37초 | 1.25초 | 3.72 MiB | 115 / 143 | outer 노드 한도 미도달, 별도 DB/response 탐색 제한 존재 |

기능 발견 결과의 limited는 선택 4개 모두 false였지만 3개 Flow는 traversal-limit에 도달했다. **feature.limited=false는 완성도 보장이 아니다.** AST/분석 라이브러리까지 호출하는 RepoTutor 자체의 코드 특성상 내부 유틸리티 관계가 크게 확장된다. 코드상 진짜 호출이라도 사용자 관점의 핵심 흐름과 같지는 않다. 큰 결과를 그대로 브라우저에 전달/렌더하는 방식은 승인할 수 없다.

DB 분석에는 recursive-call-boundary/server-traversal-limit, 응답 분석에는 server-traversal-limited가 관측됐다. 전체 production 소스에서 unsupported statement 레코드 1,045개가 나왔다. 분석 라이브러리 자체도 포함되며 문장/영역 단위 수이지 1,045개의 버그나 독립 누락 관계를 뜻하지 않는다. 총 CFG 커버리지 분모를 수동 판정하지 않아 지원율을 계산하지 않았다.

## 6. 기존 미해결 사례의 우선순위

| 문제 | 실제 근거/중요성 | 우회·표시 가능 여부 | 우선순위 |
| --- | --- | --- | --- |
| repositoryJson/json wrapper | 실제 세 기능의 API 반환 단절. body/status가 helper 매개변수로 전달됨 | API 반환 코드와 helper 생성 근거를 따로 보여주고 미해결 표시 가능. 완전 흐름에는 제한적 반환/인수 계보가 필요 | 전체 흐름 목표 P1 |
| 전역 cache Prisma | db.ts의 cache ?? factory. 검토 DB 4건이 출처 미확인 | 후보 코드와 unverified-client 표시만 가능. 타입 단언/이름을 근거로 확인 처리 금지 | 전체 DB 흐름 목표 P1 |
| 함수 간 반환값 | analyzeSample/json, generated/record 변환 등 | 코드 링크 우회 가능, 값 전달을 확정하는 화살표는 금지 | P1, 범위 제한 설계 필요 |
| loop | installations.ts:33 for, :114/:156 for-of 등 실제 코드 | unsupported 영역/호출 위치 확인은 가능. 순회 순서·반복 횟수/실행 단계 확장 금지 | 단순 근거 UI는 표시 가능, 설치 동기화 전체 흐름에는 P1 |
| switch | 이번 production 입력에서 실제 SwitchStatement 사례 없음 | fixture로만 unsupported 표시 검증. 실제 저장소 성공 사례로 계산하지 않음 | 현재 P2/미지원 표시 |
| short-circuit/optional/조건식 | repositoryAccess.ts:19/:29/:50 등의 실제 가드도 opaque | 단순 if 지원과 구분해 unknown 표시. 보안 가드를 거짓/참으로 예측하지 않음 | 표현 범위 고지 필수, 확장은 별도 P1 |
| 결과 크기·복제·노드 제한 | 26.77 MiB 선택 Flow, 3개 잘림 | 핵심/상세 분리·지연 로딩·예산/누락 표시 전략을 먼저 결정 | UI 통합 전 P0 |
| 미검토 관계 | 기능별 수백 edge | 정확도 미확정. 더 넓은 음성 대조/닫힌 범위 수동 검토 필요 | 전체 정확도 주장 전 P0 |

새 분석 기능을 확장해 이 공백들을 이번 단계에서 가리지 않았다.

## 7. 5단계 UI에 사용할 수 있는 데이터

| UI 정보 | 현재 사용 가능한 데이터 | 추가로 필요한 것 |
| --- | --- | --- |
| 기능 목록/시작점 | RepositoryFeature와 실제 page/API entry ID | 경로 기반 이름과 수동 업무 이름 구분, 사용자 기능 의미 분류 완성으로 소개하지 않기 |
| 노드/관계 | Flow.nodes/edges, sourceNodeIds/sourceEdgeIds | 기존 그래프와 독립 모델을 합칠 presentation adapter, 예산·범위 표시 |
| 조건 분기 | controlFlows의 statement/true/false/return/throw/finally/context | 함수 내부 확장 UI. outer 호출 관계를 실행 순서로 오인하지 않기 |
| HTTP | httpRequests, boundary.serverFlowId | unresolved 동적 URL 상태. 실제 세 기능에는 확정 경계 없음 |
| DB | databaseAccesses 및 원본 site/serverContext | 실제 singleton은 미해결. 후보/확정 분리 |
| 응답 | 생성 ID/return ID/반환 종류/상태 코드/출처 참조 | wrapper·로컬 반환·실제 delivery 미관측 구분 |
| 코드 위치 | 파일·행/열·오프셋·원문·근거 ID | snapshot별 소스 조회/ID 해석, 변경 후 stale 처리 |
| AI 설명 | 기존 CodeNode.id 또는 RepositoryFeature.id | 새 BehaviorNode/CFG/DB/response ID를 기존 AI selection으로 직접 보내지 않기. 원본 소유 함수/feature로 명시적 매핑 필요 |
| 미해결/미지원 | flow/DB/response limitations, 각 reason, reachability/contextStatus | root와 Flow의 서로 다른 제한을 함께 표시. 데이터 없음=동작 없음으로 해석 금지 |

### UI 구현 전에 반드시 정해야 할 사항

1. **운영 데이터 공급:** 현재 운영 API는 최종 BehaviorFlow를 제공하지 않는다. 서버/worker/client 중 생성 위치, 버전·캐시·핵심/상세 계약을 결정해야 한다. 이번에는 API를 바꾸지 않았다.
2. **성능과 예산:** 큰 원본/중복 CFG를 통째로 기본 렌더하지 않기. feature.limited, Flow.partial, traversal-limit, 별도 DB/response 제한을 통합 표시한다.
3. **근거 계약:** 생성만 한 응답·helper-local-return·entry-return-reference·확정/후보 DB·동적 HTTP를 다른 상태로 표현한다. 현재 결과로 완전한 end-to-end 그림을 그려서는 안 된다.
4. **스냅샷과 기존 ID:** CodeNode/feature 기반 AI 선택과 새 표시 ID를 분리하고 소스 버전에 묶는다. 오프셋 기반 ID를 커밋 간 영구 식별자로 간주하지 않는다.
5. **품질 승인 기준:** 미검토 edge를 성공으로 세지 말고 실제 핵심 흐름을 닫힌 범위로 더 검토한다. 완전 흐름을 목표로 하면 동적 pathname/query, wrapper 반환, cache provenance의 후속 설계·검증이 필요하다.

기능 목록/코드 근거/부분 CFG/미해결 표시를 제공하는 제한된 탐색 UI는 위 조건을 만족하면 구현 가능하다. 완성된 자동 사용자 동작 흐름 UI는 보류한다.

## 8. 검증 명령 결과

최종 검사 결과는 아래에 기록한다. 테스트 통과는 측정/회귀 계약이 맞다는 의미이며 위에서 발견한 공백이 해결됐다는 의미가 아니다.

| 검사 | 결과 |
| --- | --- |
| 타입 검사 | npm.cmd run typecheck 통과 |
| ESLint | npm.cmd run lint 통과, 경고 없음 |
| 단독 통합 검증/보고서 생성 | pipelineAudit.test.ts 10개 통과 |
| 전체 테스트 | npm.cmd test -- --maxWorkers=1: 41개 파일 통과/4개 파일 생략, 599개 테스트 통과/기존 5개 생략 |
| 프로덕션 빌드 | npm.cmd run build: 컴파일·TypeScript·정적 페이지 생성 통과 |

기존 생략 테스트는 RUN_GITHUB_INTEGRATION, RUN_ACTUAL_FEATURE_DISCOVERY, RUN_ACTUAL_REPO_AI 또는 INTEGRATION_REPO_DIR 조건을 요구한다. 이번 실제 소스 정적 검증 10개는 생략하지 않았다. 실제 원격 GitHub/AI, DB 쿼리 결과, 브라우저 동작은 검증하지 않았다.
