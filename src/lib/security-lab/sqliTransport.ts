import "server-only";
import { request } from "node:https";
import { checkServerIdentity } from "node:tls";
import { randomUUID } from "node:crypto";
import { resolveOwnershipIPv4 } from "@/lib/repository/deploymentVerificationRequest";
import type { ManagedSqliTarget } from "./sqliRegistry";
import type { SqliResponseEvidence } from "./sqliTypes";

const MAX_BYTES = 16 * 1024;
const MAX_CHARS = 4000;
const TOTAL_TIMEOUT_MS = 8000;

/** Server-internal transport: no URL/header/cookie options from the browser. Never follows redirects/retries. */
export async function observeManagedSqli(target: ManagedSqliTarget, value: string, assertApproval: () => void, validUntil = Number.POSITIVE_INFINITY, kind: "SQLI" | "XSS" = "SQLI"): Promise<SqliResponseEvidence> {
  const started = performance.now(), requestId = randomUUID();
  let contentType: string | null = null;
  const record = (outcome: SqliResponseEvidence["outcome"], errorMessage: string | null, statusCode: number | null = null,
    body: string | null = null, bodyTruncated = false): SqliResponseEvidence => ({ requestId, observedAt: new Date().toISOString(),
    outcome, errorMessage, statusCode, body, bodyTruncated, contentType, durationMs: Math.round(performance.now() - started) });
  const url = new URL(target.path, target.origin);
  url.searchParams.set(target.parameter, value);
  const lifetimeMs = Math.min(TOTAL_TIMEOUT_MS, validUntil - Date.now());
  if (!(lifetimeMs > 0)) return record("BLOCKED", "실행 승인이 만료되어 요청을 전송하지 않았습니다.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let addresses: string[];
  try {
    assertApproval();
    addresses = await Promise.race([resolveOwnershipIPv4(url.hostname), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("DNS_TIMEOUT")), lifetimeMs);
    })]);
    assertApproval(); // Expiry/revocation during DNS resolution must stop the connection.
  } catch (error) {
    return record(error instanceof Error && error.message === "DNS_TIMEOUT" ? "TIMEOUT" : "BLOCKED",
      "DNS·공개 IP 또는 실행 승인 검증 실패로 요청을 전송하지 않았습니다.");
  } finally { clearTimeout(timer); }
  const remaining = lifetimeMs - (performance.now() - started);
  if (remaining <= 0) return record("TIMEOUT", "DNS를 포함한 요청 제한 시간 8초를 초과했습니다.");
  const pinned = addresses[0];
  return new Promise(resolve => {
    let settled = false, status: number | null = null, size = 0;
    const chunks: Buffer[] = [];
    const req = request({
      protocol: "https:", hostname: pinned, family: 4, port: 443, servername: url.hostname,
      rejectUnauthorized: true, checkServerIdentity: (_host, cert) => checkServerIdentity(url.hostname, cert),
      method: "GET", path: url.pathname + url.search, agent: false, maxHeaderSize: 8192,
      headers: { Host: url.hostname, Accept: kind === "XSS" ? "text/html, application/xhtml+xml, text/plain, application/json" : "application/json, text/plain", "Accept-Encoding": "identity",
        "Cache-Control": "no-store", "User-Agent": kind === "XSS" ? "VulnLab-Managed-XSS/1.0" : "VulnLab-Managed-SQLi/1.0" },
    });
    const finish = (outcome: SqliResponseEvidence["outcome"], message: string | null, truncated = false) => {
      if (settled) return;
      settled = true; clearTimeout(timeout);
      const full = Buffer.concat(chunks).toString("utf8");
      resolve(record(outcome, message, status, chunks.length ? full.slice(0, MAX_CHARS) : status !== null ? "" : null,
        truncated || full.length > MAX_CHARS));
      req.destroy();
    };
    const timeout = setTimeout(() => finish("TIMEOUT", "요청 제한 시간(최대 8초 또는 승인 만료)에 도달했습니다."), remaining);
    req.on("socket", socket => socket.once("connect", () => {
      if (socket.remoteAddress !== pinned) finish("BLOCKED", "실제 연결 IP가 검증된 DNS 결과와 다릅니다.");
    }));
    req.on("error", () => finish("NETWORK_ERROR", "HTTPS/TLS 연결 또는 응답 수신에 실패했습니다."));
    req.on("response", response => {
      status = response.statusCode ?? null;
      contentType = typeof response.headers["content-type"] === "string" ? response.headers["content-type"].slice(0, 200) : null;
      if (status !== null && status >= 300 && status < 400) {
        finish("BLOCKED", "리다이렉트 응답을 차단했습니다. 이동하지 않았습니다."); response.destroy(); return;
      }
      if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") {
        finish("BLOCKED", "압축 응답은 지원하지 않습니다."); response.destroy(); return;
      }
      if (Number(response.headers["content-length"] ?? 0) > MAX_BYTES) {
        finish("SIZE_LIMIT", "응답 크기 제한 16KB를 초과했습니다.", true); response.destroy(); return;
      }
      response.on("data", (part: Buffer) => {
        const buffer = Buffer.from(part), left = MAX_BYTES - size;
        chunks.push(buffer.subarray(0, Math.max(0, left))); size += buffer.length;
        if (size > MAX_BYTES) { finish("SIZE_LIMIT", "응답 크기 제한 16KB를 초과했습니다.", true); response.destroy(); }
      });
      response.on("error", () => finish("NETWORK_ERROR", "응답 수신에 실패했습니다."));
      response.on("aborted", () => finish("NETWORK_ERROR", "응답이 중단되었습니다."));
      response.on("end", () => finish([401, 403, 429].includes(status ?? 0) ? "ACCESS_DENIED" : "RESPONSE",
        [401, 403, 429].includes(status ?? 0) ? "접근 또는 요청 횟수가 제한되었습니다. 인증 우회는 수행하지 않습니다." : null));
    });
    req.end();
  });
}
