# Vercel 1차 MVP 배포 준비

## 이번 변경과 검증 범위

1차 MVP는 GitHub 로그인 → 저장소 연결 → SQLi/XSS 정적 후보 분석 → 배포 URL·소유권 확인 → 실습 준비·SQLi 요청 편집까지다. 실제 공격 전송·실행 승인·결과 판정·재검증은 계속 비활성화한다.

- `repositoryMetadataAccess.test.ts`의 인수 없는 페이지 호출을 현재 시그니처에 맞췄다. `/repositories`는 `/services`로 redirect하며, 현재 권한 검증 책임이 있는 서비스 페이지와 API에서 동기화 실패 시 메타데이터 조회 금지·사용자별 활성 연결/분석 이력 범위를 검사하도록 기존 테스트 기대값을 갱신했다. 타입 오류 무시 설정은 추가하지 않았다.
- `build`를 `prisma generate && next build`로 변경했다. 기존 Prisma 7 config와 기본 생성 경로를 재사용한다. 마이그레이션을 build/install에 연결하지 않았다.
- production에서는 로컬 기초 실습 링크를 href 없는 disabled 버튼으로 표시한다. 메인/학습/실습 화면에 안내를 표시하고 로컬 health 조회를 하지 않는다. 기존 로컬 Runner 페이지도 production에서 안내만 표시한다. development/test의 링크·학습·실습 서버 동작은 유지한다. 기초 서버의 production 기동 거부는 변경하지 않았다.
- 상세한 실제 변경 파일 목록은 아래에 있다. 작업 시작 전부터 있던 다른 변경 파일은 이번 작업에서 되돌리지 않았다.

검증:

- `npx.cmd vitest run src/lib/repository/deploymentReadiness.test.tsx`: **관련 테스트 2개 통과**. DB 트랜잭션/잠금 호출 순서와 예약 한도는 대역으로 검증했으며 실제 PostgreSQL 부하·동시성 테스트는 아니다. production UI의 비활성 링크·로컬 조회 차단 및 development 링크 유지도 검사했다.
- `npx.cmd tsc --noEmit --incremental false`: **1회 실행, exit 0, 오류 없음**.
- 전체 테스트·빌드·ESLint·Prisma 생성·DB 마이그레이션·commit/push·실제 배포는 실행하지 않았다. 수정한 기존 repositoryMetadataAccess 테스트 파일 자체를 추가 실행하지 않았다(테스트 수 제한).

## 분석 API 보호

소유권 확인용 `DeploymentVerificationRateLimit`은 기존 의미를 유지한다. 분석용 카운터로 섞어 쓰지 않았다. 기존 `User`와 `AnalysisRun`을 이용하므로 새 테이블/컬럼/마이그레이션이 없다.

`reserveAnalysisRun`은 DB 트랜잭션에서 현재 사용자 행을 `FOR UPDATE`로 잠근 뒤, DB 시각 기준 최근 10분 AnalysisRun 개수를 세고 새 RUNNING 이력을 예약한다. 같은 사용자의 여러 서버 인스턴스 요청도 같은 DB 행을 잠그게 설계했다.

- 사용자별 10분에 10회, 저장소·공개 URL/연결 저장소 전체 합산.
- 실패·캐시 적중·중단된 요청도 예약 이력으로 계산. 대상 변경으로 예산을 초기화하지 않는다.
- 초과 시 HTTP 429와 `Retry-After: 600`, DB 검증 실패 시 503으로 분석 시작을 차단한다.
- `/api/repositories/[connectionId]/analyze`: 기존 로그인·저장소 권한 확인 뒤, 소스 수집 전에 항상 예약한다. 수집 후 권한 재검증도 유지한다.
- `/api/analyze?source=github`: production에서 로그인과 동일 DB 제한을 적용한다. 공개 저장소 여부 검증은 유지하고 비공개 저장소의 App 권한을 우회하지 않는다. development/test의 기존 익명 공개 URL 동작은 유지한다.
- `/api/analyze?source=sample`과 behavior의 sample 분석은 production에서 403으로 차단한다. 로컬 샘플 파일에 대한 운영 의존도와 익명 AST 실행 경로를 줄인다.
- production의 공개 behavior 조회는 로그인 필요. 새 분석을 준비하는 경로는 기존 분석 API를 거치므로 동일한 admission을 사용한다.
- 프로세스 내부 coalescing·캐시는 최적화다. 배포 전체의 요청 제한으로 취급하지 않는다.

이 제한은 고비용 소스 수집/AST 실행의 **인증 사용자별 예약**에 적용된다. 인증 실패 트래픽, 로그인·목록 동기화·캐시 기반 behavior 조회·대량 계정 생성에 대한 전체 WAF/IP/계정 정책이나 전체 서비스 비용 상한을 구현한 것은 아니다. 공개 트래픽 범위에 맞춰 Vercel WAF 등 별도 정책을 설정해야 한다.

## Vercel 환경변수

필수:

- `DATABASE_URL`: 운영 PostgreSQL/Supabase 런타임 URL. 로컬 주소 사용 금지. pooler·TLS·연결 수 정책 확인.
- `AUTH_SECRET`: 운영 Auth.js 비밀값.
- `AUTH_URL`: 운영 HTTPS 기준 URL.
- `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`: 기존 GitHub 로그인 앱 설정.
- `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY_BASE64`: 설치형 GitHub App 설정.
- `TOKEN_ENCRYPTION_KEY`: base64 인코딩한 32바이트 키. 기존 암호화 데이터와 동일한 키가 필요하며 임의 교체 시 저장 토큰을 읽을 수 없다.

조건부:

- `DIRECT_DATABASE_URL`: 별도로 승인한 스키마 관리 작업의 직접 연결. Prisma config는 없으면 DATABASE_URL을 사용한다. 이번 배포 build는 migration을 실행하지 않는다.
- `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_TIMEOUT_MS`: 기존 AI 설명 기능을 사용할 때.
- `GITHUB_TOKEN`: 기존 공개 URL 분석의 선택적 서버 토큰. 연결 저장소 분석의 설치 토큰을 대체하지 않는다.

환경변수 이름에 NEXT_PUBLIC 접두사를 붙이지 않는다. 로컬 env 값을 로그나 보고서에 출력하지 않았다. Vercel의 실제 환경변수 값/등록 여부는 확인하지 않았다.

## 최초 배포 전 직접 확인

1. Vercel 프로젝트의 루트가 메인 Next.js 저장소인지, Build Command가 갱신된 `npm run build`를 사용하는지 확인한다. 별도 `next build` override가 있으면 Prisma 생성 단계가 생략된다. Prisma CLI를 포함해 빌드 의존성이 설치되어야 한다.
2. 지원 Node.js 버전·함수 실행 시간·메모리 설정을 확인한다. 동기 AST의 실제 배포 성능과 외부 API 지연은 미검증이다.
3. 운영 DB에 기존 migrations의 인증·배포 URL·소유권 challenge·Vercel 연결 테이블/컬럼이 이미 적용됐는지 확인한다. 미적용이라면 백업과 적용 대상 확인 후 별도 승인된 절차로 적용한다. 앱 부팅/빌드가 자동으로 스키마를 맞추지 않는다.
4. DB 연결의 TLS, pooler와 트랜잭션 지원, 사용자 행 잠금 및 AnalysisRun 읽기/쓰기 권한, 연결 수 제한을 확인한다. 실 DB에서 제한 초과 429와 DB 장애 시 차단 동작도 확인한다.
5. GitHub 로그인 callback을 운영 도메인의 `/api/auth/callback/github`에, 설치 완료 Setup URL을 `/api/github/installations/callback`에 맞춘다. App 읽기 권한·허용 저장소·사용자 인증 설정과 운영 HTTPS 쿠키 흐름을 확인한다.
6. 환경변수·토큰 암호화 키·Vercel 사용자별 토큰 연결을 확인한다. 소유권 파일이 대상의 정확한 `/.well-known/vulnlab-ownership.txt`에서 redirect 없이 제공되는지 확인한다.
7. 배포된 사이트에서 로그인 → 저장소 선택 → 분석 → 후보 없음/있음 → 배포 URL 연결·소유권 검증 → 실습 준비를 직접 확인한다. SQLi 전송 버튼이 계속 비활성이고 production 화면에 활성 localhost 링크나 health 요청이 없는지 확인한다.
8. 분석 상세 결과는 여전히 메모리 캐시이며 DB는 이력·통계를 저장한다. 콜드 스타트/다른 인스턴스에서는 재분석이 필요하다. 원본 분석을 영구 복원하는 기능으로 안내하지 않는다.

현재 알려진 타입 오류는 해소됐지만 실제 Vercel build 성공, 운영 DB 상태, 인증 callback, GitHub/Vercel 접근 권한까지 정상이라고 판단하지 않는다.

## 이번 수정 파일

- `package.json`
- `src/lib/github/repositoryMetadataAccess.test.ts`
- `src/lib/repository/analysisAdmission.ts` (추가)
- `src/lib/repository/deploymentReadiness.test.tsx` (추가)
- `src/app/api/analyze/route.ts`
- `src/app/api/repositories/[connectionId]/analyze/route.ts`
- `src/lib/behavior/query/source.ts`
- `src/lib/security-lab/basicSiteConnection.ts`
- `src/components/ui-platform/LocalPracticeLink.tsx` (추가)
- `src/components/ui-platform/LocalIdorLab.tsx`
- `src/components/ui-platform/PracticeDashboard.tsx`
- `src/components/ui-platform/PlatformViews.tsx`
- `src/components/learning/Learning.tsx`
- `src/app/security-lab/project/page.tsx`
- `docs/first-vercel-deployment.md` (추가)
