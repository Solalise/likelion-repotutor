# SQLi 후보·제한 실행·관찰·수동 기록 흐름

## 현재 상태

`sqliRegistry.ts`는 **target: null, approvals: []**다. 준비·검토된 테스트 배포를 제공받거나 확인하지 않았으므로 실제 대상 URL을 등록하지 않았다. 기초 실습 서버를 연결하거나 임의 사용자 URL로 대체하지 않는다.

SQLi 편집기에서 `서버 실행 승인 확인`을 선택하면 내부 API가 실행 불가 사유를 반환한다. 대상 미등록 시 GitHub/Vercel 메타데이터, DNS, 대상 HTTPS 조회 전에 차단한다. 실행 버튼은 초기 비활성이고, 서버 허용 상태와 요청 내용 확인 체크가 모두 있어야 활성화된다. 현재 코드 설정에서는 활성화될 수 없다.

실행 경로와 제한 구조는 구현했지만 **실제 테스트 사이트를 대상으로 한 HTTP/TLS·운영 DB 통합 검증은 미실시**다. 이 문서의 등록 조건을 갖추지 않으면 실행 대상으로 추가하면 안 된다.

## 대상과 승인 모델

서버 전용 `managedSqliRegistry()`는 대상 1개 또는 null과 운영자가 발급한 승인 목록을 반환한다. 사용자 등록/승인 발급 API는 없다. 클라이언트는 대상 주소를 승인 목록에 추가할 수 없다.

- 대상: ID, 정확한 HTTPS origin, `/api/…` 경로, GET, 파라미터 1개, Vercel 프로젝트·고정 deployment ID.
- 검토 근거: 테스트 전용 격리 환경·가상 데이터·읽기 전용 DB·무부작용 API의 운영자 검토와 참조 문서. 이 boolean들은 DB 격리를 자동 증명하지 않는다. 실제 권한·네트워크·데이터 설정을 운영자가 검토해야 한다.
- 승인: 사용자, 대상 ID, 연결 저장소, 분석 이력 ID, 저장소명, SHA, SQLi 후보 ID, 배포 버전, 발급/만료, 최대 요청 수.
- 승인 유효 기간은 최대 1시간, 요청 수는 2/4/6회만 허용한다. 한 실행에서 정상값·테스트값을 각각 최대 1회 보낸다.
- 소유권 상태는 기존 UserRepository 기록이고, 실행 승인은 별도 registry 항목이다. URL 제어 확인과 실행 승인을 혼동하지 않는다.

초기 지원은 운영자가 관리하는 단일 Vercel 고정 Preview 배포로 제한한다. custom domain, 이동 가능한 alias, Production 배포, 임의 사용자 배포, IPv6-only 대상은 지원하지 않는다. 승인 대상과 편집기 주소·경로·메서드·파라미터가 다르면 수동 입력을 통해서도 실행할 수 없다.

## 서버 검증과 예산

API: `POST /api/repositories/[connectionId]/practice/sqli`

요청은 `{action:"status"|"execute",draft:SqliRequestDraft,confirmed?:true}`. 로그인, 정확한 동일 Origin, JSON, 최대 8KB/수신 5초, URL 연결 ID와 draft 연결 ID 일치를 검사한다. execute에는 명시적 확인이 필요하다. draft는 알려진 필드만 복사하며 쿠키·헤더·토큰·추가 요청 옵션을 실행기에 전달하지 않는다. 기존 512바이트·제어문자 제한에 더해 정상값은 합성 식별자의 영문·숫자·밑줄 1~128자, 테스트값은 `quote-marker-v1`의 고정 따옴표 마커만 허용한다. 조건식·SQL 문장·지연·데이터 추출 기능은 제공하지 않는다. 마커 정책 버전과 값도 승인 fingerprint에 포함하므로 프로브 변경으로 기존 승인 예산을 재사용하지 않는다.

실행 가능 여부는 다음 근거를 서버에서 확인한다.

1. 등록된 단일 대상 및 현재 사용자의 유효 승인.
2. 기존 `requireRepositoryAccess`를 통한 현재 GitHub 권한.
3. 연결 URL·소유권·배포 버전과 승인 일치.
4. 현재 사용자의 완료된 연결 저장소 분석 이력 및 서버 캐시에 존재하는 SQLi 후보.
5. 기존 Vercel 인증·프로젝트 검증 함수 재사용. 공식 API의 READY Git 배포, 저장소·SHA, Preview(`target:null`), 고정 생성 URL과 deployment ID 대응을 확인한다. Production target·복합/점진 배포는 차단한다.
6. 메타데이터 조회 후 계정 토큰 교체·만료, GitHub 권한·소유권·연결 변경 재확인.

첫 요청과 두 번째 요청 전에도 재검증한다. DNS 조회 후에도 승인 만료·변경을 확인한다. 예산 예약 후 재검증이 실패하면 실행을 차단하고 예약을 자동 반환하지 않는다.

새 DB 모델/마이그레이션 없이 기존 `AnalysisRun.stats.sqliExecution`에 승인 fingerprint·누적 요청 수·마지막 예약 시각만 추가한다. 원래 정적 분석 통계는 유지하고 응답 본문은 저장하지 않는다.

- 사용자 행 `FOR UPDATE`와 DB 시각을 사용하는 트랜잭션으로 정상/테스트 **2회 예산을 원자적으로 선예약**한다.
- XSS 연결 이후 승인·실행·API·편집기 코드는 `managedProbe*`와 `ManagedProbeEditor`로 공통화했다. SQLi의 공개 진입점과 정책은 유지하며, 사용자 시간당 6회는 SQLi/XSS 합산으로 제한한다. XSS 별도 승인은 [XSS 검사 문서](./xss-inspection.md)를 참고한다.
- 승인별 최대치와 사용자별 시간당 최대 6회를 함께 적용한다. 계정의 다른 분석 이력도 합산한다.
- 같은 분석 이력의 승인 ID/범위 변경으로 누적 예산을 초기화하지 않는다. 새 승인은 새 분석 이력과 운영자 검토가 필요하다.
- 최근 예약 이력의 누적 요청 수를 보수적으로 합산하므로 정확한 sliding window보다 더 엄격하게 차단될 수 있다.
- 실패·타임아웃·미전송된 두 번째 요청도 예약을 반환하지 않으며 자동 retry하지 않는다. DB 검증 실패 시 차단한다.
- SQLi 예산은 기존 소유권 확인/분석 요청 카운터와 별개다. 상태 확인 API의 메타데이터 조회 트래픽은 이 실행 예산으로 제한하지 않으므로 공개 활성화 전 WAF/계정별 API 제한도 검토해야 한다.

## 전송 경계

별도 `sqliTransport.ts`가 서버에서만 전송한다. 기존 소유권 파일 조회 함수를 범용화하지 않았다. 기존 `resolveOwnershipIPv4`의 공개 IPv4 검증만 재사용한다.

- 사설·루프백·메타데이터·특수 목적 IP가 DNS 결과에 섞여 있어도 차단. IPv6 fallback 없음.
- 검증한 IP 리터럴로 직접 연결하고 실제 소켓 주소를 비교한다. Host·TLS SNI·인증서 identity는 등록 hostname을 사용한다. 인증서 검증을 끄지 않는다.
- GET과 URLSearchParams 파라미터 1개, 고정 헤더만 사용한다. 브라우저 쿠키·GitHub/Vercel 토큰·Authorization·사용자 헤더는 전달하지 않는다.
- redirect·자동 retry·공유 agent·압축 응답은 허용하지 않는다.
- DNS 포함 최대 8초이며 승인 만료가 더 빠르면 그 시점에 제한한다. 응답 헤더 8KB·본문 16KB, 화면 본문 최대 4,000자다.
- RESPONSE, ACCESS_DENIED, NETWORK_ERROR, TIMEOUT, SIZE_LIMIT, BLOCKED를 구분한다.
- 정상 요청이 응답 관찰까지 완료되지 않거나 접근 제한이면 테스트 요청을 보내지 않는다. 미전송 기록에는 HTTP 상태/본문을 만들지 않고 차단 사유만 넣는다.

## 편집기와 결과

기존 `/services` → 저장소 분석 → SQLi 후보 → GET/query 대상 확인 → 실습 준비 → SQLi 요청 편집 흐름을 유지한다.

1. 정상값을 편집하고 사전 정의된 읽기 전용 테스트 마커와 두 URL 미리보기를 확인한다. 브라우저 변조로 다른 테스트값을 보내도 서버가 거부한다.
2. `서버 실행 승인 확인`으로 등록 대상·승인·만료·남은 요청 수를 조회한다. 이 단계는 테스트 대상 API에 요청하지 않는다.
3. 허용 상태일 때만 요청 내용 확인 체크와 전송 버튼을 사용할 수 있다. 실제 전송 시 모든 조건을 다시 확인한다.
4. 실제 응답의 상태·시간·본문·오류를 비교한다. 완전한 응답에만 본문 동일/차이 표시를 사용하며 잘림·실패·차단은 비교 불가다. 결과의 대상·SHA·후보·입력쌍·관찰 형식을 제출한 요청과 대조하고 불일치 응답은 버린다. 입력 변경 시 최초·후속 결과와 동의를 초기화하고 승인 재확인을 요구한다. 서버 응답 대기 시간 초과는 이미 실행됐을 가능성을 안내하고 자동 재시도하지 않는다. 실행 요청 후 결과가 없으면 미실행으로 단정하지 않고 판정 불가로 표시한다.
5. 결과는 항상 판정 불가다. HTTP 비교만으로 취약점 확인/미관찰을 활성화하지 않는다. HTML 본문은 React 텍스트로 렌더링한다.

6. 동일 대상·SHA·입력쌍의 최초 결과를 보존하면서 후속 결과와 비교한다. 재실행도 매번 승인·동의·남은 예산이 필요하다. 후속 실패 시 최초 관찰은 남긴다.
7. `/services`와 저장소 분석 화면의 페이지 수명 내 최근 10회 HTTP 관찰을 보관한다. 수정으로 SHA가 달라지면 재분석·새 대상 확정·새 서버 승인이 필요하다. 독립적으로 실행한 현재 결과가 있을 때만 같은 저장소 연결의 다른 SHA 실행을 사용자가 직접 선택하여 읽기 전용으로 비교한다. URL·API·파라미터·입력쌍·SHA·실행 ID를 각각 표시하며 이전 결과를 새 요청 상태나 검증 결과로 복원하지 않는다. 새로고침·페이지 이탈 시 이 HTTP 이력은 사라진다.
8. 편집기의 `검사 결과 기록으로 이동`은 기존 후보 화면과 같은 확정 대상 버전의 `SecurityTestRecord`를 연다. 사용자가 선택한 최초·후속 HTTP 요약을 수동 메모로 복사할 수 있다. 각 요약은 SHA·대상·입력쌍·실행 ID를 포함하지만 서버 실행 근거의 영구 저장은 아니다. 상태·직접 수행 확인·수정 완료·재검증 완료를 자동 선택하지 않는다. 사용자 판단과 수정 내역, 수행 일시를 작성한 뒤 기존 수정 전후 수동 비교를 사용한다.
9. 수동 기록은 기존 `/api/results`에 저장한다. `P2021`/`P2022`는 `503 RESULTS_SCHEMA_UNAVAILABLE`과 미저장 안내를 반환하고, 연결 오류도 저장 완료로 처리하지 않는다. UI는 성공 응답의 기록 ID·수정 버전·저장소·SHA·대상 키·종류까지 일치해야 저장 완료를 표시한다. 중복 클릭은 차단하고 화면 이탈 후 늦은 응답은 반영하지 않는다.

정적 후보, 서버가 수집한 HTTP 관찰, 사용자의 수동 판단을 분리한다. DB의 `MANUAL` CHECK를 유지하며 서버 HTTP 본문·실행 근거의 영구 보관 모델은 추가하지 않았다. 자동 SQLi 확정 판정, 중앙 승인 발급/취소 화면은 미구현이다. 관리형 테스트 환경 미등록, DB TLS 인증서 및 환경 구분 미해결 상태를 우회하지 않으며 이번 작업에서는 DB에 연결하거나 마이그레이션을 적용하지 않았다.

## 등록 전 최소 작업

1. 관리형 테스트 전용 프로젝트와 immutable Preview 배포를 실제 준비한다. synthetic DB만 연결하고 DB 계정을 읽기 전용으로 제한하며, GET API의 입력 처리에도 쓰기·외부 호출·운영 데이터 접근이 없음을 확인한다.
2. 승인할 VulnLab 사용자가 해당 GitHub 저장소를 연결·분석하고, 동일 배포 URL·Vercel 프로젝트를 연결하고 소유권 확인을 완료한다. 승인할 코드가 배포 SHA와 같아야 한다.
3. 운영자가 고정 URL·경로·q 등 실제 파라미터·프로젝트/배포 ID·검토 근거를 registry에 등록하고 정확한 사용자·분석 이력·후보·버전으로 만료형 승인을 발급한다. 예시 hostname/가짜 승인으로 활성화하면 안 된다.
4. 동일한 PostgreSQL에서 JSON counter·트랜잭션·사용자 행 잠금·다중 인스턴스 예산 동작을 확인한다. 캐시 소실 시 재분석이 필요하다. DB 응답/권한 검증 실패를 우회하지 않는다.
5. 실제 TLS, DNS pinning, redirect, timeout, 응답 크기, 요청 2회 상한을 배포 환경에서 검증한 뒤 제한된 사용자에게만 연다. 서버 함수의 120초 설정과 provider 한도도 확인한다.

정적 registry 변경은 새 서버 배포가 필요하다. 구버전 배포의 승인이 자동으로 폐기되는 중앙 승인 관리 시스템은 없다. 실제 운영 전 구버전 배포 접근 차단과 중앙 취소/감사 요구를 검토하고, 즉시 중단 시에는 대상 API 자체를 차단하거나 연결 버전을 변경해야 한다. 사용자 임의 배포 URL 지원은 별도 후속 작업이다.

## 검증 범위

- DNS·HTTPS·Vercel·DB는 대역이다. 대상 없음/변조/만료/Production 거부, 승인 예산, 사설 IP·redirect·응답 크기·네트워크 오류·타임아웃 처리와 고정 프로브·API 입력 차단을 검사한다. 테스트 응답은 테스트 파일 안에만 있고 제품 화면에 생성하지 않는다.
- 편집기의 중복 클릭·뒤로 이동·대상 변경·늦은 응답·타임아웃·최초 관찰 보존·후속 비교와 커밋 간 명시적 비교를 검사한다. 메모 복사가 사용자 판단이나 재검증 완료로 승격되지 않는지 확인한다.
- DB 미적용·연결 실패·변조된 성공 응답이 저장 성공으로 표시되지 않는지 검사한다.
- TypeScript·ESLint·관련 테스트·프로덕션 빌드로 로컬 변경을 검증한다. 전체 테스트를 실행했다는 의미는 아니다.
- 실제 테스트 사이트 요청, 원격 DB 통합 검증, 로그인 브라우저 동작 확인은 하지 않는다. 테스트 통과를 실제 HTTPS 통합 성공으로 해석하지 않는다. 배포·마이그레이션·commit/push 및 기초 학습/실습 서버 변경은 하지 않는다.

2026-11-19 최종 검증: TypeScript, ESLint, 프로덕션 빌드 통과. 관련 13개 테스트 파일의 48개 테스트 통과. 마이그레이션 테스트는 오프라인 SQL 생성·비교만 수행했다.

## 이번 연결 작업의 수정 파일

- 실행 입력·관찰 계약: `src/lib/security-lab/sqliProbe.ts`, `sqliPolicy.ts`, `sqliTypes.ts`.
- 검사 UI와 기록: `src/components/repository/SqliRequestEditor.tsx`, `PracticeTargetEditor.tsx`, `SecurityTestRecord.tsx`, `SqlInjectionFindings.tsx`.
- 커밋 간 관찰 이력: `src/components/repository/SqliObservationHistory.tsx`, `RepositoryWorkspace.tsx`, `src/components/services/ServiceAnalysis.tsx`.
- DB 미적용 대응: `src/lib/results/handlers.ts`, `src/components/results/RecordPersistence.tsx`, `recordClient.ts`.
- 테스트: `src/lib/security-lab/sqliFlow.test.ts`, `sqliExecution.test.tsx`, `src/components/repository/SqliRequestEditor.state.test.tsx`, `SecurityTestRecord.test.tsx`, `src/lib/results/handlers.test.ts`, `src/components/results/recordClient.test.ts`.
- 문서: `docs/sqli-execution-mvp.md`.

실행 registry·전송기·기초 실습 서버·Prisma 스키마·마이그레이션·실제 DB 연결 설정은 이번 작업에서 변경하지 않았다. 이전 작업의 미커밋 변경은 보존한다.
