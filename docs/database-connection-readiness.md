# DB 연결 및 마이그레이션 준비 점검

> 후속 적용 완료(2026-11-20): 사용자 승인 후 SecurityTestRecord 1건을 적용했다. 현재 이력은 6건·대기 0건이다. [적용 및 데이터 보존 검증 결과](./security-test-record-migration-applied.md)를 참고한다. 아래는 적용 전 점검 기록이다.

> **현재 상태(2026-11-20):** 아래는 11월 19일의 과거 점검이다. 사용자가 기존 repo-tutor 프로젝트 main(PRODUCTION) 사용을 확정했으며, 공식 CA를 지정해 런타임·Prisma CLI의 엄격한 TLS 검증 문제를 해결했다. 기존 DB를 유지하고 분리/신설하지 않는다. 최신 설정·검증·대기 마이그레이션은 [TLS 해결 보고](./database-tls-resolution.md)를 따른다. 마이그레이션은 여전히 미적용이다.

2026-11-19 점검. 비밀 값은 기록하지 않습니다. 로컬 파일만 수정했으며 DB DDL/DML, 마이그레이션 적용, 서버 설정 변경을 수행하지 않았습니다.

## 확인된 설정

- `src/lib/db.ts`는 `DATABASE_URL`을 `PrismaPg`에 전달합니다. 별도 SSL 옵션은 없습니다.
- `prisma.config.ts`는 `dotenv/config`로 `.env`를 읽고 `DIRECT_DATABASE_URL`을 우선 사용합니다. `.env.local`을 자동으로 읽지 않습니다. Next.js는 `.env.local`도 읽으므로 개발 DB를 설정할 때 두 실행 경로를 모두 확인해야 합니다. 프로세스 환경변수가 파일보다 우선합니다.
- 이번 환경의 `.env`와 `.env.local` DB 값은 같습니다. 두 URL은 같은 원격 Supabase 프로젝트·DB를 가리킵니다. 호스트·사용자·DB 이름은 출력하거나 문서에 기록하지 않았습니다.
- `DATABASE_URL`은 공유 풀러의 6543 포트(트랜잭션 풀링), `DIRECT_DATABASE_URL`은 공유 풀러의 5432 포트(세션 풀링)입니다. 후자는 변수 이름과 달리 direct 호스트가 아닙니다. 마이그레이션은 direct 연결을 우선 검토하고 IPv4만 가능한 환경에서는 공식 세션 풀러 사용 조건을 확인합니다. 트랜잭션 풀러를 마이그레이션 경로로 사용하지 않습니다.
- 두 URL에 `sslmode`·`ssl`·CA 경로 설정이 없고, 현재 설치된 `pg`로 계산한 SSL 설정은 `false`입니다. `PGSSLMODE`, `NODE_TLS_REJECT_UNAUTHORIZED`, `NODE_EXTRA_CA_CERTS`도 현재 점검한 파일·프로세스에는 없습니다.
- 애플리케이션 코드에서 DB 인증서 검증 우회는 발견하지 못했습니다. 기존 외부 요청 전송 코드도 `rejectUnauthorized: true`를 사용합니다. TLS 자체가 꺼져 있는 상태는 별도로 해결해야 합니다.

## 인증서 문제와 안전한 해결

두 엔드포인트에 PostgreSQL SSLRequest 후 인증서와 호스트명 검증을 켠 TLS 핸드셰이크만 시도했습니다. DB 사용자·비밀번호는 보내지 않았고 SQL도 실행하지 않았습니다. 둘 다 `SELF_SIGNED_CERT_IN_CHAIN`으로 실패했습니다.

이는 제공된 인증서 체인을 현재 Node.js 신뢰 저장소로 검증하지 못한다는 뜻입니다. 현재 CA 설정이 없는 점은 확인했지만, 공식 CA 누락인지 중간 인증서 누락 또는 회사 프록시의 인증서인지까지는 이 오류만으로 확정하지 못했습니다.

1. Supabase Dashboard에서 정확한 대상 프로젝트를 확인하고 SSL Configuration의 공식 CA 인증서를 받습니다. 인증서 출처·유효기간·체인과 연결 호스트를 확인합니다. TLS 오류를 낸 서버에서 임의로 추출한 인증서를 바로 신뢰하지 않습니다.
2. 현재 런타임 `pg`에는 `sslmode=verify-full`과 검증된 `sslrootcert` 파일을 사용하는 방식을 권장합니다. 실제 URL에 적용할 값은 비밀 관리 도구에서 변경하고 출력하지 않습니다. 경로는 URL 인코딩하고 실행 환경에서 읽을 수 있어야 합니다. 이 파일에는 CA 공개 인증서만 두며 DB 비밀번호나 개인 키를 넣지 않습니다.
3. `pg`는 URL의 SSL 파라미터가 별도 `ssl` 객체를 덮어쓸 수 있으므로 두 설정 방식을 혼합하지 않습니다. CA를 명시해도 인증서 검증·호스트명 검증을 계속 유지해야 합니다. `sslmode=require`만으로 도구별 검증 동작이 같다고 가정하지 않습니다.
4. Prisma CLI는 런타임과 별도 경로이므로 사용 중인 CLI 버전의 CA 설정 지원과 파일 경로 기준을 확인합니다. CLI에서도 인증서·호스트 검증이 엄격하게 성공하는지 읽기 전용으로 확인한 후에만 마이그레이션을 승인합니다. 런타임의 성공을 CLI 성공으로 간주하지 않습니다.
5. 회사 TLS 프록시가 원인이라면 보안 담당자가 승인한 루트 CA와 네트워크 경로를 확인합니다. 필요 시 승인된 CA를 Node의 추가 신뢰 저장소에 구성하고 재시작합니다. 임의 CA를 추가하지 않습니다.
6. 양쪽 경로에서 실제 TLS 및 인증서·호스트명 검증 성공을 확인합니다. 풀러 경유 `pg_stat_ssl`은 풀러와 DB 사이 연결을 보여줄 수 있으므로 이것만으로 클라이언트→풀러 TLS를 판정하지 않습니다.

`rejectUnauthorized: false`, `NODE_TLS_REJECT_UNAUTHORIZED=0`, `sslmode=no-verify`, `sslaccept=accept_invalid_certs` 같은 우회는 사용하지 않습니다. `.env`, `.env.local`, 런타임 DB 코드, Prisma 연결 설정은 이번 작업에서 변경하지 않았습니다. Supabase의 SSL 강제 설정 변경은 DB 재시작을 유발할 수 있어 이번 작업에서 수행하지 않았습니다.

## 개발·운영 구분

로컬 문서에는 운영 배포 시 연결 설정 지침은 있지만 현재 프로젝트를 개발 또는 운영으로 지정하는 대응표가 없습니다. 환경 파일과 프로세스에서도 이를 확정할 표시는 찾지 못했습니다. `.env.local`, localhost의 Auth URL, `NODE_ENV=development` 또는 DB 이름만으로 원격 프로젝트를 개발 DB라고 판단하지 않습니다. Supabase Dashboard의 프로젝트·브랜치, 실제 배포 환경의 연결 대상과 관리자의 확인이 필요합니다.

당시 제안했던 별도 개발 DB 방안 (현재 계획에서 제외):

- 이후 사용자 지시에 따라 기존 repo-tutor의 main(PRODUCTION)을 계속 사용합니다. DB 신설·분리·브랜치 생성은 수행하거나 계획하지 않습니다. 기존 사용자·저장소·분석 데이터를 유지합니다.

## DB 적용 전 남은 조건

1. 대상 프로젝트의 용도와 적용 승인 확인.
2. 공식 CA로 런타임과 CLI의 엄격한 TLS 검증 성공, 연결 대상 일치 확인.
3. 대상 DB에서 기존 마이그레이션 이력·체크섬·실제 스키마 충돌 재확인. 이번 검증은 인증서 오류 이후 평문 연결로 대체하지 않았으며 SQL 정합성은 오프라인으로 검사합니다.
4. 백업·복구 경로와 외래 키 잠금 영향을 확인하고 승인된 적용 시점을 정합니다.
5. 승인 후에만 `npm.cmd run db:deploy`, `npm.cmd run db:generate`를 실행합니다. `db:deploy`는 모든 대기 마이그레이션을 적용하므로 그 직전에 대기 목록을 다시 확인합니다. reset, db push 또는 shadow DB 기반 점검으로 대체하지 않습니다.

## 공식 근거

- [Supabase SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement)
- [Supabase PostgreSQL 연결 선택과 CA](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [node-postgres SSL 옵션과 URL 덮어쓰기](https://node-postgres.com/features/ssl)
- [Supabase 개발 브랜치](https://supabase.com/docs/guides/deployment/branching)
