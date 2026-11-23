# IDOR·권한 검증 정적 분석

GitHub 수집 코드로 만든 기존 ts-morph 프로젝트를 재사용한다. 새 AST 프로젝트, AI 호출, HTTP 검사 또는 DB 연결은 추가하지 않는다. `analyzeSourceFiles`의 기존 진입점·CFG·확정 호출·Prisma 접근 메타데이터 위에서 `collectAccessControl`을 실행하며, 실패는 `accessControl.status = failed`로 격리해 SQLi/XSS·그래프 결과를 유지한다.

## 관찰 가능한 패턴

- 확인된 Next App Route Handler의 요청 URL/query, context.params, 본문 입력에서 Prisma where의 ID 계열 필드로 연결되는 값. 조회·수정·삭제를 구분하며 단순 지역 값과 확정 호출의 인수→매개변수 연결을 재사용한다.
- `id`, `...Id`, `..._id`와 단순 비교 연산자(`equals`, `in`, `notIn`, `not`, `lt/lte/gt/gte`), AND·복합 객체. OR/NOT 안의 식별자도 후보로 연결하되 해당 소유권 필터는 보호 근거로 인정하지 않는다.
- 지원되는 인증 라이브러리(next-auth의 getServerSession/auth/getSession, Clerk 서버 auth/currentUser)에서 읽은 사용자 식별자와 ownerId/authorId/userId/accountId/tenantId/organizationId의 where 범위 연결, 동일 조회 객체의 소유자 비교.
- 인증 사용자 role 문자열 비교·리터럴 배열의 includes. 직접 조건 분기 및 다른 파일의 확정 호출을 추적한다. 작업 전 분기, 조회 후 비교, 조건부/반환값 사용 미확인, where 필터를 별도로 표시한다.
- 관리자 경로(admin/management/permissions/roles), user/account/role/permission 쓰기, `*Many` 쓰기를 민감 작업 검토 단서로 사용한다. 필요한 역할은 자동 결정하지 않는다.
- `use client` 코드에서 역할 비교와 변경/관리자 API 요청 구문이 함께 보이면 클라이언트 제한 단서를 표시한다. 매칭된 서버에 역할 비교가 관찰되면 ‘클라이언트에서만 관찰’ 후보를 중복 생성하지 않는다. 다른 서버 의심 후보는 유지한다.
- root/src middleware/proxy와 matcher, 미해결 외부 인증·인가 호출은 존재 근거와 적용 미확인을 표시한다. 미들웨어 적용·배포·권한 정책을 확정하지 않는다.

모든 항목은 `STATIC_REVIEW_ONLY`, `runtimeExploitation: not-tested`인 **취약점 의심 후보**다. 검사 구문이 관찰되어도 후보를 안전·취약으로 판정하지 않는다. 근거 수준은 코드 연결의 수준이며 취약점 확률이 아니다. 인증 읽기는 객체·역할 인가와 구분한다.

## 제한 및 미확인 처리

- JS/TS의 지원되는 Next App API와 출처가 확인된 Prisma만 DB 관계를 확정한다. 다른 프레임워크·ORM·동적 raw SQL의 객체 정책·서버 액션·RLS·DB 트리거·외부 정책 서비스는 완전 분석하지 않는다.
- 외부 패키지는 내려받지 않는다. 프로젝트 고유 인증 래퍼, NextAuth 구성에서 생성한 auth 함수, 고차 Route Handler, 복잡한 반환 계약·별칭·비구조화·반복문·동적 필터·인자 변환은 미확인 또는 분석 경계로 남는다. 호출 깊이를 벗어나면 보호가 없다고 판단하지 않는다.
- 검사 방향(허용/거부), 공개 리소스 정책, 리소스의 실제 소유 관계, 필요한 역할과 전체 반환/예외 경로는 사용자가 확인한다. 단순 ID 사용은 후보 생성의 충분 조건이 아니다. 리터럴 ID·인증된 본인 ID만 사용하거나 출처가 확인되지 않은 DB라면 요청→DB 관계를 만들어내지 않는다.
- 무시된 boolean 반환, await 없는 async 검사, 잡힌 예외, 호출되지 않은 검사 정의를 작업 전 차단으로 인정하지 않는다. CFG의 작업 전 분기 관찰 자체도 비즈니스 정책의 정확성을 증명하지 않는다.
- 최대 후보 100개, 진입점별 함수 경로 64개·호출 깊이 8·입력 추적 160회, DB 문맥 200개. 재귀·불완전 CFG·지원하지 않는 where·미해결 DB 접근은 경계에 표시한다. 후보 없음과 분석 완료는 안전 보증이 아니다.

## 수동 검사·기록 연결

`AccessStaticFindings`에서 파일·함수·API·근거·확인된 검사 구문·호출 경로·미확인 부분·직접 확인 항목을 표시한다. IDOR 후보는 기존 계정 A/B·리소스 비교로, 권한 검증 후보는 역할·작업 비교로 연결한다.

확인된 API 경로/메서드만 **초안**으로 전달한다. 확인하지 못하면 두 필드를 비워 둔다. 계정·리소스·역할·배포 커밋·정책·검사 대상은 사용자가 확정하며, 자동 실행·승인은 추가하지 않는다. 독립 수동 대상 등록도 유지한다.

기존 `SecurityTestRecordProvider`와 `ManualSecurityTarget`의 후보별 scope 및 확정 대상 버전을 재사용한다. 저장소/SHA 범위는 기존 Provider, 대상 변경은 새 버전·이전 기록 읽기 전용 처리로 유지한다. 화면 이동 중 초안은 Provider에 유지한다. 후보 ID·코드 위치·정적 출처를 대상 snapshot의 details와 codeLocation에 보존한다. 새로고침 이후 유지되는 것은 기존 API로 DB 저장에 성공한 기록뿐이다.

결과 저장은 기존 `/api/results`와 `SecurityTestRecord` 모델을 사용하며 `source: MANUAL`이다. 정적 후보 근거는 서버 HTTP 관찰·취약점 검증 성공으로 승격하지 않는다. 기존 소유권·완료된 분석/SHA·대상 일치 검사와 DB 미적용 오류 안내를 그대로 사용한다. 연결 분석의 AnalysisRun.stats에 후보 수/상태/경계 수만 기존 JSON 필드로 추가한다.

DB 스키마 변경·신규 마이그레이션은 필요 없다. 보류 중인 기존 SecurityTestRecord 마이그레이션은 적용하지 않았다. 원격 DB의 TLS·개발/운영 구분 문제는 별도 해결 대상이다.

## 수정 파일

- 분석: `src/lib/ast/accessControl.ts`, `analyzer.ts`, `src/types/security.ts`, `src/types/analysis.ts`
- 캐시/연결 분석 요약: `src/lib/repository/githubAnalysisCache.ts`, `src/app/api/repositories/[connectionId]/analyze/route.ts`
- 화면: `src/components/repository/AccessStaticFindings.tsx`, `ManualSecurityTarget.tsx`, `SqlInjectionFindings.tsx`
- 테스트: `src/lib/ast/accessControl.test.ts`, `accessControl.failure.test.ts`, `src/lib/repository/githubAnalysisCache.test.ts`, `src/lib/github/publicRepositoryAccess.test.ts`, `repositoryAccess.routes.test.ts`, `src/components/repository/AccessStaticFindings.test.tsx`, `SecurityTestRecord.test.tsx`, `src/lib/results/handlers.test.ts`

외부 GitHub 통합 테스트는 별도 opt-in이다. 로컬 테스트는 메모리 AST·모의 DB/API만 사용하며 실제 공격 요청·외부 DB 변경은 실행하지 않는다.

## 검증 결과 (2026-11-20)

- TypeScript: `npm.cmd run typecheck` 통과.
- ESLint: `npm.cmd run lint` 통과. 마지막 API 테스트 추가 후 해당 파일도 별도 ESLint 통과.
- 프로덕션 빌드: `npm.cmd run build` 통과 (Prisma Client 생성 + Next 빌드, 마이그레이션 실행 없음).
- AST 전체·분석 API·캐시·기록·수동 비교 회귀: 20개 파일 355개 테스트 통과, 외부 GitHub 통합 1개 건너뜀.
- 추가된 경계 사례 및 SQLi/XSS·학습·실습·화면 회귀: 15개 파일 92개 테스트 통과.
- 마지막 분석 API 요약 및 캐시 테스트: 2개 파일 55개 테스트 통과.
- 위 실행의 중복을 제외하면 30개 파일에서 404개 테스트 통과, 외부 통합 1개 건너뜀. 저장소 전체 테스트를 실행한 것은 아니다.
