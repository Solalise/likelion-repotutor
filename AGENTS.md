<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

## 개발 및 검증 효율화 원칙

- 기존 코드를 최대한 재사용한다.
- 요청 범위를 벗어나는 리팩터링을 하지 않는다.
- 변경 기능과 직접 관련된 단위 테스트 및 회귀 테스트를 우선한다.
- 전체 테스트와 프로덕션 빌드는 주요 단계 완료 또는 사용자의 명시적 요청 시 실행한다.
- ESLint는 기본적으로 수정 파일만 검사한다.
- 공통 타입, 인증, 권한, DB 등 영향 범위가 큰 변경은 필요한 추가 검증을 수행한다.
- 동일한 검증을 불필요하게 반복하지 않는다.
- 테스트를 통과시키기 위해 검증 조건을 약화하지 않는다.
- 브라우저 실기기 테스트는 기본적으로 사용자가 직접 진행한다.
- 기존 보안 정책 및 안전장치를 유지한다.
- 완료 보고는 수정 사항, 검증 결과, 미검증 항목, 남은 문제 위주로 간결하게 작성한다.

<!-- END:nextjs-agent-rules -->
