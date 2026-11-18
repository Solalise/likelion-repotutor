# SQL Injection 1차 정적 분석

## 기존 경로 재사용

- `loadGithubRepository`: 기존 GitHub App 토큰과 수집 제한을 그대로 사용해 JS/TS 소스를 수집한다.
- `analyzeSourceFiles`: 기존 ts-morph Project와 API 진입점 메타데이터에 추가 수집기 `collectSqlInjection`을 연결한다.
- 연결 저장소 분석 API: 기존 로그인·저장소 접근 검사, 커밋별 캐시, AnalysisRun 이력을 유지한다.
- `AnalysisRun.stats.sqlInjection`: 분석 버전, 후보 수, 입력 흐름 관찰 수, 의심 수와 표시 제한 여부만 저장한다.
  상세 후보와 코드 근거는 기존 분석 응답/메모리 캐시로 제공하며 영구 저장되는 상세 보고서는 아니다.
- 이전 버전의 캐시는 무효화한다. DB 스키마 변경이나 새 외부 서비스는 없다.

## 탐지 결과

`RepositoryAnalysis.sqlInjection`은 버전 `sqli-static-v1`, 최대 100개 후보, 분석 한계를 포함한다.
각 후보에는 SQL_INJECTION 유형, 위험도, 확신 수준, 파일/줄, SQL 실행 인수,
입력 읽기·변수 초기화·실행 호출의 근거, 원인·수정 방법과 추가 확인 사항을 제공한다.

- **입력 흐름 관찰**: 기존 메타데이터로 확인한 Next.js API 요청 입력에서 SQL 실행 인수까지
  지원하는 지역 표현식의 연결을 관찰하고, 클라이언트의 SQL 라이브러리 출처도 확인한 경우다.
  취약점 확정이나 실제 실행 증명이 아니다.
- **의심 후보**: 입력, 클라이언트, 변환, 가변 변수, 분기 또는 함수 경계에 미확정 부분이 있는 경우다.
  중간/낮은 확신 수준으로 표시한다. 단순한 함수 인수를 HTTP 입력으로 단정하지 않는다.

## 지원 범위

- 입력: Next.js App Router API의 요청 URL·nextUrl·헤더·쿠키, json/text/formData 읽기,
  두 번째 인수의 params, URL/searchParams.get 형태 및 단순 지역 const 별칭.
- req.body/query/params 형태는 프레임워크 진입점이 확인되지 않으면 의심 근거로만 사용한다.
- SQL: 문자열 `+` 결합, 템플릿 보간, 동적 raw 문자열, pg의 `{ text, values }` 형태.
- 클라이언트: 직접 import한 pg Pool/Client, mysql/mysql2 createPool/createConnection,
  sqlite3 Database, better-sqlite3, Sequelize, PrismaClient 생성 및 단순 const 별칭.
- 실행 API: pg/Sequelize query, mysql query/execute, SQLite exec/prepare/run/all/get,
  Prisma raw/unsafe raw 메서드의 지원되는 직접 호출.
- 정적 SQL에 별도 값 인수를 전달하는 매개변수 바인딩, 상수끼리의 결합,
  보간 없는 문자열은 표시하지 않는다. Prisma의 직접 tagged raw API와
  명시적 raw 조각이 없는 Prisma.sql 태그 인수도 일반 문자열 결합으로 취급하지 않는다.

## 한계와 화면

동적 require, 커스텀 DB 래퍼, 글로벌 클라이언트 캐시, 연결 전달, 함수 간 데이터 흐름,
복잡한 객체 변경·검증·이스케이프·수치 변환의 안전성은 완전히 해석하지 않는다.
태그 템플릿에 간접적으로 삽입되는 Prisma.raw 등도 미탐될 수 있다.
SQL처럼 보이는 일반 query 메서드는 SQL 클라이언트임을 확인하지 못하면 의심 후보일 뿐이다.
파일 수집이 일부인 경우 해당 범위 밖의 코드는 검사하지 않는다.

기존 저장소 상세 화면에서 GitHub 분석이 완료되면 SQL Injection 정적 분석 후보 영역이 표시된다.
항목을 선택하면 기존 SourceCodeViewer로 해당 줄과 주변 코드, 입력 연결 근거를 확인할 수 있다.
위험도는 검토 우선순위이며 후보가 없어도 안전을 보증하지 않는다.

이번 구현은 저장소 코드를 실행하거나 SQL/배포 사이트에 요청하지 않는다.
테스트·빌드·서버 실행·DB 마이그레이션은 수행하지 않았다.
