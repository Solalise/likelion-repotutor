# /practice 독립 실습 대시보드 검증

검증일: 2026-11-16 (Asia/Seoul)

## 결과

기초 학습 완료·퀴즈 점수 없이 네 실습에 직접 진입한다. 로컬 서버 활성화와 실습 계정 로그인은 기존 정책대로 필요하다. 외부 프로젝트 실행 기능은 추가하지 않았다.

- `/practice`: IDOR / SQL Injection / XSS / 권한 검증 카드, 설명, 난이도, 목표, 바로 실습 링크와 `/learn/{topic}` 링크.
- 연결 상태는 기존 LocalPracticeStatus를 재사용한다. 서버 미실행·브라우저 연결 실패 시 PowerShell 실행 방법과 재확인 버튼을 보여주며 실습 링크는 계속 사용 가능하다.
- `/?lab=idor`, `/?lab=sqli`: 기존 커뮤니티 옆에 가이드 단계와 독립된 자유 요청 편집기를 추가했다. ID 또는 검색어와 취약/안전 모드만 선택해 즉시 전송할 수 있다.
- 6단계 가이드는 기본 접힘 상태이며 필요할 때 열 수 있다. 기존 관찰·힌트·코드·퀴즈·완료 판정과 커뮤니티 탐색 중 상태 보존을 유지했다. 자유 요청은 가이드 완료를 자동으로 올리지 않는다.
- `/lab/idor`의 기존 독립 학습 화면에도 자유 편집기를 제공한다.
- XSS와 권한 검증은 이미 즉시 요청이 가능해 비교 기능을 재작성하지 않았다. 원인·방어 설명만 선택형 disclosure로 감쌌다. 이 두 실습에 존재하지 않던 6단계 가이드는 추가하지 않았다.
- 입력·로그인·계정 변경 시 자유 실습 결과 초기화, 지연 응답 무시, 요청 중 중복 전송 방지, 5초 제한, 실제 응답 기반 비교를 적용했다. 쿠키를 표시하거나 저장하지 않는다.
- `/learn`의 네 과정·24단계, 12문제와 localStorage 스키마는 이번 작업에서 변경하지 않았다.

## 검증

| 항목 | 결과 |
| --- | --- |
| 루트 TypeScript | `npm.cmd run typecheck` 통과 |
| 로컬 실습 TypeScript | `npm.cmd --prefix labs/basic-site run typecheck` 통과 |
| 프로덕션 빌드 | `npm.cmd run build` 통과 |
| ESLint | 이번 프런트엔드 변경 파일 및 `labs/basic-site` 전체 통과 |
| 프런트엔드 관련 회귀 | 6개 파일, 23개 테스트 통과 |
| 로컬 실습 회귀 | 39개 테스트 통과 |
| 실제 Chrome 대시보드 | 네 카드·목표·난이도·두 링크·연결 상태 정상 표시 |
| 실제 Chrome IDOR | 가이드 한 번도 열지 않고 A 로그인 → 102번 취약 조회 200 / 안전 조회 403 확인 |
| 실제 Chrome SQL Injection | 가이드 미시작 상태에서 조건 우회 입력 → 비공개 2개 포함 / 안전 모드 0개 확인 |
| 가이드와 독립성 | 자유 요청 후 가이드가 초기 1단계인 상태 확인. 기존 단계 전체 완료·재시도·초기화는 기존 실제 HTTP 이벤트 테스트 통과 |
| 서버 연결 실패 | health 요청 실패·잘못된 응답 테스트 및 실패 상태 UI 렌더링 테스트로 실행 안내·재시도·네 링크 유지 확인 |
| XSS / 권한 검증 | 기존 실제 HTTP·인증·취약/안전·격리 테스트 통과. 즉시 요청 폼이 선택형 안내 밖에 있고 활성 상태임을 검증 |
| 외부 대상 제한 | 자유 편집기의 외부 URL/잘못된 ID·모드 거부 테스트 통과. 기존 루프백·Origin·Host·SQLite 제한 테스트 통과 |

브라우저 검증은 기존 개발 서버 `localhost:3000`과 충돌하지 않는 임시 실습 서버 `127.0.0.1:4410`을 사용했다. 제품 카드의 기본 실습 주소는 기존 `127.0.0.1:4400`을 유지한다. 실행 중이던 사용자 실습 서버는 임의 종료하지 않았다. 기존 로컬 서버가 정적 파일을 시작 시 읽으므로 변경 반영에는 해당 서버 재시작이 필요하다.

이번에는 관련 테스트를 실행했으며 전체 저장소 테스트는 반복하지 않았다. 앞선 학습 개편에서 기록한 범위 밖 실패는 `learn-course-validation.md`를 참고한다. DOM 대역 테스트는 네이티브 브라우저 레이아웃·XSS 이벤트 실행 검증을 대체하지 않는다. 이번 브라우저 검증은 데스크톱 Chrome 기준이다.

## 수정 파일

### 플랫폼
- `src/app/practice/page.tsx`
- `src/components/ui-platform/PracticeDashboard.tsx` (추가)
- `src/components/ui-platform/practice.module.css` (추가)
- `src/components/ui-platform/PlatformViews.tsx` (PracticeUI 위임)
- `src/components/ui-platform/LocalIdorLab.tsx` (기존 연결 안내 보완)
- `src/components/ui-platform/PracticeDashboard.test.tsx` (추가)
- `src/components/ui-platform/LocalPracticeStatus.test.tsx` (추가)
- `src/components/ui-platform/LocalIdorLab.test.tsx`

### 로컬 실습 UI와 정적 파일 제공
- `labs/basic-site/src/practicePanel.ts` (추가)
- `labs/basic-site/public/practice.js` (추가)
- `labs/basic-site/public/app.js`
- `labs/basic-site/public/site.css`
- `labs/basic-site/src/guide.ts`
- `labs/basic-site/src/pages.ts`
- `labs/basic-site/src/extraLabs.ts` (페이지 설명만 변경; xssDocument 미변경)
- `labs/basic-site/src/routes.ts` (새 JS 정적 파일 제공만 추가)
- `labs/basic-site/src/server.ts` (새 JS 정적 파일 로드만 추가)
- `labs/basic-site/tests/free-practice.node.js` (추가)
- `labs/basic-site/tests/guide.node.ts`
- `labs/basic-site/tests/extra.node.ts`
- `labs/basic-site/package.json` (추가 테스트 등록)
- `labs/basic-site/README.md`
- `docs/practice-dashboard-validation.md` (이 문서)

공격·방어 API 분기, 인증, 가상 계정, 데이터, SQL 실행과 XSS 격리 정책은 변경하지 않았다. 기존 작업 변경도 보존했다.
