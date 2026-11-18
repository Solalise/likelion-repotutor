# Vercel 개인 Access Token 연결

## 저장과 인증

GitHub OAuth/로그인, GitHub App 및 저장소 접근 검사는 변경하지 않는다.
기존 Account 모델에 현재 로그인 사용자 ID와 `provider=vercel`, `type=pat`, 공식 API가 반환한
providerAccountId를 저장한다. 토큰은 기존 AES-256-GCM 암호화 함수와
TOKEN_ENCRYPTION_KEY(base64 32바이트)를 재사용해 `access_token`에 암호문으로만 저장한다.
유효한 암호화 키가 없으면 입력/저장을 차단한다. 이미 GitHub 토큰을 암호화한 키를
임의로 교체하면 기존 암호문을 읽지 못하므로 동일한 키를 유지해야 한다.

토큰 원문은 검증 요청의 일시적인 메모리/HTTPS 요청에만 사용한다. 제출 직후 password 입력을
비우며 React 상태, localStorage/sessionStorage, 응답, URL, 앱 로그에 저장/출력하지 않는다.
서버는 공식 `/v2/user` 응답으로 계정을 검증하고 ID·이름·사용자명만 클라이언트에 전달한다.
계정 연결은 앱 내부의 별도 자격 증명이며 Vercel 로그인 공급자를 활성화하지 않는다.

사용자당 Vercel 계정 하나를 지원한다. 기존 Account 고유 제약에 따라 같은 Vercel 계정을
서로 다른 VulnLab 로그인 사용자에게 중복 연결하지 않는다.

## API와 접근 범위

`/api/repositories/:connectionId/deployment/vercel`:

- GET: 계정 확인 상태, 저장된 팀/프로젝트, 최근 완료된 분석 SHA. `view=teams`와
  `view=projects&teamId=...`는 각각 페이지 단위 목록을 반환한다.
- POST: 개인 토큰 하나를 검증·암호화하고 연결하거나 교체한다.
- PATCH: 선택한 teamId(null=개인 계정)와 projectId를 검증하고 저장한다.
- DELETE: 현재 사용자의 앱 내부 Vercel 연결을 해제한다. Vercel 서버의 토큰 자체를 폐기하지는 않는다.

모든 경로에 기존 GitHub 세션/저장소 접근 검사를 적용한다. 암호화 설정 필요 응답은
인증된 사용자에게 설정 상태만 반환하며 저장소/계정 정보를 포함하지 않는다.
변경 요청은 동일 origin으로 제한하고 JSON 본문 최대 8KB를 적용한다.
서버 오류에는 원본 요청·토큰·Vercel 응답을 포함하지 않는다.

기존 공식 API 요청기를 재사용한다. 대상은 고정된 api.vercel.com이며 redirect 금지,
요청 시간·응답 크기 제한 및 no-store 정책을 유지한다.

팀 목록은 `/v2/teams`를 사용한다. 팀 선택 시 `/v2/teams/:id`의 승인된 멤버십과
limited=false를 확인한다. 개인 계정과 팀을 구분하고 묵시적으로 기본 팀을 선택하지 않는다.
프로젝트 목록은 `/v10/projects`, 선택 시 `/v9/projects/:id`로 권한을 재확인한다.
accountId가 선택한 계정/팀에 속하고 `link.type=github`, `link.repoId`가 GitHub 연결의
실제 저장소 ID와 같아야 저장한다. 이름 유사성은 판단 근거가 아니다.
불일치/연결 정보 없는 프로젝트는 선택할 수 없다. 팀/프로젝트 목록은 커서 기반 더 보기를 제공한다.

## 무효화와 커밋 비교

토큰 연결·교체·해제는 해당 사용자의 모든 저장소에서 Vercel 선택·소유권 상태·확인 토큰을
무효화하고 deploymentVersion을 증가시킨다. 등록 URL, GitHub 인증과 코드 분석 이력은 유지한다.
프로젝트 선택 변경도 해당 저장소의 이전 검증을 무효화하므로 소유권을 다시 확인해야 한다.
사용자 행 잠금과 DB 트랜잭션으로 자격 증명/연결 갱신을 직렬화하며 다른 사용자의 행은 변경하지 않는다.

기존 배포 커밋 API가 저장한 계정 ID·팀 ID·프로젝트 ID를 재사용한다. 조회할 때마다 토큰 신원,
팀 멤버십, 프로젝트 접근권한, GitHub 저장소 ID, 도메인 alias의 선택 프로젝트를 검사한다.
조회 중 교체/해제/프로젝트 변경은 자격 증명 fingerprint와 deploymentVersion으로 거부한다.
페이지와 다른 탭의 이전 커밋 비교는 비밀 정보 없는 이벤트로 폐기한다. BroadcastChannel을
사용할 수 없는 브라우저는 다른 탭을 수동 새로고침해야 한다. 이 UI 상태는 실행 권한이 아니다.

## DB와 환경변수

- 기존 필수 설정: DATABASE_URL, 마이그레이션용 DIRECT_DATABASE_URL(해당 환경),
  기존 GitHub/Auth.js 환경변수와 TOKEN_ENCRYPTION_KEY.
- VERCEL_TOKEN 또는 Vercel OAuth Client ID/Secret은 필요하지 않다. 개인 토큰은 사용자별로 DB에 저장한다.
- 신규 `20261117000300_vercel_project_connection`은 UserRepository에 nullable
  vercel_account_id/vercel_team_id/vercel_project_id와 Account 외래 키를 추가한다.
  기존 행은 null로 남으며 기존 데이터 삭제/초기화 구문은 없다.
- 선행 배포/소유권 마이그레이션도 필요하다. 대상 DB·백업/복구 수단을 확인한 뒤 적용한다:

```powershell
npm.cmd run db:deploy
npm.cmd run db:generate
```

위 명령은 이번 작업에서 실행하지 않았다.

## 직접 확인 절차

1. 대상 DB와 백업을 확인하고 마이그레이션 적용/Client 생성을 완료한다. 기존 암호화 키를 유지한다.
2. 실행 중인 앱에서 GitHub로 로그인하고 내 저장소의 상세 화면을 연다.
3. Vercel 배포 연결 영역에서 본인 개인 토큰을 입력한다. 제출 직후 입력창이 비고 공식 계정 ID가 표시되는지 확인한다.
4. 접근 가능한 팀 조회 → 개인 계정/팀 선택 → 프로젝트 조회 → 저장소 ID가 일치하는 프로젝트 저장.
5. 등록한 URL의 확인 파일 방식으로 사이트 소유권을 다시 확인한다.
6. 최근 완료된 분석 SHA를 확인하고 배포 커밋 확인을 누른다. 선택한 후보의 준비 영역에서도 해당 분석 SHA로 비교할 수 있다.
7. 불일치/권한 부족/조회 실패 이유를 확인한다. MATCH여도 실제 공격은 활성화되지 않는다.
8. 잘못된 토큰으로 교체하면 기존 연결이 유지되는지, 정상 교체/해제 시 프로젝트·검증·이전 MATCH가 무효화되는지 확인한다.
9. 다른 로그인 사용자의 연결 ID 요청은 기존 GitHub 접근 검사로 거부되어야 한다.

## 미구현·미검증

실제 토큰/API 응답/DB/브라우저 동작은 실행 검증하지 않았다. 테스트·빌드·서버 실행과
마이그레이션 실행도 하지 않았다. OAuth 연결, 자동 토큰 갱신/키 회전, Vercel 측 원격 토큰 폐기,
실제 공격 실행은 구현하지 않는다. 토큰 권한은 Vercel에서 허용된 메타데이터 조회 범위로 준비해야 한다.
개인 계정 프로젝트가 없는 Vercel 계정은 접근 가능한 팀을 선택해야 한다.
기존 커밋 비교의 단일 Git 배포/alias 제한과 조회 시점 메타데이터 기준 비교라는 한계는 유지한다.

공식 API 참고:
- https://vercel.com/docs/rest-api/user/get-the-user
- https://vercel.com/docs/rest-api/teams/list-all-teams
- https://vercel.com/docs/rest-api/teams/get-a-team
- https://vercel.com/docs/rest-api/projects/retrieve-a-list-of-projects
