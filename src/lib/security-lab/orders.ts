// Deliberately isolated teaching fixtures. Never connect these to production data/auth.
const orders = Object.freeze({
  "101": Object.freeze({ id: 101, ownerId: "A", customer: "테스트 사용자 A", item: "연습용 올리브 노트", total: 12000 }),
  "102": Object.freeze({ id: 102, ownerId: "B", customer: "테스트 사용자 B", item: "연습용 크림 머그", total: 18000 }),
});

export function getLabOrder(request: Request, mode: "vulnerable" | "fixed") {
  const json = (body: unknown, status: number) => Response.json(body, {
    status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
  // This fixed identity is a lab fixture, not an authentication mechanism.
  const currentUser = { id: "A" };
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => key !== "orderId") || params.getAll("orderId").length !== 1) {
    return json({ error: "INVALID_REQUEST", message: "orderId 하나만 전달해주세요." }, 400);
  }
  const orderId = params.get("orderId") ?? "";
  if (!/^\d{1,6}$/.test(orderId)) return json({ error: "INVALID_ORDER_ID", message: "주문 ID는 1~6자리 숫자입니다." }, 400);
  const order = orders[orderId as keyof typeof orders];
  if (!order) return json({ error: "NOT_FOUND", message: "테스트 주문이 없습니다." }, 404);
  if (mode === "fixed" && order.ownerId !== currentUser.id) {
    return json({ error: "FORBIDDEN", message: "본인 소유의 주문만 조회할 수 있습니다." }, 403);
  }
  return json({ lab: true, currentUser: currentUser.id, order }, 200);
}
