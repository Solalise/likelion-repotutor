# VulnLab /learn 개편 검증

검증일: 2026-11-16 (Asia/Seoul)

## 구현 범위

- `/learn`: 네 개 과정 카드, 전체 24단계 진행률, 과정별 이어서 학습.
- `/learn/idor`, `/learn/sqli`, `/learn/xss`, `/learn/authz`: 선택한 과정의 한 단계만 표시. 알 수 없는 과정은 404.
- 과정마다 개념·원리·HTTP 시나리오·취약/안전 코드·방어·퀴즈 6단계. 총 12문제와 정답/오답 해설.
- 단계 완료는 명시적 버튼으로 표시. 퀴즈 단계는 3/3 정답 후 완료 가능. 6단계 완료 시 해당 로컬 실습 링크 표시.
- `vulnlab:learn:{topic}`별 localStorage 저장. 현재 단계, 완료 단계, 선택 답안, 채점 여부 유지. `PROGRESS_VERSION=1` 불일치 또는 손상 데이터는 초기화. 콘텐츠/퀴즈 의미가 변경되면 버전을 올려 이전 완료 결과를 무효화할 수 있음.
- 저장소 접근 실패 시 화면 내 학습은 유지하고 저장 불가 안내. 저장값을 HTML로 실행하지 않음.
- 기존 실습 서버의 `/learn#topic` 복귀 URL은 대시보드에서 새 독립 경로로 이동. 실습 서버 API·인증·데이터·공격·방어 코드는 변경하지 않음.
- 상세 경로에서도 기존 플랫폼의 학습 메뉴가 활성화되도록 PlatformFrame의 경로 매칭 한 줄 보완.

## 검증 결과

| 항목 | 결과 |
| --- | --- |
| TypeScript | `npm.cmd run typecheck` 통과, 최종 프로덕션 빌드에서도 TypeScript 검사 |
| 프로덕션 빌드 | `npm.cmd run build` 통과. 샌드박스 하위 프로세스 EPERM 발생 후 승인된 실행으로 재검증 |
| 변경 범위 ESLint | 학습 UI·콘텐츠·저장·라우트·PlatformFrame 오류/경고 없음 |
| 학습 및 실습 연결 관련 테스트 | 4개 파일, 20개 테스트 통과 |
| 로컬 실습 서버 기존 테스트 | `npm.cmd --prefix labs/basic-site test`: 37/37 통과 |
| 전체 기존 테스트 | 716 통과, 6 실패, 5 건너뜀 (UI 테스트 3개 추가 이전 전체 실행) |
| 직접 URL 접근 | `/learn` 및 4개 상세 경로 HTTP 200, `/learn/unknown` 404, `/practice` 200 |
| 실제 Chrome | 4개 카드 및 IDOR 독립 진입, 6단계 이동, 흐름도, 코드 구문/취약 줄 강조 확인 |
| 퀴즈 | IDOR 2/3 오답 해설 → 답안 수정 → 3/3 채점 → 단계 완료 확인 |
| 저장 복원 | Chrome 새로고침 후 현재 6단계, 2개 완료 단계, 선택 답안, 2/3 결과와 해설 복원 확인 |
| 완료/실습 연결 | IDOR 6/6 완료·100% 표시 및 기존 `http://127.0.0.1:4400/?lab=idor` 링크 확인. 나머지 3개 링크는 렌더링 테스트로 검증 |
| 반응형 | Chrome 확대를 사용한 좁은 CSS 뷰포트에서 본문 1열·단계 메뉴 상단 2열 확인. 실제 휴대기기 테스트는 미실시 |

테스트는 4개 과정의 24단계 렌더링, 12문제 선택지와 해설, 코드 예시의 TypeScript 구문 유효성, 저장 데이터 버전/손상/범위 처리, 과정별 저장 키 분리, 완료 후 실습 URL을 검증한다. SSR 렌더링 테스트는 단계별 저장 상태를 주입하며 실제 브라우저 상호작용 검증을 대체하지 않는다.

## 전체 테스트에서 발견한 범위 밖 실패

다음 6개는 이번 작업에서 변경하지 않은 모듈에 대한 기존 테스트이며, 요청 범위에 따라 수정하지 않았다.

- `src/components/auth/AuthButtons.test.tsx`: 2개. 기존 테스트가 서버 action 함수를 기대하지만 현재 버튼 구조와 다름.
- `src/components/security/LabSession.test.tsx`: 1개. 기존 메뉴 순서 기대값과 현재 securityNavigation 순서 불일치.
- `src/lib/github/repositoryMetadataAccess.test.ts`: 2개. 대시보드/저장소 페이지의 현재 구현과 기존 비동기 접근 검사 기대값 불일치.
- `src/lib/learning/learningRoles.regression.test.ts`: 1개. 현재 홈페이지에서 테스트가 찾는 HomePage 노드가 없음.

## 이번 작업 파일

- src/app/learn/page.tsx
- src/app/learn/[topic]/page.tsx
- src/components/learning/Learning.tsx
- src/components/learning/learning.module.css
- src/components/learning/Learning.test.tsx
- src/lib/learn/courses.ts
- src/lib/learn/progress.ts
- src/lib/learn/learning.test.ts
- src/components/ui-platform/PlatformFrame.tsx
- docs/learn-course-validation.md

착수 전부터 존재하던 labs/basic-site 및 PlatformViews 등의 작업 변경은 보존했다. 빌드가 생성한 next-env.d.ts 및 tsconfig.tsbuildinfo 변경은 이번 변경 목록에서 제외했다.
