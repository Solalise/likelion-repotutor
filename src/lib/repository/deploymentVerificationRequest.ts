import "server-only";
import { Resolver, lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { checkServerIdentity } from "node:tls";
import { normalizeVercelUrl } from "./deployment";

export const OWNERSHIP_FILE_PATH = "/.well-known/vulnlab-ownership.txt";
const MAX_BODY_BYTES = 1024;

// Conservative IPv4-only policy: special-purpose ranges are never connection targets,
// including globally reachable exceptions within these ranges. No IPv6/DNS64 fallback.
// https://www.iana.org/assignments/iana-ipv4-special-registry/
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["192.31.196.0", 24], ["192.52.193.0", 24], ["192.175.48.0", 24],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(address, prefix, "ipv4");
// Azure's platform virtual IP is globally numbered but must not be probed.
blocked.addAddress("168.63.129.16", "ipv4");

const DNS_TRANSPORT_ERRORS = new Set(["ECONNREFUSED", "ETIMEOUT", "ECANCELLED", "ECONNRESET", "ENETUNREACH", "EHOSTUNREACH", "EAI_AGAIN"]);
function dnsCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}
function dnsFailure(error: unknown): Error {
  const code = dnsCode(error);
  if (code && DNS_TRANSPORT_ERRORS.has(code)) return new Error("DNS 서버에 연결하지 못했거나 응답 시간이 초과되었습니다. Windows DNS·VPN·보안 프로그램의 DNS 연결 설정을 확인해 주세요.");
  if (code === "ENODATA") return new Error("도메인에 조회 가능한 공개 IPv4 주소가 없습니다. 배포 도메인의 A 레코드를 확인해 주세요.");
  return new Error("도메인 DNS 조회에 실패했습니다. 도메인 이름과 배포 상태를 확인해 주세요.");
}

/** Windows system resolution may work when c-ares cannot contact its DNS server.
 * Fall back only on transport failure, never on an empty/blocked DNS answer. */
export async function resolveOwnershipIPv4(hostname: string): Promise<string[]> {
  const resolver = new Resolver({ timeout: 1500, tries: 1 });
  const dnsTimer = setTimeout(() => resolver.cancel(), 3000);
  let addresses: string[];
  try { addresses = await resolver.resolve4(hostname); }
  catch (error) {
    clearTimeout(dnsTimer);
    if (!DNS_TRANSPORT_ERRORS.has(dnsCode(error) ?? "")) throw dnsFailure(error);
    let systemTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const records = await Promise.race([
        lookup(hostname, { family: 4, all: true, verbatim: true }),
        new Promise<never>((_resolve, reject) => {
          systemTimer = setTimeout(() => reject({ code: "ETIMEOUT" }), 3000);
        }),
      ]);
      addresses = records.map(record => record.address);
    } catch (systemError) { throw dnsFailure(systemError); }
    finally { clearTimeout(systemTimer); }
  }
  finally { clearTimeout(dnsTimer); }
  if (!addresses.length) throw new Error("도메인에 조회 가능한 공개 IPv4 주소가 없습니다. 배포 도메인의 A 레코드를 확인해 주세요.");
  if (addresses.some(ip => isIP(ip) !== 4 || blocked.check(ip, "ipv4"))) {
    throw new Error("사설·루프백·메타데이터 또는 특수 목적 IP 주소는 확인할 수 없습니다.");
  }
  return [...new Set(addresses)];
}

/** Fresh checked DNS result and exactly one IP-pinned GET, with no HTTP redirects/retries. */
export async function readOwnershipFile(registeredUrl: string): Promise<string> {
  const url = new URL(normalizeVercelUrl(registeredUrl));
  const addresses = await resolveOwnershipIPv4(url.hostname);
  const pinnedIp = addresses[0];
  return new Promise<string>((resolve, reject) => {
    // Connect to the checked IP literal, never to a hostname that could be resolved again.
    // SNI, Host and certificate identity still refer to the registered DNS name.
    const req = request({
      protocol: "https:", hostname: pinnedIp, port: 443, family: 4,
      servername: url.hostname, rejectUnauthorized: true,
      checkServerIdentity: (_hostname, cert) => checkServerIdentity(url.hostname, cert),
      method: "GET", path: OWNERSHIP_FILE_PATH, agent: false,
      maxHeaderSize: 8192,
      headers: {
        Host: url.hostname, Accept: "text/plain", "Accept-Encoding": "identity",
        "Cache-Control": "no-cache", "User-Agent": "VulnLab-Ownership-Verification/1.0",
      },
    });
    let settled = false;
    const timer = setTimeout(() => fail("확인 파일 요청 제한 시간(5초)을 초과했습니다."), 5000);
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(message));
      req.destroy();
    };
    req.on("socket", socket => {
      socket.once("connect", () => {
        if (socket.remoteAddress !== pinnedIp) fail("연결 대상 IP가 DNS 확인 결과와 일치하지 않습니다.");
      });
    });
    req.on("error", error => {
      // Do not expose internal network/OS details in the public API.
      fail(error.message.startsWith("확인 파일") || error.message.startsWith("연결 대상")
        ? error.message : "HTTPS 연결에 실패했습니다. 배포 상태와 TLS 인증서를 확인해 주세요.");
    });
    req.on("response", response => {
      if (response.statusCode !== 200) {
        fail(response.statusCode && response.statusCode >= 300 && response.statusCode < 400
          ? "확인 파일의 리다이렉트는 허용되지 않습니다. 등록한 주소에서 직접 제공해 주세요."
          : "확인 파일을 HTTP 200으로 읽을 수 없습니다.");
        response.destroy();
        return;
      }
      if ((response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity")
        || Number(response.headers["content-length"] ?? 0) > MAX_BODY_BYTES) {
        fail("확인 파일은 압축하지 않은 1KB 이하 텍스트여야 합니다.");
        response.destroy();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          fail("확인 파일 크기 제한(1KB)을 초과했습니다.");
          response.destroy();
        } else chunks.push(chunk);
      });
      response.on("error", () => fail("확인 파일 응답을 끝까지 읽지 못했습니다."));
      response.on("aborted", () => fail("확인 파일 응답이 중단되었습니다."));
      response.on("end", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
    });
    req.end();
  });
}
