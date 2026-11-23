# SecurityTestRecord 운영 마이그레이션 적용 결과

2026-11-20 KST. 사용자가 기존 Supabase **repo-tutor / main(PRODUCTION)**에 `20261119000100_security_test_records` 1건 적용을 명시적으로 승인한 작업이다. 실제 비밀번호·토큰·연결 문자열·백업 데이터는 기록하지 않는다.

## 적용 전 점검

- 기존 DIRECT_DATABASE_URL의 세션 풀러(5432)를 사용했다. 런타임과 CLI가 같은 Supabase tenant/DB를 가리키고 `.env`·`.env.local`이 일치하며 프로세스 URL 덮어쓰기가 없음을 확인했다. 기존 프로젝트 대응은 사용자 확인과 보존된 연결 설정을 기준으로 했다.
- PostgreSQL 17.11, 공식 CA의 엄격한 TLS 체인·호스트명 검증을 재확인했다. pg·PrismaPg·CLI의 읽기 전용 쿼리가 성공했고 pg/CLI 모두 잘못된 CA·호스트명을 거부했다.
- 원본 백업 SHA-256 `7eda74601b42d476fee03380b23798a4ec2a266e51d9a17a4c85d252dbce49c9`, USB 암호화 사본 SHA-256 `de6955334750e775a695b6745f2e6757209aee5fda5df4e853fc9fb334f6f68c`이 승인 값과 일치했다. 파일은 읽기만 했다.
- 적용된 기존 이력 5건의 체크섬이 모두 일치했고 실패/미완료·로컬 파일 누락이 없었다. 대기 항목은 승인된 1건뿐이었다.
- 승인 SQL의 SHA-256은 `817d115b257e654cf9f7325f90a3f7b2cb300317637d0cc00f612b42aea49e22`였다. SQL은 새 결과 테이블·보조 인덱스 2개·그 테이블의 FK 2개만 추가한다. 기존 테이블 변경·삭제·기존 데이터 DML이 없다.
- 테이블·PK·보조 인덱스·FK·CHECK 이름 충돌이 없었다. 60초 이상 트랜잭션·잠금 대기·대상 테이블의 강한 잠금이 없음을 확인했다.
- 원래 public 테이블 11개의 행 수와 데이터 내용을 원본 백업과 비교해 모두 일치했다. 데이터는 메모리에서만 정규화/비교하고 출력·파일 저장하지 않았다. 백업 이후의 생성/수정 시각도 발견되지 않았다.

## 실행

`package.json`의 `db:deploy`가 정확히 `prisma migrate deploy`인지, 다른 pre/post lifecycle hook이 없는지 확인했다. 실행 직전에 백업 해시·전체 로컬 SQL 집합·대기 1건·이력·행 수·잠금을 다시 확인한 뒤 다음을 실행했다.

1. `npm.cmd run db:deploy` — 종료 코드 0, 승인한 마이그레이션 적용과 전체 적용 성공 메시지 확인.
2. 위 성공 이후 `npm.cmd run db:generate` — 종료 코드 0, Prisma Client 7.10.1 생성 성공.

다른 마이그레이션·초기화·db push·강제 복구·운영 복원은 실행하지 않았다. 승인 SQL 파일도 변경하지 않았다.

## DB 검증

- Prisma migrate status: 이력 총 6건, 최신 상태, 대기 0건. DB 이력은 6건 모두 완료, 실패/미완료 0건이다.
- `public.security_test_records`: 승인 SQL의 **14개 컬럼**이 타입·NOT NULL·기본값·timestamp(3)까지 일치한다.
- PK `security_test_records_pkey` 및 보조 인덱스 `security_test_records_user_id_updated_at_idx`, `security_test_records_user_id_repository_full_name_kind_sta_idx`가 모두 유효하다.
- 사용자 FK는 `ON UPDATE CASCADE / ON DELETE CASCADE`, 분석 FK는 `ON UPDATE CASCADE / ON DELETE RESTRICT`로 생성됐고 모두 검증 완료 상태다.
- `security_test_records_manual_source_check`는 `source = 'MANUAL'`을 강제한다. Prisma가 모델링하지 못하는 이 CHECK는 카탈로그에서 별도로 확인했다.
- 읽기 전용 `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script --exit-code`: 종료 코드 0, 지원되는 Prisma 스키마 범위의 차이 없음. 출력 SQL은 실행하지 않았다.
- 실제 Prisma 모델의 `count`, 빈 목록 `findMany`, 없는 id의 `findFirst`가 성공했다. 결과 테이블은 0건이며 실제 검사 기록은 생성하지 않았다.

| 기존 핵심 데이터 | 적용 전 | 적용 후 |
| --- | ---: | ---: |
| users | 1 | 1 |
| repositories | 3 | 3 |
| analysis_runs | 53 | 53 |

행 수만 비교한 것이 아니라 원래 11개 테이블의 내용도 다시 비교해 일치했다. `_prisma_migrations`에서는 승인된 신규 이력 1행의 이름·체크섬·완료 상태를 확인한 뒤 제외하고 기존 5행이 그대로인지 비교했다. 새 결과 테이블 0건도 별도로 확인했다.

## 애플리케이션 검증 및 범위

- 관련 6개 테스트 파일, **48개 테스트 통과**: 결과 API 권한/검증/오류 처리, SQL 정합성, 결과 상세/클라이언트, 수동 기록, 엄격 TLS 설정. 쓰기 단위 테스트는 모의 DB에만 수행했다.
- `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run build` 모두 통과했다. 빌드는 로컬 Client 생성과 Next 빌드이며 배포하지 않았다.
- 별도 localhost 포트에서 프로덕션 서버를 잠시 실행해 GET만 확인하고 종료했다. `/results` 200, `/api/results` 및 없는 결과 id API는 비로그인 401, `/results/<없는 id>`는 로그인으로 307 리디렉션됐다. 테이블 미존재 오류는 관찰되지 않았다.
- 비로그인 API 401은 인증 차단 확인이지 인증된 DB 조회의 증거가 아니다. 실제 테이블 접근은 위 Prisma 모델 조회로 별도 확인했다. **로그인 사용자의 실제 HTTP 목록 조회, 저장된 레코드 상세 200, POST/PATCH/DELETE는 이번 단계에서 검증하지 않았다.** 새 테이블이 비어 있고 쓰기 승인이 없으므로 실제 레코드를 만들지 않았다. 인증을 우회하거나 새 로그인/세션을 만들지 않았다.

## 검증 중 보완 및 남은 항목

DB 마이그레이션 자체는 오류 없이 성공했다. 보조 비교 스크립트의 Windows CRLF·인용된 camelCase 컬럼 처리를 보완했다. 최초 카탈로그 검증의 컬럼 기대 개수 오기(16)를 승인 SQL 기준 14로 정정했고 전체 컬럼을 다시 검증해 통과했다. 이는 DB 변경 실패나 추가 스키마 수정이 아니다.

다음 단계는 별도 승인 후 로그인 사용자의 합성 검사 기록 저장·조회·수정과 다른 사용자 접근 차단을 실제 API로 확인하는 것이다. 저장·수정·삭제 쓰기 검증은 미실시이며, 삭제 API 지원 여부도 구현 범위에서 확인해야 한다. 이번 적용으로 저장 기능의 스키마 부재 원인은 해소됐다.

백업 원본/암호화 USB 사본 변경·삭제, 운영 복원, 실제 공격 요청, 배포, commit/push는 하지 않았다.
