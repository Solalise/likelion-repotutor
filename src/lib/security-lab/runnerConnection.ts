import type { RunnerState } from "./runnerTypes";

export type RunnerSession = { token: string; port: string; expiresAt: number };
export type ConnectionState = Pick<RunnerState, "configured" | "paired" | "target" | "running">;

export class RunnerConnectionError extends Error {
  constructor(message: string, public readonly invalidSession = false) { super(message); }
}

/** Uses the existing Runner protocol directly; never calls management or attack APIs. */
export async function requestRunnerConnection(
  request: { kind: "pair"; port: string; code: string } | { kind: "state"; session: RunnerSession },
  signal?: AbortSignal,
): Promise<{ state: ConnectionState; session?: RunnerSession }> {
  const port = request.kind === "pair" ? request.port : request.session.port;
  if (!/^\d{4,5}$/.test(port) || Number(port) < 1024 || Number(port) > 65535) {
    throw new RunnerConnectionError("실행기 포트는 1024~65535 정수로 입력해주세요.");
  }
  if (request.kind === "state" && request.session.expiresAt <= Date.now()) {
    throw new RunnerConnectionError("세션이 만료되었습니다. 로컬 관리 화면에서 다시 설정하고 페어링해주세요.", true);
  }
  const response = await fetch(`http://127.0.0.1:${port}/v1/${request.kind}`, {
    method: "POST", credentials: "omit", redirect: "error", cache: "no-store",
    headers: { "Content-Type": "application/json", ...(request.kind === "state" ? { "X-Lab-Session": request.session.token } : {}) },
    body: JSON.stringify(request.kind === "pair" ? { code: request.code } : {}),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
  });
  // Do not echo arbitrary response bodies or credentials into UI/logs.
  if (!response.ok) {
    const invalid = response.status === 401 || response.status === 403;
    throw new RunnerConnectionError(invalid
      ? "Origin·페어링 코드·세션을 확인해주세요. 로컬 관리 화면에서 다시 설정해야 할 수 있습니다."
      : response.status === 429 ? "페어링 시도 제한에 도달했습니다. 잠시 후 다시 시도해주세요." : "실행기 상태를 확인하지 못했습니다. 다시 시도해주세요.", invalid);
  }
  const payload = await response.json();
  if (payload?.configured !== true || payload?.paired !== true || typeof payload.running !== "boolean" ||
    typeof payload.target !== "string" || !/^http:\/\/127\.0\.0\.1:[1-9]\d{3,4}$/.test(payload.target) ||
    Number(new URL(payload.target).port) < 1024 || Number(new URL(payload.target).port) > 65535) {
    throw new RunnerConnectionError("실행기의 대상 설정을 확인하지 못했습니다. 다시 페어링해주세요.", true);
  }
  const state: ConnectionState = { configured: true, paired: true, target: payload.target, running: payload.running };
  if (request.kind === "state") return { state };
  if (typeof payload.token !== "string" || !payload.token || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) {
    throw new RunnerConnectionError("유효한 페어링 세션을 받지 못했습니다. 로컬 관리 화면에서 다시 설정해주세요.", true);
  }
  return { state, session: { token: payload.token, port, expiresAt: payload.expiresAt } };
}

export function runnerTargetMatches(port: number, state?: ConnectionState): boolean {
  return Boolean(state?.configured && state.paired && state.target === `http://127.0.0.1:${port}`);
}
