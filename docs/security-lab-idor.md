# IDOR 발표용 로컬 실습

## 실행 및 시연

```powershell
npm.cmd run dev -- --hostname 127.0.0.1 --port 3100
```

1. http://127.0.0.1:3100/security-lab 접속
2. 테스트 계정에서 사용자 A 선택
3. 주문 ID 101로 요청 전송 → 두 API 모두 HTTP 200, ownerId A
4. 주문 ID 102로 변경 후 요청 전송 → 취약 API HTTP 200, ownerId B / 수정 API HTTP 403, 주문 내용 없음
5. 각 카드의 실제 요청 경로·상태·원본 응답 본문과 아래 코드 차이를 설명
6. 개발자 도구 Network에서 orders 요청 2개의 Response와 화면 본문 비교

## 고정 API

- GET /api/security-lab/vulnerable/orders?orderId=101
- GET /api/security-lab/fixed/orders?orderId=102

현재 사용자 A는 서버에서 고정한 실습 신원이다. 운영 로그인, GitHub, DB를 사용하지 않는다. 주문은 Object.freeze로 고정한 가상 데이터이며 쓰기 API가 없다. orderId 외 파라미터 및 중복 파라미터를 거부한다. 클라이언트는 두 고정 상대 경로로만 요청하고 인증 쿠키를 생략하며 리다이렉트를 거부한다. 외부 URL 입력이나 서버 프록시가 없다.

## 검증 결과

- `npm.cmd run typecheck`: 통과
- 신규 API 테스트 5개: 통과 (정상 접근, IDOR 노출, 소유권 거부, 입력 검증, 비캐시 및 운영 쿠키와 분리)
- 전체 테스트: 최초 647 통과 / 3 시간 초과 / 5 생략. 시간 초과 파일 3개와 신규 파일을 `--maxWorkers=1`로 재실행하여 76개 모두 통과.
- 로컬 Next 서버에 실제 fetch: 취약 101 → 200/A, 취약 102 → 200/B, 수정 101 → 200/A, 수정 102 → 403/FORBIDDEN
- 수정 102 실제 본문: `{"error":"FORBIDDEN","message":"본인 소유의 주문만 조회할 수 있습니다."}`
- /security-lab, /, /api/analyze?source=sample: HTTP 200
- 브라우저 클릭 및 화면-응답 일치: **미검증**. 브라우저 호스트 연결 실패, 네이티브 Chrome 최소화 상태로 자동 관찰 실패. 화면은 fetch의 response.status와 response.text()를 그대로 표시하도록 구현했으나 실제 브라우저 확인은 필요하다.
- 기존 인증·분석·AI·그래프 소스는 이번 작업에서 수정하지 않았다. 실제 GitHub 로그인 및 외부 AI 호출은 검증하지 않았다.

## 추가한 소스

- src/app/security-lab/page.tsx
- src/app/security-lab/SecurityLab.tsx
- src/app/security-lab/lab.module.css
- src/app/api/security-lab/vulnerable/orders/route.ts
- src/app/api/security-lab/fixed/orders/route.ts
- src/lib/security-lab/orders.ts
- src/lib/security-lab/orders.test.ts

서버 검증 후 개발 서버를 종료했다. 발표 전에 위 실행 명령으로 시작한다.
