# 5-A BehaviorFlow UI 연결

기존 `/repository` 화면의 보기 전환에 **동작 흐름**을 추가했다. 학습용·개발자 보기와 기존 AI 패널은 유지했다. 분석기, API, 인증, DB, AI 로직은 변경하지 않았다.

## 변경 파일

- `src/components/repository/RepositoryWorkspace.tsx`: 기존 분석 완료 후 BehaviorFlow 보기 연결. 현재 분석 요청의 sample/github/connected 식별자를 그대로 전달한다. 분석 중/실패 시 이전 저장소 Flow를 표시하지 않는다.
- `src/components/behavior/behaviorClient.ts`: 기존 GET `/api/behavior` 호출과 HTTP 오류·202 처리. 인증 헤더/토큰을 만들지 않으며 브라우저의 기존 세션을 사용한다.
- `src/components/behavior/BehaviorWorkspace.tsx`: 기능 목록, 선택 기능 그래프, 선택 노드 근거, 요청 취소 및 오류 처리.
- `src/components/behavior/BehaviorGraph.tsx`: 기존 React Flow와 `buildCodeFlowLayout` 좌표 계산을 재사용. API가 반환한 노드·연결만 표시하며 관계를 새로 추론하지 않는다.
- `src/components/behavior/BehaviorWorkspace.test.tsx`: 지연 조회, 오류 시 근거 숨김, 실제 서버 ID/연결 보존, 명시적인 CFG Yes/No, 202 진행 상태 테스트.
- `src/app/globals.css`: 새 보기 범위의 크림/올리브 스타일과 좁은 화면 재배치.
- `docs/behavior-ui-stage5a.md`: 이 보고서.

## 조회와 화면

1. 기존 저장소 분석이 완료된 뒤 동작 흐름 보기를 누르면 `view=features`만 조회한다. 기능 목록을 위해 전체 Flow를 생성하지 않는다.
2. 기능 클릭 시 해당 `analysisId`/`featureId`로 `view=flow`를 조회한다. 기본 초기 노드 수를 유지하며 별도의 전체 조회·복잡한 확장 UX는 추가하지 않았다.
3. 노드 클릭 시에만 `view=node`를 조회한다. 파일·행/열·코드·상태·근거·호출·이벤트·HTTP/DB/응답 문맥을 표시한다. 근거 목록은 서버 페이지에 담긴 범위임을 명시하고, 코드 청크는 다음 범위를 조회할 수 있다.
4. CFG가 있는 함수에서 **함수 내부 조건·경로 보기**를 누르면 `view=cfg` 첫 페이지를 별도로 표시한다. 서버의 `true`/`false`만 Yes/No로 표시한다. CFG 문장 클릭은 이미 받은 문장 위치를 보여주며 가짜 BehaviorNode 상세 요청을 만들지 않는다. **기능 흐름으로** 돌아갈 수 있다.
5. 선택 변경/언마운트 시 요청을 취소한다. 새 기능의 ID와 일치하지 않는 그래프/상세는 렌더하지 않는다. 요청 실패 시 이전 그래프와 코드 근거를 비우고 오류·새로고침 안내를 제공한다.

`not-generated`는 아직 선택하지 않은 Flow이며 분석 중이라는 뜻으로 바꾸지 않는다. `partial`, 미해결 개수, 원본 수집 부분 완료를 표시한다. **분석 잘림(truncated)**은 복구 불가/누락 수 미상으로, **화면 제한**은 조회 가능한 숨은 노드/관계 수로 별도 표시한다. 코드 포함·참조·미확인 관계는 점선이며 실행 호출로 소개하지 않는다. 위치와 화살표는 런타임 실행 순서·성공을 뜻하지 않는다. 샘플은 샘플 저장소임을 명시한다.

## 검증

- TypeScript 검사 통과. 최종 프로덕션 빌드의 TypeScript 검사도 통과.
- ESLint 통과.
- 새 UI 관련 테스트 4개, 기존 RepositoryWorkspace 전환 테스트 3개, 기존 Behavior API 테스트 21개 통과. 전체 대규모 테스트/성능 측정은 요청 범위에 따라 실행하지 않았다.
- 프로덕션 빌드 통과.
- 브라우저 자동화 연결은 `The browser access host is unavailable`로 실패했다. 실제 화면 캡처·클릭·모바일 시각 검증을 완료했다고 주장하지 않는다.
- 실제 GitHub 로그인→조직/개인 저장소 선택→분석→Flow 조회는 직접 확인하지 못했다. 보안 검증 자체는 기존 API를 그대로 사용하며 관련 API 회귀 테스트로 확인했다. 인증·API를 우회하는 검증 경로는 추가하지 않았다.

## 브라우저 테스트 방법

1. `npm.cmd run dev` 실행 후 로그인한다.
2. **내 저장소 → 분석 시작/분석 결과 보기**로 실제 연결 저장소를 연다.
3. 분석 완료 후 상단 **동작 흐름**을 누른다. 왼쪽에 실제 경로 기반 기능 목록이 나타나는지 확인한다.
4. 기능을 선택하고 초기 그래프·partial/잘림/숨김 안내를 확인한다. 네트워크에서 목록 조회는 `view=features`, 선택 시 `view=flow` 한 기능만 요청되는지 확인한다.
5. 노드를 클릭해 오른쪽 파일 경로·코드·상태를 확인한다. 클릭 전에는 `view=node` 요청이 없어야 한다.
6. CFG가 있는 함수에서 내부 조건 보기를 눌러 Yes/No와 미지원/첫 페이지 안내를 확인한다. 이것은 실제 실행된 분기가 아니다.
7. 다른 기능/보기로 전환하고, 기존 학습용·개발자 보기가 유지되는지 확인한다. 접근 권한을 회수한 뒤 새로고침하면 이전 코드 대신 오류가 나와야 한다.

완성된 end-to-end 런타임 흐름을 제공하는 단계는 아니다. 기존 동적 URL·Prisma 전역 캐시·래퍼 반환·반복문 등 분석 한계는 그대로이며 미해결 관계를 임의로 연결하지 않았다.
