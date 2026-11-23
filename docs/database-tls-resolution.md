# 기존 Supabase 연결 TLS 해결 (2026-11-20)

> 후속 상태: 같은 날 사용자 승인으로 SecurityTestRecord 마이그레이션 1건을 적용하고 검증했다. 아래 미적용 관련 내용은 TLS 해결 당시 상태다. 현재 결과는 [운영 마이그레이션 보고](./security-test-record-migration-applied.md)를 따른다.

## 대상과 변경 범위

사용자가 확인한 **기존 Supabase repo-tutor 프로젝트의 main(PRODUCTION) 브랜치**를 그대로 사용한다. RepoTutor → VulnLab 전환은 같은 프로젝트/DB에서 계속한다. DB 신설·분리·초기화·재생성은 하지 않았다. 실제 호스트·사용자·비밀번호·URL·토큰은 이 문서와 진단 출력에 기록하지 않는다.

런타임은 공유 transaction pooler(6543), `DIRECT_DATABASE_URL`은 같은 DB의 공유 session pooler(5432)다. 후자는 이름과 달리 direct 호스트가 아니다. 호스트·포트·계정·비밀번호·DB 이름을 보존하고 로컬 TLS 파라미터만 변경했다.

## 확인된 원인

- Node **24.14.0**, pg **8.23.1**, Prisma CLI/adapter **7.10.1**.
- 변경 전 두 URL 모두 SSL 모드와 CA 경로가 없었다. pg는 기본적으로 TLS를 사용하지 않으며, Prisma의 별도 Schema Engine은 기본 TLS/인증서 정책이 pg와 같지 않다. 단순히 같은 URL 또는 `require`만 지정하면 양쪽 검증 수준이 같아지지 않는다.
- 인증정보를 보내지 않는 PostgreSQL SSLRequest + 엄격한 Node TLS 핸드셰이크로 두 포트의 `SELF_SIGNED_CERT_IN_CHAIN`을 재현했다.
- Node 기본 CA 144개와 Windows 시스템 CA 133개에서 Supabase 자체 루트를 신뢰하지 못했다. `node --use-system-ca`로 Windows CA를 추가해도 동일하게 실패했다. 전역 `NODE_EXTRA_CA_CERTS`, `PGSSLROOTCERT`, `SSL_CERT_FILE` 설정과 인증서 검증 우회 설정은 발견되지 않았다.
- 공식 CA를 명시하면 두 포트 모두 체인·호스트명 검증을 통과하고 `authorized: true`, **TLS 1.3**으로 연결된다. 관찰한 발급 체인은 `Supabase Intermediate 2021 CA → Supabase Root 2021 CA`다. 오류의 직접 원인은 **Supabase 루트 CA 신뢰 설정 누락**이다.

## CA 출처와 신뢰

공식 Dashboard의 [다운로드 URL 템플릿](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json)을 확인하고 production용 주소로 내려받았다. HTTPS 인증서 검증은 계속 켰으며, DB 서버가 보낸 루트를 추출해 바로 신뢰하지 않았다. `https://supabase.com/prod-ca-2021.crt`는 실제 404였으므로 사용하지 않았다.

- 공식 파일: [Supabase production CA](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt)
- 저장 위치: `certs/supabase-prod-ca-2021.crt` (공개 CA만 포함, 개인 키 없음)
- Subject/Issuer: Supabase Root 2021 CA, Supabase Inc
- 유효기간: 2021-04-28 ~ 2031-04-26 UTC
- SHA-256: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`

다운로드/로컬 설정 스크립트는 위 지문을 확인한다. 공식 CA가 교체되면 provider의 교체 공지를 검토한 뒤 지문·파일을 갱신한다. Node/Windows 전역 신뢰 저장소는 변경하지 않았으며 해당 CA는 DB 연결에만 지정했다.

## 프록시·백신 점검

- 현재 프로세스에는 HTTP_PROXY/HTTPS_PROXY/ALL_PROXY가 존재한다. 값은 출력하지 않았다. Windows 사용자 프록시·PAC 설정은 확인되지 않았다.
- pg는 Node TCP 소켓으로 DB에 연결한다. HTTP 프록시 환경변수의 존재만으로 PostgreSQL TLS 재서명을 의미하지 않는다.
- 관련 보안제품 이름의 Windows 루트 인증서는 발견되지 않았고 SecurityCenter 조회는 등록 제품 정보를 반환하지 않았다. 이 결과만으로 모든 백신·네트워크 보안장비가 없다고 단정하지 않는다.
- 실제 DB 체인이 공식 Supabase CA와 일치하고 해당 CA만으로 엄격한 검증이 성공했다. **이번 연결의 인증서를 대체한 프록시·백신 개입 증거는 없다.** TLS 검사 비활성화나 기업 CA 임의 설치는 하지 않았다.

## 수정한 연결 방식

| 경로 | 엄격한 TLS 설정 |
| --- | --- |
| Next/PrismaPg/pg 런타임 | `sslmode=verify-full`, `sslrootcert`에 공식 CA 절대 경로 |
| Prisma CLI Schema Engine | `sslmode=require`, `sslaccept=strict`, `sslcert`에 같은 공식 CA 절대 경로 |

두 도구는 CA 파라미터 의미가 다르므로 동일한 URL 쿼리를 복사하지 않는다. pg의 `sslcert`는 클라이언트 인증서지만 Prisma Schema Engine의 `sslcert`는 여기서 서버 CA 파일이다. 런타임에는 별도 `ssl` 객체를 혼합하지 않아 URL 파라미터에 의한 덮어쓰기를 피한다. CLI는 `require` 단독이 아닌 **strict와 CA를 함께 요구**하고 실제 잘못된 CA/호스트 거부도 확인했다.

- `.env`, `.env.local`의 두 URL을 각각 갱신했다. 두 파일의 대상 값 일치를 확인했으며 Git 추적에서 제외되어 있다. 인증·기타 환경변수는 바꾸지 않았다.
- `src/lib/databaseTls.ts`에서 Supabase의 필수 SSL 모드·CA 파일·유효기간을 검증한다. 검증 비활성화·상충 SSL 옵션·중복 쿼리·목적지 덮어쓰기를 거부한다. CLI에서 transaction pooler 사용도 차단한다. 오류에는 URL을 포함하지 않는다.
- `src/lib/db.ts`, `prisma.config.ts`에 위 검증을 연결했다. 기존 localhost 예제의 동작은 유지한다.
- `.env.example`에 런타임/CLI 설정 차이를 기록했다.

로컬 `.env`의 CA 경로는 현재 작업 폴더의 절대 경로다. 폴더를 옮기면 공식 파일을 유지한 상태에서 `node scripts/configure-db-tls.mjs`를 실행해 다시 지정한다. 이 명령은 로컬 환경 파일만 수정한다. 배포 환경은 해당 환경에서 읽을 수 있는 CA 경로를 별도로 지정해야 하며 이번에는 배포 설정을 변경하지 않았다.

이미 실행 중인 Next 개발 서버는 **다시 시작**해야 환경변수와 캐시된 Prisma Client가 새 연결 설정을 사용한다. 사용자 앱 프로세스를 임의 종료하지 않았다.

## 실제 TLS 검증 결과

`node scripts/verify-db-tls.mjs --read-only`를 명시적으로 실행했다. 인증된 쿼리는 `READ ONLY` 트랜잭션의 상수 SELECT와 시스템 카탈로그/마이그레이션 이력 조회로 제한했다. Prisma CLI에는 고정 `BEGIN READ ONLY; SELECT 1; ROLLBACK;`만 전달했다. 인증정보와 CLI 원문 출력은 출력하지 않는다.

| 확인 항목 | 결과 |
| --- | --- |
| Node 기본 신뢰/Windows 추가 신뢰, CA 지정 전 | 두 포트 모두 `SELF_SIGNED_CERT_IN_CHAIN` 재현 |
| 공식 CA 지정, 두 포트 핸드셰이크 | 체인·호스트 검증 성공, TLS 1.3 |
| pg 런타임 | `authorized: true`, 읽기 전용 SELECT 성공 |
| PrismaPg 런타임 | 읽기 전용 SELECT 성공 |
| pg에 무관한 공인 루트 CA 지정 | `SELF_SIGNED_CERT_IN_CHAIN`으로 거부 |
| pg에 동일 서버 IP(인증서와 불일치) 지정 | `ERR_TLS_CERT_ALTNAME_INVALID`로 거부 |
| Prisma CLI | strict + 공식 CA로 읽기 전용 쿼리 성공 |
| Prisma CLI에 무관한 CA / 호스트명 불일치 | 각각 TLS 오류로 거부 |

초기 PrismaPg 확인 중 기본 transaction 연결 대기 2초를 넘겨 `P2028`이 발생했다. 검증 스크립트의 연결 대기를 15초로 지정하자 성공했다. 이는 TLS 오류가 아니며 앱의 트랜잭션 정책이나 DB 설정은 변경하지 않았다.

로컬 단위/회귀 테스트 90개, TypeScript, ESLint, 프로덕션 빌드도 통과했다. 빌드의 `prisma generate`는 로컬 Client 생성이며 마이그레이션 적용이 아니다.

## 마이그레이션 적용 가능 여부

읽기 전용 확인 결과 기존 `users`, `repositories`, `analysis_runs`는 존재한다. 적용된 마이그레이션 5건의 로컬 체크섬이 모두 일치하고 실패/미완료 이력과 로컬 파일 누락이 없다. 대기 중인 것은 **`20261119000100_security_test_records` 1건**이다.

새 테이블/인덱스 이름 충돌이 없고 FK 대상인 기존 두 테이블의 id 컬럼은 예상한 text 타입이다. 기존 SQL은 새 결과 테이블·인덱스·그 테이블의 FK만 추가하며 기존 테이블/컬럼 삭제 또는 기존 데이터 변경 SQL은 없다. 이 파일은 이번 작업에서 수정하지 않았다.

**TLS 연결 장애는 해결되었고 관찰한 범위에서 해당 마이그레이션을 적용할 수 있는 상태다. 다만 운영 DB 적용 승인은 받지 않았으므로 실행하지 않았다.** 실제 적용 직전 대기 목록을 다시 확인하고 기존 백업/복구 상태와 적용 시간을 확인한 후 사용자가 승인해야 한다. 전체 스키마 드리프트와 실제 복구 가능성을 이번 TLS 점검으로 보증하지 않는다.

승인 후 사용할 명령은 `npm.cmd run db:deploy`다. 이는 모든 대기 마이그레이션을 적용하므로 현재 1건이라는 상태가 바뀌지 않았는지 먼저 확인한다. `migrate dev`, reset, db push, DB 재생성은 사용하지 않는다. TLS 수정만으로 SecurityTestRecord 테이블이 생기지는 않으며 적용 전 저장 불가 안내는 계속 표시되는 것이 맞다.

## 수정 파일 및 재현 도구

- 공개 CA: `certs/supabase-prod-ca-2021.crt`
- 연결 검증/진입점: `src/lib/databaseTls.ts`, `src/lib/databaseTls.test.ts`, `src/lib/db.ts`, `prisma.config.ts`
- 로컬 환경: `.env`, `.env.local`, `.env.example`
- 공식 CA 받기: `scripts/download-supabase-ca.mjs`
- 환경 파일 설정: `scripts/configure-db-tls.mjs`
- 인증 전 TLS 진단: `scripts/db-tls-diagnose.mjs` (`--official-ca`로 공식 CA 비교)
- 실제 읽기 전용 검증: `scripts/verify-db-tls.mjs --read-only` (현재 Node 24 사용)
- 문서: 이 파일 및 `docs/database-connection-readiness.md`

## 공식 근거

- [Supabase SSL·CA·호스트명 검증](https://supabase.com/docs/guides/platform/ssl-enforcement)
- [Supabase 연결 방식](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Dashboard CA URL 원본](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json)
- [Node 시스템 CA와 추가 CA](https://nodejs.org/learn/http/enterprise-network-configuration)
- [node-postgres SSL 설정과 URL 우선순위](https://node-postgres.com/features/ssl)
- [Prisma 7의 드라이버별 TLS 차이](https://www.prisma.io/postgres/ssl-connection-error)
- [Prisma Schema Engine SSL 파라미터 구현](https://prisma.github.io/prisma-engines/doc/src/quaint/connector/postgres/url.rs.html)
