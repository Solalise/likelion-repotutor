# 수동 검사 결과 영구 저장

Prisma/PostgreSQL(Supabase 연결)과 Auth.js DB 세션을 재사용합니다. 별도 Supabase 클라이언트나 브라우저 저장소를 사용하지 않습니다.

- SecurityTestRecord: 사용자 FK, 완료된 AnalysisRun FK, 저장소 전체 이름·SHA 스냅샷, 확정 대상 키와 대상 identity, 취약점 종류, 최초 검사 상태, MANUAL 출처, 초안 JSON, 수정 충돌 감지용 revision, 생성·수정 시각.
- draft JSON: 확정 대상 API·메서드·배포 URL·입력 위치·파라미터·세부값, 최초 검사 방법·관찰, 코드 위치, 메모, 수정 파일·내용, 재검증 방법·수행 일시·관찰·상태.
- 저장 후 사용자·분석 SHA·저장소·종류·확정 대상과 버전은 바꿀 수 없습니다. 새 대상은 새 기록으로 생성합니다.
- 수동 재검증 기록 완료는 서버 검증 성공이 아닙니다. 서버 SQLi 응답은 기존 UI에 별도로 유지되며 이 API로 서버 출처를 생성할 수 없습니다.

API:
- GET /api/results: 본인 목록, repository(전체 이름 일치)·kind·status 필터, 100개 단위 cursor.
- POST /api/results: 본인의 COMPLETED 분석과 SHA 확인 후 생성.
- GET /api/results/[id]: 본인 상세. 타인 기록은 404.
- PATCH /api/results/[id]: 본인 기록만 수정, immutable target 확인, revision 불일치는 409.
- 변경 요청은 동일 origin의 application/json만 허용. 서버 입력 길이·enum·확정 대상 일치·재검증 완료 조건 검증.

UI:
- 기존 SecurityTestRecord에서 DB 저장·수정 저장·저장 기록 다시 조회.
- /results 목록·필터·더 보기, /results/[id] 기존 편집 및 최초 검사/재검증 비교 UI 재사용.
- 새로고침 후 저장 기록은 /results에서 조회·수정. 미저장 초안과 서버 실행 응답은 영구 저장 대상이 아닙니다.
- 저장에는 본인이 완료한 분석이 필요합니다. 개발용 샘플/미인증 공개 분석처럼 AnalysisRun이 없는 경우 저장 거부.

마이그레이션 파일만 작성했으며 DB에는 적용하지 않았습니다. 연결 대상과 TLS를 확인하고 적용 승인을 받은 후 필요한 명령:

```sh
npm run db:deploy
npm run db:generate
```

DB 적용 전에는 신규 API 저장·조회가 동작하지 않습니다. 외부 DB 실연결 저장/재로그인 검증은 수행하지 않았습니다.

## 적용 전 SQL 정합성

- 두 외래 키의 `ON UPDATE CASCADE`를 Prisma와 SQL에 명시했습니다. 삭제 정책은 User `CASCADE`, AnalysisRun `RESTRICT`입니다.
- 복합 인덱스 이름은 `security_test_records_user_id_repository_full_name_kind_sta_idx`로 고정했습니다. Prisma `map`과 SQL이 일치하며 UTF-8 기준 63바이트 이내입니다.
- `security_test_records_manual_source_check`는 `source = 'MANUAL'`만 허용하는 의도적인 DB 방어입니다. 사용자 입력을 서버 검증 근거로 저장할 수 없게 합니다. 서버 결과를 저장하려면 별도의 근거 모델과 권한 설계를 먼저 검토해야 합니다.
- Prisma 스키마는 CHECK를 표현하지 못합니다. 이 CHECK만 의도적인 추가 제약이며, 향후 마이그레이션 생성 시 보존해야 합니다. 검사 기록의 외래 키만으로 분석 소유자·저장소·SHA 일치가 보장되지는 않으므로 기존 API 검증도 유지해야 합니다.
- `migration.test.ts`는 DB 연결 없이 Prisma가 생성한 SQL과 열·기본값·키·인덱스를 비교합니다. CHECK 외 차이를 허용하지 않고 새 테이블 관련 DDL만 있는지 검사합니다. shadow DB도 만들지 않습니다.
- 기존 테이블·컬럼 삭제 및 행 변경 SQL은 없습니다. 외래 키 생성 시 부모 테이블에 일시적인 잠금이 생길 수 있습니다.
- 이번 파일 수정은 미적용 마이그레이션에만 해당합니다. 다른 환경에서 이미 적용했다면 기존 파일을 재적용하거나 체크섬을 덮어쓰지 말고 별도 후속 마이그레이션을 검토해야 합니다.

## 연결 보안 및 개발 DB 준비

현재 환경의 점검 결과와 안전한 설정 절차는 [DB 연결 점검 문서](./database-connection-readiness.md)를 확인하세요. 개발·운영 여부 미확인과 인증서 신뢰 문제를 해결하기 전에는 현재 원격 DB에 적용하지 않습니다.
