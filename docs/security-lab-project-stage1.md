# GitHub 프로젝트 IDOR 실습 준비 — 1단계

## 실행

```powershell
npm.cmd run dev -- --hostname 127.0.0.1 --port 3100
```

`http://127.0.0.1:3100/security-lab/project`에서 시작한다.

1. 기존 RepoTutor GitHub 로그인 후 페이지로 돌아온다.
2. 기존 GitHub App에서 연결한 저장소를 선택한다.
3. 주소에 `?connectionId=...`가 표시되고 접근권한 확인이 완료되는지 확인한다.
4. `/api/orders/{resourceId}` 또는 `/api/orders?orderId={resourceId}`를 입력한다.
5. 서로 다른 A/B 테스트 리소스 ID를 입력한다.
6. A→A, B→B, A→B의 GET 요청 계획을 확인한다. 실제 전송 버튼은 없다.
7. 새로고침하면 저장소 선택은 URL에서 복원하고 권한을 다시 확인한다. API 경로·리소스 ID는 저장하지 않으므로 예시값으로 초기화된다.
8. 상단 또는 하단 링크로 기존 `/security-lab` 예제에 돌아갈 수 있다.

## 경계

- 목록: 기존 `GET /api/github/repositories` 그대로 사용.
- 선택 확인: 신규 `GET /api/security-lab/repositories/[connectionId]`. 기존 `requireUserId`, `requireRepositoryAccess`를 사용한다. 사용자별 연결·설치·저장소·GitHub Contents 권한을 재검증하고 이름과 기본 브랜치만 반환한다.
- 미로그인 401, 다른 사용자의 연결 ID 404, 회수된 GitHub 권한 403, 검증 불가능한 GitHub 상태 503. 응답은 private/no-store.
- URL에는 connectionId만 기록한다. 중복·잘못된 ID는 거부한다.
- GET 상대 경로 템플릿의 `{resourceId}`를 정확히 한 번 요구한다. 외부 URL, 프로토콜 상대 URL, 역슬래시, 공백, fragment, 퍼센트 인코딩 및 dot-segment를 거부한다.
- 토큰·쿠키 입력, 대상 서버 URL, 프록시, 로컬 실행기, 소스 다운로드·분석·수정, 실제 검증 요청 및 판정, DB 스키마 변경은 없다.
- 기존 인증·저장소 분석·AI·그래프 및 IDOR 예제 파일은 이번 단계에서 변경하지 않았다.

## 검증

- `npm.cmd run typecheck -- --incremental false`: 통과.
- 신규 경로 검증·권한 API·화면 상태 테스트와 기존 GitHub 권한/목록 및 IDOR 예제 테스트: 9개 파일, 112개 테스트 모두 통과. 테스트 API의 GitHub·DB 응답은 mock이며 실제 인증 세션을 생성하지 않았다.
- 실제 로컬 HTTP: 프로젝트 화면과 예제 화면 200, 미로그인 목록/선택 API 401. 예제의 취약 101/102는 200, 수정 101은 200, 수정 102는 403 확인.
- 브라우저 호스트가 연결되지 않아 실제 화면 클릭·레이아웃·새로고침 선택 유지·GitHub 로그인 후 목록 조회는 **미검증**. URL 복원과 잠금 조건은 정적 렌더링/단위 테스트로 검증했다.
- 이미 3100 포트에서 실행 중인 서버를 HTTP 확인에 사용했으며 해당 서버를 종료하지 않았다.
