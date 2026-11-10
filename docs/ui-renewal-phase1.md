# RepoTutor 1차 UI 개편 결과

작성일: 2026-11-09 (Asia/Seoul)

## 1. 구조 확인 및 변경 파일

기존 프로젝트는 Next.js App Router, React, Tailwind/CSS, Prisma, NextAuth 기반이다.
공개 소개 `/`, 로그인 `/login`, 로그인 후 홈 `/dashboard`, 연결 관리 `/repositories`, 코드 탐색 `/repository` 경로를 유지했다.
기존 `AppHeader`는 공개 소개와 로그인에서 그대로 사용하고, 앱 화면에만 새로운 공통 셸을 적용했다.

| 파일 | 변경 |
| --- | --- |
| src/components/layout/AppShell.tsx | 추가: 인증 정보와 GitHub 로그인명을 읽는 서버 공통 셸 |
| src/components/layout/Sidebar.tsx | 추가: 메뉴 선택 상태, 준비 중 메뉴, 계정 정보 및 계정 액션 |
| src/app/dashboard/page.tsx | 수정: 실제 LearningRecord 기반 홈 |
| src/app/repositories/page.tsx | 수정: 연결·설치·현재 사용자 분석 기록 조회, 동기화 결과 안내 |
| src/components/repositories/RepositoryList.tsx | 추가: 검색, 필터, 정렬, 상태, 관리 메뉴, 빈 상태 |
| src/components/repositories/RepositoryList.test.tsx | 추가: 5개 UI 동작 및 상태 테스트 |
| src/app/repository/page.tsx | 수정: 공통 셸 및 학습 위치 쿼리 전달 |
| src/components/repository/RepositoryWorkspace.tsx | 수정: 기존 분석 결과에서 학습 선택 복원, 변경된 코드 안내, 연결 분석 로딩 문구 |
| src/components/auth/AuthButtons.tsx | 수정: 기본 로그인 후 이동 경로를 홈으로 변경 |
| src/app/login/page.tsx | 수정: 이미 로그인한 사용자를 홈으로 이동 |
| src/app/globals.css | 수정: 앱 셸 내부에 한정한 색상, 카드, 반응형 및 접근성 스타일 |
| docs/ui-renewal-phase1.md | 추가: 이 보고서 |

패키지, DB 스키마, 인증 설정, API 엔드포인트, 분석 알고리즘 파일은 변경하지 않았다.
빌드·타입 검사로 변경된 next-env.d.ts와 tsconfig.tsbuildinfo는 원래 상태로 복구했다.

## 2. 화면별 변경

### 공통 화면

- 차콜 사이드바, 크림 배경, 올리브 액션, 밝은 카드와 얇은 테두리 적용.
- 홈 / 내 저장소 / 코드 탐색의 선택 상태와 실제 경로 이동 제공.
- 코드 피드백 / 문제 풀이 / Teach-back / 학습 기록은 준비 중으로 표시하고 링크 미제공.
- 실제 계정 이름, GitHub 로그인명 및 프로필 링크, 기존 로그아웃 액션 제공.
- 작은 화면에서 내비게이션을 상단 그리드로 전환하고 카드를 한 열로 표시.
- 본문 건너뛰기, 포커스 표시, 폼 레이블, 상태 안내, 모션 감소 설정 지원.

### 홈

- 기존 샘플 통계 대시보드를 환영 문구, 이어서 학습하기, 새 저장소 연결하기, 최근 학습 활동으로 교체.
- 실제 사용자의 LearningRecord를 updatedAt 역순으로 최대 6개 조회.
- AI 설명 기록만 학습 활동으로 안내하며 코드 열람을 별도 기록처럼 생성하지 않음.
- 기록에 저장된 기능/함수 ID를 기존 코드 탐색 화면으로 전달하여 선택 복원.
- 접근 가능한 활성 연결이 없으면 연결 확인 안내. 코드 변경으로 ID가 사라지면 재선택 안내.
- 학습 기록이 없는 경우 첫 학습 안내 제공. 더미 기록·진행률·최근 저장소 목록·중복 빠른 실행 카드 없음.

### 내 저장소

- 실제 설치 정보, 일시 중지 상태, 마지막 동기화 시각 표시.
- App 설치 및 저장소 승인과 OAuth 로그인의 차이 안내.
- 기존 연결 시작 경로와 동기화 서버 액션 사용. 동기화 실패 시 권한 확인 및 재시도 안내.
- 소유자/이름 검색, 분석 상태 필터, 이름순/최근 분석순 정렬.
- 이름, 소유자, 공개 범위, 기본 브랜치, 최신 사용자 분석 상태 및 분석 종료 시각 표시.
- 분석 중에는 로딩·버튼 제한과 10초 간격 상태 갱신 제공.
- 실패 시 재시도 버튼 제공. 기존 코드 탐색 화면에서 분석 API의 상세 오류 확인 가능.
- 중지된 설치에는 분석 버튼 미제공. 관리 메뉴에서 GitHub 저장소와 기존 App 권한 설정 진입.
- 연결 없음과 검색 결과 없음 상태를 구분.

### 코드 탐색

- 기존 RepositoryWorkspace, 그래프, 파일 트리, 노드 설명, AI 패널을 그대로 사용.
- 셸에 맞춘 너비 및 작은 화면 배치만 조정.
- 홈에서 전달받은 기존 기능/함수 선택과 그 기능 범위를 복원.
- AST / DFS / 기능 분류 / 그래프 생성 / AI 설명 로직은 수정하지 않음.

## 3. 기존 기능 재사용

- NextAuth auth/signIn/signOut 및 서버 액션.
- `/api/github/installations/start`, 기존 OAuth/App 콜백.
- syncAllUserInstallations 및 GitHub 사용자의 설치별 저장소 동기화 로직.
- UserRepository, GitHubInstallation, AnalysisRun, LearningRecord 모델.
- `/api/repositories/[connectionId]/analyze`와 기존 캐시 및 에러·재시도 처리.
- RepositoryWorkspace 전체 분석/탐색/AI 흐름.
- 기존 lucide-react와 CSS만 사용. 라이브러리 추가 없음.

## 4. 검증

| 검증 | 결과 |
| --- | --- |
| npm.cmd run typecheck | 통과 |
| npm.cmd run lint | 통과, 오류 및 경고 없음 |
| 기존 단위/회귀 테스트 | 233개 통과 |
| 신규 UI 테스트 | 5개 통과 |
| 외부 연동 테스트 | 기존 설정에 따라 5개 건너뜀 |
| npm.cmd run build | 통과, 프로덕션 컴파일·타입 검사·페이지 생성 완료 |
| git diff --check | 통과 |

PowerShell의 npm.ps1 실행 정책 때문에 npm.cmd를 사용했다.
첫 테스트와 빌드는 샌드박스의 하위 프로세스 생성 제한(EPERM)으로 중단됐고, 제한 밖 재실행으로 통과했다.
전체 테스트 실행 시 신규 사이드바 테스트 1개가 HTML 속성 순서에 의존해 실패했다. 속성 순서와 무관한 단언으로 수정 후 해당 파일의 5개 테스트를 재실행하여 모두 통과했다. 전체 실행에서 나머지 237개 테스트는 통과했다.
실제 계정 OAuth 로그인·로그아웃, App 설치, 사설/조직 저장소 접근, 실브라우저의 로그인 후 화면 및 모바일 시각 검수는 수행하지 않았다. 빌드 성공을 이러한 E2E 검증 완료로 취급하지 않는다.

## 5. 미구현 및 추가 확인

- 코드 피드백 / 문제 풀이 / Teach-back / 학습 기록 독립 화면은 범위 밖이며 미구현.
- 최근 활동은 기존 AI 학습 기록에 한정. 단순 코드 탐색·노드 클릭 이력 저장은 새로 구현하지 않음.
- 분석 결과 보기 역시 기존 분석 API를 호출한다. 별도 영구 분석 결과 저장 화면을 만들지 않았으며 API의 캐시 정책을 그대로 사용한다.
- 프로세스 중단으로 남은 RUNNING 상태의 만료·복구 로직은 기존에 없다. 임의로 실패 처리하지 않음.
- App 권한 관리는 기존 설치 시작 흐름으로 진입한다. 앱 내부 연결 해제/삭제 기능을 추가하지 않음.
- 조직 접근은 완료로 간주하지 않는다. 기존 동기화는 `/user/installations`와 `/user/installations/{id}/repositories`를 사용하므로 조직 구성원이라는 이유로 목록을 생성하지 않는다.
- 중요: 기존 syncAllUserInstallations는 현재 응답에서 빠진 설치 자체의 과거 연결을 일괄 비활성화하는 처리가 보이지 않는다. 기존 분석 API는 사용자 소유의 active 연결과 설치 중지 여부를 DB로 검사한 뒤 installation 토큰으로 수집한다. 조직 탈퇴·사용자 권한 회수 직후의 오래된 연결에 대해 사용자 권한이 매 요청 최신으로 검증된다고 보장할 수 없다. 이 작업에서 해당 로직을 변경하지 않았으며 배포 전 실제 계정으로 검증 및 필요 시 보강해야 한다.
- 인증 정보·환경변수 값은 화면이나 보고서에 포함하지 않음.

## 6. 다음 작업 추천 순서와 파일

1. 실제 계정 기반 인증·권한 시나리오 검증: 개인 공개/비공개, 조직 관리자 승인 대기, 설치 중지/삭제, 조직 탈퇴, 저장소 승인 제거, 권한 회수. 우선 확인 파일은 src/lib/github/installations.ts, src/lib/github/api.ts, src/app/api/repositories/[connectionId]/analyze/route.ts, src/app/api/repositories/[connectionId]/learn/route.ts. 오래된 연결의 비활성화와 사용자 권한 재확인을 먼저 검토한다.
2. 데스크톱/모바일 시각 및 키보드 E2E 검수: src/components/layout/Sidebar.tsx, src/components/layout/AppShell.tsx, src/components/repositories/RepositoryList.tsx, src/app/globals.css. 장시간 RUNNING 복구는 별도 서버 정책으로 정한다.
3. 코드 탐색 화면 정보 구조 설계: src/components/repository/RepositoryWorkspace.tsx, FeaturePicker.tsx, RepositoryTree.tsx, LearningInspector.tsx, NodeInspector.tsx, RepositoryOverviewInspector.tsx. 현재 데이터가 보장하는 관계와 추정 관계의 표시 규칙부터 합의한다.
4. 다음 차수 그래프 UI 개편: src/components/flow/CodeFlow.tsx, LearningFlow.tsx, RepositoryOverviewFlow.tsx와 해당 카드 컴포넌트. 현재 검증된 분석 결과를 재사용하는 표시 계층부터 수정하고, 전체 기능 흐름 분석은 별도 요구사항·회귀 테스트와 함께 진행한다.
5. 후속 학습 기능은 별도 기획 후 구현한다. 준비 중 메뉴를 실제 화면으로 전환하는 작업은 이번 범위에 포함하지 않는다.
