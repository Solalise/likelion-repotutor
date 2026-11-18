# 분석 후보 → 실습 대상 연결

## 재사용한 구조

- `RepositoryAnalysis.sqlInjection.findings` / `.xss.findings`: ID, 유형, 파일, 시작·끝 행, sink, evidence, relationship. XSS는 inputSources와 보호 처리 분류도 제공한다. SQLi의 입력 출처는 기존 FindingPreparation의 evidence 분류를 재사용한다.
- 입력 → 지역 변수 → SQL/HTML 지점의 정적 근거이며, 실행 가능성과 실제 취약점을 확정하지 않는다. 보호 처리된 XSS는 실습 대상 편집기를 표시하지 않는다.
- `entryPoints`: AST export와 함수 ID에 연결된 Next App Router 경로·메서드. 기존 추출기를 재사용하며 새 파서를 추가하지 않았다.
- 기존 `/api/repositories/[connectionId]/analyze`: 로그인, GitHub 설치·저장소 접근 권한 재검증 후 상세 결과 반환. receipt 응답도 유지한다.
- 상세 결과는 설치 namespace + 저장소 + SHA 기준 메모리 캐시(30분, 최대 8개, 메모리 한도 적용)에 있다. DB AnalysisRun은 실행 상태·SHA·통계만 저장한다. 따라서 결과 조회 버튼은 기존 API로 최신 커밋을 다시 확인하며, 캐시가 없으면 재분석한다. 과거 상세 결과를 DB에서 복원하는 기능은 아니다.
- 배포 URL·소유권·Vercel 연결·커밋 비교는 기존 인증된 deployment API와 FindingPreparation을 재사용한다. 대상 URL로 네트워크 요청을 보내지 않는다.

## 화면 사용 순서

1. `/services` 내 웹서비스에서 GitHub 저장소 선택, 배포 URL과 Vercel 연결 관리.
2. 저장소 분석 실행 또는 분석 결과 조회 버튼 선택. SQLi/XSS 후보의 코드와 근거 확인.
3. 유형과 후보 선택. 후보가 없으면 기존 빈 결과 안내 표시. 미지원·부분 수집은 안전 판정이 아니다.
4. 실습 대상 API 확인에서 경로·메서드·입력 위치·파라미터·기준 입력값 확인 및 수정.
5. 확인 체크 후 실습 준비 화면으로 이동. 대상 URL, 유형, 입력, 코드 위치, 정적/사용자 연결 상태, 소유권과 별도 승인 상태 표시.
6. 대상 수정으로 돌아가기 가능. 실제 공격 실행은 비활성화. 기존 메타데이터 새로고침과 배포 커밋 확인도 가능.

## 자동 연결 범위와 수동 입력

- 후보를 포함하는 가장 안쪽 함수가 기존 API entryPoint의 nodeId와 일치하고 진입점이 하나일 때만 App Router 경로와 메서드를 제안한다. 함수 호출 그래프로 입력 흐름을 추정하지 않는다.
- 여러 메서드·여러 진입점, 별도 helper, 클라이언트 XSS, Pages Router API 등은 수동 확인이다. 이번 MVP는 App Router Route Handler를 우선 지원한다.
- 동적 경로 템플릿은 표시하되 실제 URL로 확정하지 않는다. 사용자가 실제 경로 값을 입력해야 한다. rewrites, basePath, 실제 배포 라우팅도 직접 확인한다.
- 입력 위치, 파라미터 이름, 기준값은 추측하지 않는다. 사용자가 직접 입력한다. 경로·메서드 수정 시 사용자 지정 대상이며 코드 연결 미검증으로 표시한다.
- 대상은 등록된 HTTPS 배포 origin 내의 경로로만 구성한다. 다른 origin, 자리표시자, 쿼리/fragment, 역슬래시와 점 경로 등은 준비 화면 전환을 차단한다. 쿼리 입력값은 별도 파라미터 필드로 지정한다.
- 초안은 React 상태에만 존재한다. 새로고침·후보/연결 변경 시 초기화하며 DB 마이그레이션·인증 구조 변경은 없다.

## 다음 SQLi 편집기 단계

화면 초안과 실행 승인을 분리해야 한다. 서버에서 사용자·저장소 연결·분석 SHA·finding ID·배포 버전·정규화된 대상 URL/메서드에 묶인 승인 레코드를 검증해야 한다. 격리 환경의 별도 승인, origin/path/method 허용 목록, 요청 수·시간 제한, redirect/SSRF 방어와 실행 시점 권한·소유권·배포 커밋 재검증이 필요하다. 소유권이나 화면 체크박스만으로 실행을 허용하면 안 된다.

SQLi 편집기는 입력 위치별 직렬화, 파라미터/기준값과 실습값, 인증 정보의 안전한 취급, 제한된 runner, 응답 비교·결과 저장, 수정 커밋 재분석과 재검증을 추가해야 한다. 실습 결과는 AnalysisRun 통계와 구분한다. 현재 UI에는 실행 API나 공격 payload 전송 경로가 없다.

## 검증

- `npx.cmd vitest run src/lib/security-lab/practiceTarget.test.tsx`: 관련 테스트 2개 통과.
- `npx.cmd tsc --noEmit --incremental false`: 기존 `src/lib/github/repositoryMetadataAccess.test.ts` 29·45행의 TS2554 두 건으로 실패. 이번 변경 파일의 타입 오류는 보고되지 않았다.
- 빌드, ESLint, 전체 테스트, Git commit/push, DB 마이그레이션은 실행하지 않았다.
- 로그인된 브라우저에서의 실제 화면 동작 확인은 수행하지 않았다. UI 초기 상태는 서버 렌더링 검사로 확인했다.
