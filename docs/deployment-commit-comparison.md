# 분석 커밋과 Vercel 배포 커밋 비교

## 현재 동작

기존 FindingPreparation의 배포 연결 정보 조회를 유지하고 별도 `배포 커밋 확인` 버튼을 추가한다.
버튼을 눌렀을 때만 서버에서 공식 Vercel API를 읽는다. 배포 사이트에는 요청하지 않는다.
Auth.js 로그인 공급자는 GitHub로 유지한다. 저장소 상세 화면에서 별도의 Vercel 개인 토큰을
연결하고 팀/프로젝트를 명시적으로 선택할 수 있다. 인증이 없으면 UNAVAILABLE로 처리하며
Vercel API 요청도 하지 않는다. 가짜 SHA나 인증 레코드를 넣어 우회하지 않는다.

## 서버 검증 경로

`POST /api/repositories/:connectionId/deployment/commit`은 analysisCommitSha 하나만 받는다.

1. 기존 세션·GitHub 저장소 접근 검사와 동일 origin 검사를 수행한다.
2. 사용자·저장소·완료 상태·CONNECTED_REPOSITORY·정확한 SHA에 해당하는 AnalysisRun을 확인한다.
   입력 SHA는 이력 검색 키일 뿐이다. 기록이 없으면 비교를 진행하지 않는다.
3. 등록 URL과 버전은 DB에서 읽는다. 사용자 요청의 URL·배포 SHA·배포 메타데이터는 받지 않는다.
4. 해당 사용자에게 연결된 유일한 Account(provider=vercel, pat/oauth/oidc)의 암호화된
   Access Token만 사용한다. 전역 PAT, 평문 토큰, ID Token, GitHub 토큰은 사용하지 않는다.
5. 공식 `/v2/user` 응답의 사용자 ID와 providerAccountId를 비교한다.
6. 명시적으로 저장한 개인 계정/팀 범위의 프로젝트 권한과 GitHub 저장소 ID를 검사한다.
   해당 범위에서 등록 호스트의 `/v4/aliases/:host`를 조회하고 선택 프로젝트와 비교한다.
   단일 활성 배포 연결만 허용하며 리다이렉트/복합 라우팅은 거부한다.
7. 같은 토큰으로 `/v9/projects/:id` 읽기에 성공하고 accountId와 GitHub 저장소 ID가
   일치하는 경우에만 `/v13/deployments/:id?withGitRepoInfo=true`를 조회한다.
8. READY인 Git 기반 배포의 gitSource.type=github, repoId, 완전한 40자리 sha를 요구한다.
   사용자 지정 meta.githubCommitSha나 CLI 업로드의 SHA를 대신 사용하지 않는다.
9. alias가 같은 프로젝트/배포를 계속 가리키는지 다시 확인한다. GitHub 접근 권한과
   Vercel 계정 존재 및 등록 URL/버전도 다시 확인하고 결과를 반환한다.

요청은 `https://api.vercel.com`으로만 전송하며 redirect=error, no-store,
조회 전체 15초와 응답당 1MB 제한을 적용한다. 토큰·원본 응답·프로젝트 환경 변수는
로그나 클라이언트 결과에 포함하지 않는다. 팀/프로젝트/계정 변경에 대한 실행 승인은 발급하지 않는다.

## 상태와 준비 단계

- UNAVAILABLE: 인증/URL/완료된 분석 이력/필수 Git 근거가 없거나 지원 범위를 벗어남.
- LOOKUP_FAILED: 인증 거부, API 오류, 시간 초과, 조회 중 연결 변경 등.
- MISMATCH: 권한 확인된 공식 근거의 저장소는 같지만 전체 커밋 SHA가 다름.
- MATCH: 같은 GitHub 저장소 ID와 공식 배포 메타데이터의 전체 SHA가 분석 SHA와 같음.

대소문자를 정규화하되 짧은 SHA나 브랜치 이름으로 비교하지 않는다.
조회 결과는 연결 ID·저장소·등록 URL·배포 버전·분석 SHA에 결합한다.
정보 새로고침/커밋 변경 시 기존 비교를 지우며, 조회 실패 때 이전 MATCH를 유지하지 않는다.
일치는 조회 시점의 공식 Git 메타데이터 기준이며 배포 산출물 바이트 일치 증명은 아니다.

기존 준비 조건에서는 소유권과 커밋을 따로 판단한다. 양쪽 모두 확인되어도 다음 상태는
TARGET_UNCONFIRMED이며 READY나 실제 실행 허용으로 바뀌지 않는다.
불일치는 재분석/재배포 안내와 함께 차단한다. 실습 승인/요청 제한/격리 실행 환경은 별도다.

## 미구현 및 운영 전 확인

- 개인 토큰 연결·교체·해제와 팀/프로젝트 선택을 지원한다. OAuth/OIDC 로그인·자동 토큰
  갱신은 미구현이다. 토큰 만료/취소 시 새 토큰으로 교체해야 한다.
- 연결 범위와 직접 확인 절차는 vercel-account-connection.md를 참고한다.
- alias API에 없는 고유 배포 URL, CLI 업로드, 수동 SHA, 복합/점진 라우팅은 검증하지 않는다.
- 비교 이력을 DB에 영구 저장하지 않는다. 현재 결과는 no-store 응답/페이지 메모리에만 있다.
  실행 기능 전에는 권한·alias·URL/커밋을 다시 확인하고 근거를 승인 기록에 결합해야 한다.
- 기존 DB 마이그레이션 미적용 상태라면 해당 선행 작업이 여전히 필요하다.
  이번 변경은 새 DB 스키마/마이그레이션을 추가하지 않는다.
- 테스트·빌드·서버 실행·실제 계정 API 조회는 수행하지 않았다.

공식 API 계약:
- https://vercel.com/docs/rest-api/deployments/get-a-deployment-by-id-or-url
- https://vercel.com/docs/rest-api/aliases/get-an-alias
- https://vercel.com/docs/rest-api/projects/find-a-project-by-id-or-name
- https://vercel.com/docs/rest-api/user/get-the-user
- https://vercel.com/docs/sign-in-with-vercel/tokens
