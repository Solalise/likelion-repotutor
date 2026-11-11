# Security Lab 2단계 구현·검증 기록

## 구현

`/security-lab/project`를 GitHub 선택과 독립적인 로컬 웹서비스 IDOR 검증 화면으로 확장했다. 기존 GitHub 연결·connectionId URL 복원·접근권한 확인은 선택 영역으로 유지했다. 기존 `/security-lab` 가상 실습과 운영 인증·분석·AI·그래프·DB 스키마는 변경하지 않았다.

실행 및 시연 절차와 상세 프로토콜 경계는 [실행기 README](../tools/security-lab-runner/README.md)를 참고한다.

## 이번 단계의 파일

신규:

- `tools/security-lab-runner/server.mjs`: 별도 루프백 통신·관리 서버, 페어링·세션·계획 승인
- `tools/security-lab-runner/core.mjs`: 경로 검증·제한된 GET 전송·신원과 소유권 비교·4가지 판정
- `tools/security-lab-runner/admin.html`: 대상 포트·Origin·토큰·응답 필드 입력과 최종 로컬 승인
- `tools/security-lab-runner/demo-server.mjs`: 독립적인 가상 신원·취약/수정 API
- `tools/security-lab-runner/runner-check.mjs`: 실제 루프백 HTTP 기반 보안·기능 테스트
- `tools/security-lab-runner/README.md`: 실행·설정·제한 안내
- `src/app/security-lab/project/RunnerLab.tsx`: 페어링·실행·정제 근거·학습·재검증 화면
- `src/app/security-lab/project/RunnerLab.test.tsx`: 실행 잠금과 4가지 결과 표시 테스트
- `src/lib/security-lab/runnerTypes.ts`: 브라우저 통신·판정 타입
- `docs/security-lab-project-stage2.md`: 이 문서

수정:

- `src/app/security-lab/project/ProjectLab.tsx`: GitHub 선택화, 로컬 실행 UI 연결, 비로그인 조건 입력
- `src/app/security-lab/project/ProjectLab.test.tsx`: 변경된 로컬·선택적 GitHub 흐름 검증
- `src/app/security-lab/project/RequestPreview.tsx`: 실제 실행과 미리보기 구분, 신원 확인 추가 안내
- `src/app/security-lab/project/project.module.css`: 실행 계획·결과 카드와 선택적 GitHub 영역 스타일
- `src/lib/security-lab/projectPlan.ts`: 미리보기 전용에서 실행 계획 입력으로 역할 설명 갱신 (기존 입력 제한 유지)

## 실제 HTTP 검증

`node --test --test-isolation=none tools/security-lab-runner/runner-check.mjs`: **18개 통과**. 매 테스트가 실제 127.0.0.1 HTTP 서버·실행기를 띄우며 대상 요청은 mock이 아니다. 테스트 종료 시 생성한 서버를 종료한다.

| 조건 | 실제 관찰 | 판정 |
|---|---|---|
| 취약 API | A /me→200/A, B /me→200/B, A→101 200/A, B→102 200/B, A→102 200/B와 동일 보호 필드 지문 | IDOR 재현 확인 |
| 수정 API | 위 정상 기준 유지, A→102 403, 설정한 리소스·소유자·보호 필드 없음 | 접근 차단 관찰 |
| 오류 상태에 데이터 포함 | A→B 403이지만 B 리소스·소유자·보호 데이터 노출 | IDOR 재현 확인 |
| 비정형 오류 데이터 | A→B 403에 해석 불가능한 객체 형태 데이터 존재 | 취약점 의심, 접근 차단으로 오판하지 않음 |
| 보호 데이터 불일치 | A→B 200이지만 B의 보호 필드 지문과 다름 | 취약점 의심 |
| 인증 실패 | 신원 확인 2회 후 중단, 리소스 요청 없음 | 판정 불가 |
| 동일한 관찰 신원 | 서로 다른 토큰이어도 /me 결과가 동일 사용자 | 판정 불가 |
| 소유자 필드 없음 / 정책 불명확 | 정상 응답의 근거 또는 소유자 전용 정책 부족 | 판정 불가 |
| 승인 전 / 바뀐 계획 / 재사용 승인 | 대상 요청 0회 또는 재실행 거부 | 409 |
| 외부 URL·미등록 포트·메서드 입력 | 계획 입력 단계에서 차단, 대상 요청 없음 | 400 |
| 잘못된 Origin·Host·관리 권한 | 실제 요청 거부 | 403 |
| 만료·사용한 페어링 / 만료 세션 | 실제 요청 거부 | 401 또는 설정 폐기 후 403 |
| 페어링 반복·빠른 재실행 | 요청 제한 | 429 |
| 리다이렉트 | 302 기록, Location 추적 안 함 | 판정 불가 |
| 응답 지연·과도한 본문 | 요청 중단, 재시도 없음 | 판정 불가 근거 |

새 계획을 등록하기 전까지 직전 결과를 보관해 비교할 수 있다. 대상·경로·리소스·사용자 ID·응답 필드 설정으로 계산한 비밀정보 없는 비교 키가 다르면 참고용 비교로 명시한다. 같은 키로 재검증하는 경우도 테스트했다. GitHub 소스와 실행 중인 로컬 코드가 같은지 자동 증명하지 않는다.

## 기존 기능·타입 검증

- `npm.cmd run typecheck -- --incremental false`: 통과
- 실행기 `.mjs` 파일 `node --check`: 통과
- `npm.cmd test -- --maxWorkers=1 --testTimeout=15000`: **52개 파일 / 692개 테스트 통과, 4개 파일 / 5개 테스트 생략**. 기존 GitHub 권한·분석·그래프·AI·예제 실습 회귀 테스트 포함. 외부 서비스가 필요한 생략 테스트를 실제 GitHub 로그인·외부 AI 호출 검증으로 간주하지 않는다.
- 실제 실행 중인 로컬 RepoTutor HTTP에서 프로젝트 화면과 기존 실습 화면 200, 미로그인 저장소 목록 API 401 확인.
- 기존 IDOR 예제 API: 취약 102→200/B, 수정 102→403 확인. 기존 101 정상 동작은 예제 자동 테스트 포함.
- 기존 3100 서버를 재사용했으며 다른 프로세스를 종료하지 않았다.

## 브라우저 검증 한계

**실제 브라우저 페어링·로컬 승인·실행 버튼·결과 표시·새로고침·레이아웃은 미검증이다.**

브라우저 연결 호스트가 사용할 수 없는 상태였으며 네이티브 Chrome 대체 경로도 시도했다. Computer Use 도구가 현재 브라우저 URL을 충분한 신뢰도로 확인할 수 없어 정책을 집행할 수 없다는 이유로 자동화를 중단했다. 이후 브라우저 입력은 수행하지 않았다. 화면은 React 정적 렌더링 테스트와 Next 실제 HTTP 렌더링으로만 확인했다. CORS는 실제 HTTP OPTIONS/POST로 검증했지만 브라우저의 로컬 네트워크 권한 처리까지 검증한 것은 아니다.

## 미완료·지원 한계

- 핵심 로컬 실행·승인·인증·판정은 구현 및 실제 HTTP 검증 완료. 사용자 브라우저에서 위 시연 절차 확인이 남았다.
- Bearer·GET·JSON 단일 리소스·단순 JSON Pointer만 지원. 쿠키/MFA·원격 사이트·Express 자동 탐색·XSS·SQL Injection·관리자 권한 검사는 미구현/준비 중이다.
- 선택한 보호 필드 밖의 정보 유출, 공유/조직 정책, 실제 운영 DB와의 분리는 자동 증명하지 않는다. 사용자에게 테스트 소유권과 테스트 데이터 사용을 명시적으로 확인받는다.
