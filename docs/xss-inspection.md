# XSS 비실행 마커 검사

## 사용자 흐름과 출처

기존 GitHub 분석의 XSS 후보·코드 위치·입력 출처·탐지 근거·보호 처리 분류를 그대로 사용합니다. 보호 처리 관찰(`protected`)은 실행 후보로 승인하지 않습니다.

1. 후보를 선택하고 기존 배포 URL·소유권·공식 Vercel 커밋 정보를 확인합니다. 소유권과 UI 확인은 실행 승인이 아닙니다.
2. 기존 `PracticeTargetEditor`에서 API·메서드·입력 위치·파라미터와 XSS 반영 위치(화면 요소나 코드 위치 설명), 예상 HTML 문맥을 확정합니다. 반영 위치와 문맥도 대상 identity·버전과 저장용 스냅샷에 포함합니다. 실제 DOM 요소 일치를 자동으로 증명하지 않습니다.
3. 자동 HTTP 관찰은 GET/query 한 파라미터만 지원합니다. 다른 입력 경로는 기존 수동 기록을 사용합니다.
4. XSS 편집기에서 서버 승인을 조회하고, 별도 요청 내용 확인 후 정상 입력·비실행 마커를 각각 최대 1회 전송합니다. 정상값과 마커는 모두 고정이며 임의 입력을 서버에서도 거부합니다. `xssProbe.ts`에는 태그 이름·JavaScript·이벤트 핸들러·URL·외부 전송 코드가 없는 인코딩 관찰용 구두점 마커만 있습니다.
5. 두 HTTP 응답을 텍스트로 비교하고 마커 반영 상태·관찰 HTML 문맥·이스케이프 처리를 표시합니다. HTML 삽입, 브라우저, iframe, DOMParser, eval, 스크립트 실행은 사용하지 않습니다.
6. 기존 `SecurityTestRecord`의 같은 확정 대상 키로 수동 판단·수정 내역을 작성합니다. 사용자가 HTTP 요약을 메모로 복사할 수 있으나 검사 상태·수행 선언·재검증 완료를 자동 선택하지 않습니다. DB의 출처는 계속 MANUAL이며 HTTP 원본의 영구 보관이나 서버 검증 판정이 아닙니다.
7. 동일 대상의 최초·후속 관찰을 보존합니다. 수정으로 SHA가 바뀌면 새 분석·대상 확정·XSS 승인이 필요합니다. 새 커밋의 독립 실행 결과가 있을 때 같은 저장소 연결의 이전 커밋을 직접 선택해 읽기 전용 비교할 수 있습니다. 이전 관찰을 새 실행 결과로 복원하지 않습니다. 유형별 최근 10회 관찰은 페이지 메모리에만 보관하며 페이지 이탈·새로고침 시 사라집니다.

## 상태와 분석 범위

| 상태 | 의미 |
| --- | --- |
| STATIC_ONLY | 정적 분석에서만 의심됨. 아직 HTTP 관찰 없음 |
| NOT_REFLECTED | 이번 완전한 HTML 응답에서 고정 마커를 찾지 못함. 다른 경로·저장형·DOM XSS가 없다는 뜻 아님 |
| ENCODED | 지원하는 관찰 HTML 텍스트 또는 인용 속성 문맥에서 필요한 문자 이스케이프를 확인함. 전체 서비스 안전성 아님 |
| UNENCODED | 마커가 일부 또는 전체 원문으로 반영됨. XSS 취약점 또는 실행 성공을 뜻하지 않음 |
| UNAVAILABLE | 요청 실패·차단·잘림·HTTP 오류·비 HTML·문맥 불일치·부분 마커 또는 지원하지 않는 문맥 |

모든 상태에서 실제 스크립트 실행 여부는 `NOT_VERIFIED`입니다. 정적 후보, 서버 수집 HTTP 관찰, 사용자의 수동 판단을 분리해 표시합니다.

명시적 `text/html`, UTF-8/ASCII(또는 charset 미명시)의 두 완전한 2xx 응답만 분류합니다. named·decimal·hex HTML 엔티티를 한 단계만 인식합니다. HTML 텍스트는 `<`·`&`, 인용 속성은 추가로 해당 인용부호의 인코딩이 필요합니다. 비인용 속성은 안전한 인코딩 상태로 판정하지 않습니다. 서로 다른 반영 중 하나라도 필요한 인코딩이 빠지면 안전 처리로 묶지 않습니다.

분석기는 제한된 어휘 기반 관찰기이며 표준 HTML 파서·브라우저 동작의 대체물이 아닙니다. 스크립트·스타일·raw-text·주석·SVG/MathML·비정상 문법·문맥 불일치·20개 초과 반영은 분석 불가로 남깁니다. JSON·일반 텍스트·XHTML·다른 문자셋·부분/이중 인코딩도 안전 처리로 간주하지 않습니다. 정상 응답에도 테스트 마커가 있으면 입력에 의한 반영인지 판정하지 않습니다.

## 재사용한 실행 경계

- `managedProbePolicy.ts`: 기존 SQLi의 정확한 origin·경로·메서드·파라미터 허용 목록, 사용자·연결·SHA·후보·만료 승인 및 입력 검증을 공통화했습니다. XSS는 별도 registry와 승인 및 반영 위치·문맥 binding을 사용합니다. SQLi 승인으로 XSS를 허용하지 않습니다.
- `managedProbeExecution.ts`: GitHub 현재 접근 권한·분석 이력/캐시, Vercel 계정·고정 Preview 배포·비운영·SHA·토큰·연결 버전 재검증을 그대로 사용합니다. 첫 요청 및 두 번째 요청 전에도 확인합니다.
- 예산은 기존 `AnalysisRun.stats`의 `sqliExecution`, `xssExecution`에 분리 보관하되 사용자 시간당 상한은 두 유형 합산 6회입니다. 사용자 행 잠금과 DB 시각으로 요청 2회를 원자적 선예약합니다. 실패·불확실한 전송·두 번째 요청 차단 시에도 자동 환불·재시도하지 않습니다. 기존 통계를 보존하며 새 테이블이 필요하지 않습니다.
- `managedProbeRoute.ts`: 기존 인증·동일 Origin·JSON 8KB/수신 5초·연결 ID·execute 확인 검증을 재사용합니다. 내부 API는 `POST /api/repositories/[connectionId]/practice/xss`입니다.
- `sqliTransport.ts`: 기존 공개 IPv4 제한·DNS pinning·호스트명/인증서 검증·리다이렉트 차단·압축 차단·비공유 agent·고정 헤더·토큰/쿠키 미전달을 사용합니다. DNS 포함 최대 8초/승인 만료, 헤더 8KB·본문 16KB·표시 4,000자 제한을 유지합니다. XSS에는 HTML Accept와 응답 Content-Type 수집만 추가했습니다.
- `ManagedProbeEditor`, `HttpEvidence`, `ProbeObservationHistory`: 기존 SQLi의 승인 만료·명시적 동의·중복 클릭 차단·대상 변경 초기화·언마운트 abort·늦은 응답 무시·결과 identity 확인·최초/커밋 비교·수동 기록 연결을 공통화했습니다. SQLi 공개 컴포넌트/API 이름은 유지합니다.

## 현재 차단 상태와 남은 작업

`xssRegistry.ts`는 `target: null, approvals: []`입니다. 검토·준비된 실제 격리 Preview 배포가 없으므로 임의의 대상이나 예시 승인을 넣지 않았습니다. 실사용에는 synthetic 데이터·읽기 전용 DB·부작용 없는 API·고정 URL·반영 위치/문맥을 검토한 환경과 정확한 사용자별 만료 승인이 필요합니다.

원격 DB의 TLS·개발/운영 구분 및 결과 테이블 마이그레이션은 계속 보류합니다. 기존 결과 저장 API·DB 미준비 503 안내를 사용하고 저장 실패를 성공으로 표시하지 않습니다. 이번 작업에서는 DB 연결 설정·Prisma 스키마·마이그레이션을 변경하거나 DB에 적용하지 않습니다.

스크립트 실행 검증, 브라우저 DOM/저장형 XSS, POST/body/cookie/header 입력, 반영 위치의 실제 DOM 일치 검사, 자동 취약점 확정, HTTP 원본의 영구 보관, 중앙 승인 발급/취소 UI는 제공하지 않습니다.

## 변경 파일

- 공통화: `probeTypes.ts`, `managedProbePolicy.ts`, `managedProbeExecution.ts`, `managedProbeRoute.ts`, `ManagedProbeEditor.tsx`, `HttpEvidence.tsx`, `ProbeObservationHistory.tsx`.
- XSS: `xssProbe.ts`, `xssTypes.ts`, `xssRegistry.ts`, `xssPolicy.ts`, `xssExecution.ts`, `xssReflection.ts`, `XssRequestEditor.tsx`, `XssObservationHistory.tsx`, `practice/xss/route.ts`.
- 기존 연결: SQLi policy/execution/types/registry/transport와 API·편집기·관찰 이력, `PracticeTargetEditor`, `FindingPreparation`, `SecurityTestRecord`, `RepositoryWorkspace`, `ServiceAnalysis`.
- 테스트: `xssReflection.test.tsx`, `xssExecution.test.ts`, 기존 `SqliRequestEditor.state.test.tsx`, `sqliExecution.test.tsx`, `practiceTarget.test.tsx`.

모든 네트워크·권한·DB 실행 테스트는 대역이며 실제 외부 사이트 전송이나 원격 DB 통합 성공을 뜻하지 않습니다. 배포·마이그레이션·commit/push는 수행하지 않습니다.

## 검증 결과 (2026-11-19)

- TypeScript, ESLint(경고 없음), 프로덕션 빌드 통과.
- 관련 18개 테스트 파일, 72개 테스트 통과. 고정 마커의 원문·엔티티·미반영·부분/이중 인코딩·속성 문맥·문맥 불일치·오류/잘림, 실제 AST XSS 후보 연결, 사용자/소유권과 별도 실행 승인, SQLi/XSS 합산 예산·동시 예약·재검증 실패 시 두 번째 요청 차단, Content-Type·TLS 전송 옵션, 대상 변경·명시적 커밋 비교·중복 클릭·늦은 응답, 기존 SQLi·학습·실습·DB 미준비 안내를 검사했다.
- 마이그레이션 테스트는 오프라인 SQL 생성과 파일 비교만 수행했다. 실제 외부 공격 요청·브라우저 실행·원격 DB 조회/변경·마이그레이션 적용은 수행하지 않았다.
