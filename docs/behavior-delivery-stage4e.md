# BehaviorFlow 4-E: UI 데이터 공급

## 구현 범위와 계약

기존 AST/BehaviorFlow 판정 규칙과 UI는 바꾸지 않았다. 원본 `RepositoryAnalysis`를 서버에 보관하고, 브라우저에는 별도 조회 타입(`src/types/behaviorQuery.ts`)만 반환한다. 기존 학습/개발자 그래프와 AI API는 교체하지 않았다.

### 파일 변경 목록

| 파일 | 작업 |
| --- | --- |
| `src/types/behaviorQuery.ts` | 브라우저용 응답 타입 추가 |
| `src/app/api/behavior/route.ts` | 준비 POST와 5가지 GET view 추가 |
| `src/lib/behavior/query/source.ts` | 저장소·SHA·현재 권한 검증과 원본 조회 |
| `src/lib/behavior/query/store.ts` | 기능 인덱스, compact Flow, snapshot, singleflight |
| `src/lib/behavior/query/projector.ts` | 요약 외 그래프/상세/확장/CFG 페이지 변환 |
| `src/lib/cache/boundedCache.ts` | 바이트·개수·TTL 제한 LRU 추가 |
| `src/lib/repository/analysisWork.ts` | AST 계산 중복 방지 추가 |
| `src/lib/repository/sampleAnalysis.ts` | 기존 샘플 분석 공용화와 receipt 판별 |
| `src/lib/repository/githubAnalysisCache.ts` | 기존 캐시를 제한 LRU로 전환 |
| `src/app/api/analyze/route.ts` | 공유 샘플 분석, AST singleflight, 선택적 receipt |
| `src/app/api/repositories/[connectionId]/analyze/route.ts` | AST singleflight, 선택적 receipt; 기존 DB 처리 유지 |
| `src/lib/behavior/query/queryApi.test.ts` | 실제 라우트와 기존 권한 검증 회귀 테스트 |
| `src/lib/behavior/query/queryCache.test.ts` | 캐시·페이지·스코프·원본 호환성 테스트 |
| `src/lib/behavior/query/queryPerformance.test.ts` | 고정 4-D corpus로 API 성능 측정 |
| `src/lib/behavior/validation/gold.ts` | 이동된 샘플 함수에 수동 정답 위치 갱신 |
| `src/lib/learning/learningRoles.regression.test.ts` | 제거된 내부 함수명 대신 공용화된 샘플 함수로 기존 검증 유지 |
| `docs/behavior-delivery-stage4e.md` | API·측정·제약 문서 |
| `docs/validation/behavior-stage4e-input.json.gz` | 비교용 소스 corpus |
| `docs/validation/behavior-delivery-stage4e.json` | 성능 측정 결과 |
| `docs/validation/behavior-delivery-example-stage4e.json` | 실제 요약·초기 흐름 응답 예 |

`/api/behavior`는 Node.js 동적 API다. 모든 응답은 `Cache-Control: private, no-store`이며, 단일 응답의 UTF-8 JSON 상한은 256 KiB다. 초과 시 데이터를 조용히 버리지 않고 413을 반환한다.

### 저장소 지정

| source | 식별자 | 접근 정책 |
| --- | --- | --- |
| `connected` | `connectionId` | 로그인 + 기존 사용자/연결 소유권 및 현재 GitHub App/사용자 저장소 권한 검사 |
| `github` | `url=https://github.com/owner/repo` | 기존 익명 공개 저장소 검증; 설치 토큰으로 비공개 데이터를 우회 조회하지 않음 |
| `sample` | 없음 | 기존 로컬 데모 분석; SHA 대신 샘플 내용 digest 사용 |

### 엔드포인트

| 메서드 / view | 필수 추가 파라미터 | 반환 |
| --- | --- | --- |
| POST `/api/behavior` | 저장소 지정, 헤더 `X-RepoTutor-Prepare: 1` | 기존 분석 실행/재사용 후 기능 요약; 원본 AST를 반환하지 않음 |
| GET `view=features` | 저장소 지정 | snapshot, 기능 목록, 진입점, 상태, 존재 여부, 미해결 개수 |
| GET `view=flow` | `analysisId`, `featureId` | 기본 24개 노드와 현재 보이는 관계 |
| GET `view=node` | 위 ID + `nodeId` | 코드/근거/조건 경로/관련 호출·HTTP·DB·응답의 페이지 |
| GET `view=expand` | 위 ID + `nodeId`, `visible` | 선택 노드 주변 추가 노드·관계와 새 visible 집합 |
| GET `view=cfg` | 위 ID + `nodeId` | 선택 함수의 정적 CFG 페이지; 기본 40노드 |

`limit`은 1..64, viewport는 최대 256노드다. `flow`의 선택적 `nodeId`로 중심을 바꾸고 viewport를 새로 시작할 수 있다. 확장은 기존 visible IDs 전체를 쉼표로 전달한다. 서버는 모든 ID의 저장소·snapshot·기능 소속을 검사한다. ID는 권한 토큰이 아니다.

`node`는 코드 6,000 UTF-16 문자, 근거 8개, facts/calls/bindings 각 12개씩 반환한다. `codeOffset`은 코드 청크 상대 위치, `offset`은 각 목록의 페이지 시작 위치다. 각 목록의 `nextOffset`을 사용한다. 선택적 `evidence=<index>`는 해당 노드의 서버 측 근거 인덱스로 연결된 코드 범위를 조회한다. 클라이언트가 임의의 파일 경로를 지정할 수 없다. CFG는 `offset`/`nextOffset`으로 조회하고 안정적인 노드/엣지 ID로 병합한다.

### UI 연결 예

```ts
import type {
  BehaviorFeaturesResponse, BehaviorGraphResponse, BehaviorNodeDetail,
} from "@/types/behaviorQuery";

const base = new URLSearchParams({ source: "connected", connectionId });
// 캐시/분석이 없을 때 명시적인 사용자 분석 동작으로 호출한다.
const prepared = await fetch(`/api/behavior?${base}`, {
  method: "POST", headers: { "X-RepoTutor-Prepare": "1" },
});
if (!prepared.ok) { /* 오류 status/code 처리 */ }
const features: BehaviorFeaturesResponse = await prepared.json();
const feature = features.features[0];
if (feature) {
  const query = new URLSearchParams(base);
  query.set("analysisId", features.snapshot.analysisId);
  query.set("featureId", feature.id);
  query.set("view", "flow");
  const graph: BehaviorGraphResponse = await (await fetch(`/api/behavior?${query}`)).json();
  query.set("view", "node");
  query.set("nodeId", graph.rootId);
  const detail: BehaviorNodeDetail = await (await fetch(`/api/behavior?${query}`)).json();
  // detail.sourceCodeNodeIds / sourceFeatureId는 기존 분석·AI 연결에 사용한다.
  query.set("view", "expand");
  query.set("visible", graph.visibleNodeIds.join(","));
  const delta: BehaviorGraphResponse = await (await fetch(`/api/behavior?${query}`)).json();
  // nodes/edges는 ID로 upsert, visible 집합은 delta.visibleNodeIds로 교체한다.
}
```

실제 응답 예는 [측정 예제 JSON](validation/behavior-delivery-example-stage4e.json)에 보관했다. 각 fetch에서 HTTP 상태를 먼저 처리해야 한다. 202는 분석 중, 409는 분석 없음/캐시 소실/오래된 SHA·snapshot, 401은 로그인 필요, 403/404는 접근 불가 또는 잘못된 ID, 422는 미지원 입력/이전 형식 분석, 413은 크기·용량 한도, 503은 권한 확인/조회 불가다. 오류는 `error.code`, `retryable`을 포함한다. 권한 확인 실패를 성공한 빈 데이터로 처리하지 않는다.

## 정확도 표시

- 기능 요약은 Flow 전체를 생성하지 않는다. `sourceScopeCounts`는 기존 발견 범위이며, 실제 Flow의 `flowCounts`/`coreFlowCounts`는 생성 전 `null`이다. `flowStatus=not-generated`, 잘림 평가는 `not-generated`으로 표시한다. 기능 선택 후 요약을 다시 조회하면 캐시된 정확한 개수가 제공된다. 모든 기능을 몰래 생성해 첫 목록을 지연시키지 않는다.
- 원본 수집의 부분 완료는 `snapshot.sourcePartial`과 기능 `status=partial`에 Flow 생성 전부터 표시한다. 원본 수집 상태와 Flow 생성 후 잘림 평가는 별개다.
- 요약 `presence`는 해당 범위에 추출된 사이트/후보가 있는지 나타낸다. DB 실행이나 HTTP 연결의 확정을 의미하지 않으며 상세의 상태·사유를 함께 사용해야 한다.
- `coreFlowCounts`는 기존 생성기의 노드/관계 수다. `available`은 UI 조회 그래프의 수이며 별도 metadata 사이트가 포함될 수 있다. 두 수치를 혼동하지 않는다.
- 원본 분석의 200노드 잘림은 `truncation.analysis`, 사유, `omittedByAnalysis=unknown`, `analysisRecoverableByExpansion=false`로 표시한다. 잘린 원본을 viewport 확장으로 복구할 수 없다.
- `knownHiddenNodes/Edges`는 조회 그래프에서 아직 보이지 않는 수이며, `viewportCanExpand`는 이 범위의 확장 가능성이다. 256노드 한도에서는 중심을 옮겨 조회한다.
- `origin=metadata`의 DB/HTTP/응답 생성·반환 사이트는 `contains-site`/`server-scope-reference`, `semantics=source-membership`으로 연결된다. 함수 호출이나 실행 순서로 그리면 안 된다. HTTP 경계는 `http-boundary`, 모든 관계의 실행 순서는 `not-established`다.
- 조건 경로는 CFG 요약·상세에서 조회한다. 응답 데이터 출처는 해당 서버 문맥의 판정만 사용하며, 다른 API 문맥의 확정 DB 근거를 빌려오지 않는다. 사용자 정의 컴포넌트 이벤트 prop의 미해결 근거도 상세에 남는다.
- 서버 경계 노드의 `targetFeatureIds`로 해당 서버 기능을 별도 선택할 수 있다. 다른 기능을 현재 기능에 무제한 섞지 않는다. `cfgAvailable`인 함수만 CFG를 요청한다.

## 캐시·권한·동시 실행

원본 AST 캐시는 기존 GitHub namespace/저장소/SHA 키를 재사용한다. 128 MiB/8개/30분 LRU이며, 기능 인덱스는 4 MiB/16개/15분, compact Flow는 16 MiB/64개/15분의 별도 LRU다. 한도는 직렬화 바이트 기준이며 V8 heap/RSS의 절대 상한이 아니다. 원본 코드·CFG·근거는 AST에 유지하고, compact 캐시에 중복 복사하지 않는다. 일시적인 분석 객체와 HTTP 응답은 별도 메모리를 쓴다.

사용자/연결/저장소/설치/SHA별 UI snapshot을 사용한다. 매 조회에서 캐시 접근 전에 기존 권한 검사를 실행하고, 비싼 처리 후에도 권한과 최신 HEAD를 다시 확인한다. 권한 철회/검증 실패 시 캐시를 반환하지 않는다. SHA 변경은 이전 UI 캐시와 같은 namespace의 이전 원본 캐시를 무효화한다. 다른 사용자나 기능 ID로 탈출할 수 없다.

AST 계산 singleflight는 최대 4개, Flow 생성은 최대 2개다. 동일 키의 동시 계산은 합쳐지며 실패 후 재시도할 수 있다. POST 준비는 연결 사용자/연결 또는 공개 저장소별로 기존 분석 핸들러 전체를 합친다. 각 호출자의 권한 검사는 합치지 않는다. 기존 분석 API의 기본 응답은 유지하고, 내부 receipt Accept 모드만 추가했다. 기존 GET 분석은 수집 I/O·DB 실행 기록까지 모두 합쳐지는 구조는 아니다.

이 캐시는 **프로세스 로컬**이다. 재시작/다중 인스턴스 간 영속성·분산 singleflight는 제공하지 않는다. 연결 저장소의 기존 AnalysisRun 상태를 사용하며 별도 영속 백그라운드 작업 시스템은 만들지 않았다. TTL/용량 초과로 AST가 없으면 409로 재분석을 안내한다. 동일 SHA 분석을 사용하는 동안 분석 판정은 변경하지 않는다.

## 측정 및 검증

원래 4-D의 91개 소스 파일을 `validation/behavior-stage4e-input.json.gz`에 보존했다. 소스만 포함하며 .env/자격 증명/사용자 데이터는 포함하지 않는다. 4-E에서 수정된 현재 코드로 이전 입력을 대체하지 않고 동일 입력으로 비교한다. 측정 수치, 환경, 입력 digest, 기능별 상세는 [측정 JSON](validation/behavior-delivery-stage4e.json)을 기준으로 한다.

재현 명령:

```powershell
$env:REPOTUTOR_WRITE_DELIVERY_BENCH='1'
npm.cmd test -- src/lib/behavior/query/queryPerformance.test.ts --maxWorkers=1
```

실제 GET API와 AST/Flow 생성기를 실행한다. 권한/HEAD 어댑터만 오프라인 대체하므로 GitHub 네트워크·권한·다운로드·DB 지연은 성능 수치에 포함하지 않는다. 권한 테스트는 별도로 기존 실제 권한 검증 함수를 사용하고 GitHub/DB 응답을 mock한다. 실제 설치 철회·조직 탈퇴·공개→비공개 전환은 배포 환경에서 추가 확인해야 한다.

### 동일 입력 최종 측정

Windows / Node v24.14.0에서 91파일 490,532바이트의 고정 입력을 사용했다. 4-D의 네 Flow 합산 배열 크기 **28,073,152바이트(26.77 MiB)**가 정확히 재현됐다. 과거 48.6초와 비교할 때 환경 부하 차이가 있으므로 동일 실행의 원본 생성 baseline도 같이 기록했다. AST 판정 규칙을 최적화한 결과로 해석하면 안 된다.

| 항목 | 측정 |
| --- | --- |
| AST 분석 | 31,428 ms; 원본 캐시 등록 추가 304 ms |
| 기존 full Flow 4개 생성 합계 | 13,263 ms; AST와 합계 44,691 ms |
| 기능 요약 | 12기능, 7,589바이트, 137 ms; AST 준비 이후 측정 |
| compact Flow 4개 최초 생성 합계 | 약 10,645 ms; 선택 기능만 지연 생성 |
| 원본 AST 캐시 보존량 | 25,495,307바이트 / 한도 128 MiB |
| UI 인덱스 보존량 | 기능 363,891바이트 + Flow 4개 1,922,127바이트 |
| 반복 조회 | 기능별 20회, 총 80회에도 core 생성 4회, 측정 종료 in-flight 0 |
| heapUsed 순간 표본 | 299,286,096바이트; 원본·baseline·측정 일시 객체 포함, 캐시 크기와 다름 |

| 실제 기능 | 최초 Flow ms | 초기 24노드 B | 노드 상세 B | 24노드 확장 B | CFG 페이지 B | 반복 p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `/repository` | 1,899 | 14,953 | 16,248 | 16,032 | 19,467 | 3.28 |
| GET `/api/analyze` | 3,167 | 15,563 | 11,651 | 16,037 | 10,668 | 2.78 |
| GET 연결 저장소 `/analyze` | 3,348 | 15,269 | 11,653 | 16,588 | 10,668 | 3.76 |
| POST 연결 저장소 `/learn` | 2,230 | 15,597 | 20,449 | 17,078 | 19,635 | 3.96 |

노드 상세는 각 기능에서 코드가 가장 긴 일반 함수 노드를 선택했다. `/repository`의 RepositoryWorkspace 23,565문자는 첫 6,000문자 이후 정확히 이어지는 페이지로 제공된다. 이 기능의 첫 CFG는 40/54노드이며, 나머지는 nextOffset으로 제공한다. 초기 제한을 48로 올리면 네 응답이 28,937..30,628바이트로 약 두 배가 돼, 처음 24노드를 기본값으로 택했다. 확장 후 viewport는 48노드다.

원본 Flow의 CFG 부분은 기능별 약 2.0..4.5 MiB, evidence 부분은 약 0.6..1.7 MiB이며 긴 원본 ID가 반복되는 관계도 수백 KiB를 차지했다. 중복된 CFG/근거를 브라우저·UI 캐시에 복제하지 않고 원본 참조와 지연 조회로 바꿨다. 서버 원본 분석과 근거를 삭제한 결과가 아니다. 세 core Flow의 200노드 잘림은 여전히 표시되며 이를 고친 성능 수치가 아니다.

**냉간 AST는 여전히 31초 수준**이다. 첫 분석 자체가 즉각 응답한다는 목표는 달성하지 않았고, 준비 POST는 현재 요청 안에서 기존 분석을 기다린다. 반면 준비된 분석에서 초기 UI 데이터는 약 15 KiB이며, 이미 생성된 기능의 반복 읽기는 측정한 로컬 조건에서 수 ms다. 운영의 권한/HEAD 네트워크 지연을 포함한 SLO는 아직 없다.

새 테스트는 요약·상세·확장·CFG, 다른 사용자/기능 ID, 권한 철회 후 모든 캐시 view 차단, 후검증 중 권한 변화, HEAD 실패, SHA 변경, 동시 준비/Flow 요청, 기존 원본 보존, 분석 잘림, per-context 응답 근거, 코드 페이지 연속성을 검사한다. 기존 4-D 정답 fixture는 공유 샘플 분석 helper의 호출 위치 변경에 맞춰 갱신했으며 과거 측정 JSON은 덮어쓰지 않았다.

### 최종 검사 결과

| 검사 | 결과 |
| --- | --- |
| `npm.cmd run typecheck` | 통과 |
| `npm.cmd run lint` | 통과, 경고 없음 |
| `npm.cmd test -- --maxWorkers=1` | 44파일 통과/4파일 생략, 632테스트 통과/기존 5테스트 생략 |
| 마지막 HTTP Host 정규화 보완 후 해당 API 테스트 재실행 | `queryApi.test.ts` 21개 통과; 위 전체 실행 이후 추가된 1개 포함 |
| `npm.cmd run build` | 최종 수정 후 컴파일·타입·페이지 생성 통과; `/api/behavior` 동적 라우트 확인 |
| 프로덕션 로컬 HTTP smoke | POST 준비, GET features/flow/node/expand/cfg 모두 200, 외부 Origin POST 403 |

전체 테스트 실행 후 실제 HTTP smoke에서 Next의 request URL이 localhost로 정규화되는 문제를 발견했다. POST 출처 검사는 HTTP Host와 요청 protocol 기준으로 보완하고 API 회귀 테스트 21개·타입·lint·빌드를 재실행했다. 다른 출처 허용이나 GitHub 권한 완화는 하지 않았다. 이 마지막 보완 후 전체 장시간 suite를 다시 실행한 것으로 표기하지 않는다.

최종 빌드 서버 `127.0.0.1:3187`의 실제 샘플 결과는 기능 2개, 요약 1,475바이트, 3노드 흐름 2,463바이트, 상세 1,900바이트, 확장 2,505바이트(visible 3→5), CFG 2,938바이트였다. 모두 `private, no-store`였다. 확인 후 로컬 서버는 종료했다. 이 smoke는 mock 없이 로컬 샘플과 실제 HTTP를 사용했으며 GitHub/DB 인증을 대신 검증한 것은 아니다.

생략 테스트는 기존 opt-in GitHub/실제 저장소·AI 연동 조건(`RUN_GITHUB_INTEGRATION`, `RUN_ACTUAL_FEATURE_DISCOVERY`, `RUN_ACTUAL_REPO_AI`, `INTEGRATION_REPO_DIR`)이 설정되지 않은 항목이다. UI 브라우저 렌더링, 실제 GitHub 설치/조직 권한 회수, 원격 API 지연, 다중 인스턴스 캐시는 직접 검증하지 않았다.

### 5단계 전제와 남은 한계

UI는 이 API/타입으로 시작할 수 있으나 전체 흐름 완성도는 별도 문제다. cold AST·Flow 계산은 여전히 초 단위이며 core의 잘림/동적 URL/Prisma 전역 캐시/래퍼 반환/함수 간 반환값/반복문·switch 미지원은 그대로다. UI는 partial/unknown/unsupported를 먼저 표현해야 한다. 배포의 timeout·다중 인스턴스 환경에서는 영속 분석 저장소/작업 큐가 후속 과제다. 이번 단계에서 실제 GitHub 로그인·설치·권한 변경 및 브라우저 렌더링은 직접 확인하지 않았다.
