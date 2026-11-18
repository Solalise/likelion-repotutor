# XSS 1차 정적 분석

기존 GitHub 코드 수집, AST Project, API 진입점, 커밋별 캐시,
AnalysisRun과 코드 표시 컴포넌트를 재사용한다. 네트워크 요청이나 공격 실행은 하지 않는다.

## 결과와 화면

기존 `RepositoryAnalysis`에 `xss` (`xss-static-v1`)를 추가한다.
기존 SQL Injection 화면에 유형 선택 버튼을 추가해 SQL Injection/XSS를 전환한다.
파일·줄·주변 코드·입력 출처·출력 지점·근거·위험도·확신·수정 방법·한계를 표시한다.
클라이언트 DOM/React, 서버 HTML 응답, 실행 환경 미확정을 별도로 표시한다.

`candidate`는 취약점 검토 후보, `protected`는 지원하는 문맥의 안전 처리 관찰이다.
후자는 취약점 후보 수에서 제외하며 위험도는 해당 없음으로 표시한다.
입력 연결이 증명되지 않은 경우에는 `suspected`로 남긴다.
이는 공격 성공이나 전체 파일의 안전성 증명이 아니다.

AnalysisRun의 기존 JSON stats에 XSS 버전·후보 수·입력 흐름 관찰 수·보호 처리 수·표시 제한만
추가한다. 상세 결과는 기존 분석 응답/메모리 캐시에서 제공한다. DB 스키마 변경은 없다.
XSS 결과가 없는 기존 캐시는 무효화한다.

## 지원하는 입력과 출력

- 기존 SQL 추적기의 요청 URL·본문·지역 변수 흐름을 그대로 재사용한다.
- 추가 입력: shadowing되지 않은 location.search/hash/href와 window/document.location,
  document.querySelector/getElementById로 얻은 입력 요소의 value 및 단순 const 별칭,
  전역 URLSearchParams를 통한 브라우저 URL 파싱.
- 출력: innerHTML/outerHTML 대입·추가 대입, insertAdjacentHTML의 두 번째 인수,
  JSX dangerouslySetInnerHTML의 __html 값.
- 서버: 명시적 HTML Content-Type을 갖는 전역 Response/next/server NextResponse 생성자,
  지원되는 res.send/end 형태. 후자의 프레임워크 의미는 미확정 후보로 취급한다.
  확인된 서버 경로와 반환 연결이 없는 Response 생성도 미확정 후보로 남긴다.
- JS/TS의 문자열 결합·템플릿 보간을 출력 인수까지 추적한다.
- textContent, 일반 JSX 텍스트 보간, 정적 리터럴과 명시적 비 HTML Response는 후보로 표시하지 않는다.

## 안전 처리 관찰의 조건

- 직접 import한 dompurify/isomorphic-dompurify의 기본 sanitize(input),
  sanitize-html의 기본 호출, escape-html/lodash/escape/lodash.escape의 기본 호출만 지원한다.
- 옵션 인수가 있는 호출, 관찰된 setConfig/addHook/setOptions 또는 라이브러리 속성 변경은
  안전하다고 인정하지 않는다. 사용자 정의 sanitize/escapeHtml 함수는 이름으로 신뢰하지 않는다.
- 해당 호출과 단순 const 별칭을 확인하고, 지원하는 HTML 텍스트 문맥에서만 보호 처리를 인정한다.
  속성·URL·script/style·주석 안의 삽입은 안전 처리가 미확정이다.
- 정화 뒤의 미지원 변환이나 다른 미보호 입력이 출력에 섞이면 전체 출력을 안전하다고 분류하지 않는다.
- 대상 DOM/React/HTML 응답도 확인되어야 `protected`로 분류한다.

## 한계

함수 간 전달, 동적 프로퍼티, 복잡한 별칭·객체 변경, 조건별 검증, React ref/event 입력,
외부 EJS/Pug/Handlebars 템플릿, 사용자 정의 템플릿 태그와 템플릿 엔진은 완전 지원하지 않는다.
JSX spread·중복 속성·사용자 컴포넌트·동적 응답 헤더는 낮은 확신 후보로 남길 수 있다.
실제 React 렌더러, DOM 타입, 응답 전달, 패키지 버전, 수집되지 않은 파일의 훅/전역 설정 및
실행 중 변경까지 증명하지 않는다. 안전 처리 관찰은 이러한 전제 아래의 정적 분류다.
수집된 파일만 검사하며 보호 처리 관찰을 포함하여 최대 100개 지점만 표시한다.

테스트·빌드·서버 실행·DB 마이그레이션·실제 배포 요청은 수행하지 않았다.
