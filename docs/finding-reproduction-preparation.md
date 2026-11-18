# 정적 탐지 후보와 사용자 배포 환경 연결

## 이번 단계의 범위

기존 분석 응답/캐시/AnalysisRun과 SQL Injection·XSS 탐지 로직을 유지한다.
선택한 후보에 기존 배포 메타데이터 API의 결과를 연결하는 표시 전용 모델과 UI만 추가한다.
이 API는 기존 requireUserId/requireRepositoryAccess 검사를 그대로 사용한다.
등록된 사이트, 확인 파일, 실습 대상 URL로 요청하지 않는다.

배포·소유권은 변경 가능한 사용자별 정보이므로 정적 분석 캐시에 넣지 않는다.
선택한 후보의 준비 영역은 연결 ID에 대해 `/api/repositories/:id/deployment`를 읽고,
응답의 연결 ID와 저장소 fullName이 현재 분석 저장소와 같은 경우만 연결한다.
공개 URL 분석은 연결 ID가 없으므로 개인 배포 정보를 붙이지 않는다.
URL 저장·소유권 확인 후에는 준비 영역의 상태 새로고침으로 다시 조회한다.
메타데이터 조회에 실패하면 상태를 미확인으로 남기며 URL 미등록으로 단정하지 않는다.

## 데이터 구조

`findingPreparation`이 다음 정보를 조합한다. 저장/실행 명령이 아닌 표시 전용 투영이다.

- staticFinding: 연결 ID, 저장소, 분석 커밋 SHA, 스캐너 버전, 후보 ID·유형·파일·줄,
  기존 탐지기가 제공한 입력 근거와 위험 지점. SQL 입력 근거는 기존 추적기의 알려진
  입력 읽기 근거만 선별하며 파일명으로 입력 경로나 URL을 추측하지 않는다.
- deployment: 등록 URL, 소유권 상태, 확인 시각. 조회 결과가 없으면 null.
- deploymentCodeMatch: 별도 공식 Vercel 메타데이터 비교 결과 또는 null.
  연결 ID·등록 URL/버전·분석 SHA가 현재 표시와 일치할 때만 반영한다.
- explicitTarget: URL·API 경로·메서드는 null. 소스의 파일/함수/Route 메타데이터로 생성하지 않는다.
- authorization: 테스트 환경 구분·명시적 승인 근거는 null, 미확인 상태.
- executionPolicy: 별도 runner, 요청 횟수, 제한 시간, 허용 origin/path가 모두 미설정.
- practiceResult: NOT_RUN, runId/resultId는 null. 정적 결과를 재현 결과로 복사하지 않는다.

## 준비 상태

| 상태 | 필요한 근거 / 현재 처리 |
| --- | --- |
| DEPLOYMENT_MISSING | 권한 확인된 API에서 조회했으며 URL이 null일 때만 표시 |
| OWNERSHIP_UNVERIFIED | URL은 있지만 VERIFIED와 검증 시각이 함께 확인되지 않음 |
| COMMIT_UNCONFIRMED | 소유권 기록이 있어도 실제 배포와 분석 커밋의 일치 근거가 없음 |
| COMMIT_MISMATCH | 공식 배포 메타데이터의 커밋이 분석 커밋과 다름 |
| TARGET_UNCONFIRMED | 소유권과 커밋 일치를 확인했지만 명시적 실습 경로가 미확인 |
| READY | 향후 모든 서버 검증과 실행 승인이 있을 때 사용할 예약 상태. 현재 반환하지 않음 |
| RESULT_CONFIRMED | 향후 승인된 실행 기록과 결과 검토가 있을 때 사용할 예약 상태. 현재 반환하지 않음 |

조회 실패/미연결 상태는 위 상태로 오인하지 않도록 null과 metadataStatus=UNAVAILABLE로 표시한다.
명시적 경로 미확인, 준비 미완료, 결과 미확인은 별도 준비 조건에도 항상 표시한다.
canReproduce는 모든 경우 false다. XSS의 protected 항목은 취약점 후보가 아니므로
실습 준비 영역을 제공하지 않는다.

## 실제 실행 기능 전에 필요한 별도 구현

1. Vercel 사용자 인증/프로젝트 연결을 완성하고 공식 커밋 비교 근거를 서버에 저장한다.
   현재 읽기 어댑터·조회 상태·UI 범위는 deployment-commit-comparison.md를 참고한다.
2. 사용자가 소유하거나 명시적으로 승인한 비운영 테스트 환경인지 확인한다.
   소유권 토큰 확인만으로 공격 실행을 허용하지 않는다.
3. 대상 URL·API 경로·메서드·입력 위치를 명시적으로 지정하고 허용 범위를 검증한다.
4. 연결 ID·등록 URL/버전·분석 SHA·후보 ID에 결합된 승인 및 제한 정책을 발급한다.
   URL·커밋·대상 변경이나 권한 회수 시 기존 승인을 무효화한다.
5. 승인된 별도 격리 실행 환경에서 서버가 권한·소유권·커밋·범위·요청 횟수·시간을
   재검증해야 한다. 운영 환경 자동 공격은 허용하지 않는다.
6. 실습 실행/결과용 별도 데이터 모델을 마련한다. AnalysisRun.stats의 정적 탐지 요약과
   구분하여 승인·대상·실행 이력·실제 증거·검토 상태를 저장한다.

UI의 READY 문자열, 클라이언트 체크 표시, 마지막 조회 메타데이터는 실행 권한이 아니다.
이번 단계는 계획 저장 API나 공격 실행 버튼/코드/요청을 추가하지 않는다.
DB 스키마·마이그레이션·기초 /learn·/practice는 변경하지 않는다.
테스트·빌드·서버·Vercel 요청·실습 실행은 수행하지 않았다.
