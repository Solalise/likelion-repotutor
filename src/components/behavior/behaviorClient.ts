import type { BehaviorQueryError } from "@/types/behaviorQuery";

export type BehaviorSource = { source: "sample" } | { source: "connected"; connectionId: string } | { source: "github"; url: string };
export class BehaviorRequestError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(status === 202 ? "분석이 진행 중입니다. 잠시 후 다시 조회해 주세요."
      : status === 401 ? "로그인 후 다시 조회해 주세요."
      : status === 403 || code === "ACCESS_DENIED" ? "저장소 접근 권한을 확인할 수 없습니다. 연결과 권한을 확인해 주세요."
      : status === 409 ? "현재 분석을 사용할 수 없습니다. 저장소를 다시 분석한 뒤 조회해 주세요."
      : status === 422 ? "이 분석에서는 동작 흐름을 제공할 수 없습니다. 재분석이 필요할 수 있습니다."
      : status === 404 ? "선택한 기능이나 노드를 찾을 수 없습니다. 목록을 다시 조회해 주세요."
      : "동작 흐름을 조회하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}
export async function queryBehavior<T>(source: BehaviorSource, values: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const params = new URLSearchParams({ ...source, ...values });
  const response = await fetch(`/api/behavior?${params}`, { cache: "no-store", signal });
  const body = await response.json();
  if (!response.ok || response.status === 202) throw new BehaviorRequestError(response.status, (body as BehaviorQueryError).error?.code ?? "QUERY_UNAVAILABLE");
  return body as T;
}
