import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolve4: vi.fn(), lookup: vi.fn(), request: vi.fn(), write: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("node:dns/promises", () => ({
  Resolver: class { resolve4 = mocks.resolve4; cancel() {} }, lookup: mocks.lookup,
}));
vi.mock("node:https", () => ({ request: mocks.request }));
vi.mock("@/lib/db", () => ({ db: { deploymentVerificationRateLimit: { upsert: mocks.write }, userRepository: { updateMany: mocks.write } } }));
vi.mock("@/lib/github/repositoryAccess", () => ({ requireRepositoryAccess: vi.fn() }));
import { readOwnershipFile, resolveOwnershipIPv4, OWNERSHIP_FILE_PATH } from "./deploymentVerificationRequest";
import { verifyDeploymentChallenge } from "./deploymentVerification";

const host = "web-securtiy-programming-portfolio-nine.vercel.app";
const publicIp = "64.29.17.195";
const error = (code: string) => Object.assign(new Error("not exposed"), { code });
beforeEach(() => vi.resetAllMocks());

it("uses bounded system lookup only for DNS transport failures and rejects all unsafe answers", async () => {
  mocks.resolve4.mockRejectedValue(error("ECONNREFUSED"));
  mocks.lookup.mockResolvedValue([{ address: publicIp, family: 4 }, { address: "216.198.79.195", family: 4 }]);
  expect(await resolveOwnershipIPv4(host)).toEqual([publicIp, "216.198.79.195"]);
  expect(mocks.lookup).toHaveBeenCalledWith(host, { family: 4, all: true, verbatim: true });

  mocks.lookup.mockRejectedValue(error("ECONNREFUSED"));
  await expect(resolveOwnershipIPv4(host)).rejects.toThrow("DNS 서버에 연결");
  mocks.lookup.mockRejectedValue(error("ENOTFOUND"));
  await expect(resolveOwnershipIPv4(host)).rejects.toThrow("도메인 DNS 조회에 실패");
  mocks.lookup.mockResolvedValue([]);
  await expect(resolveOwnershipIPv4(host)).rejects.toThrow("공개 IPv4 주소가 없습니다");
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "100.100.100.200", "169.254.169.254", "168.63.129.16", "::ffff:127.0.0.1"]) {
    mocks.lookup.mockResolvedValue([{ address: publicIp, family: 4 }, { address: ip, family: 4 }]);
    await expect(resolveOwnershipIPv4(host)).rejects.toThrow("사설·루프백·메타데이터");
  }
  mocks.lookup.mockClear();
  for (const [code, message] of [["ENOTFOUND", "도메인 DNS 조회"], ["ENODATA", "공개 IPv4 주소가 없습니다"]]) {
    mocks.resolve4.mockRejectedValue(error(code));
    await expect(resolveOwnershipIPv4(host)).rejects.toThrow(message);
  }
  mocks.resolve4.mockResolvedValue([publicIp, "127.0.0.1"]);
  await expect(readOwnershipFile(`https://${host}`)).rejects.toThrow("사설·루프백·메타데이터");
  expect(mocks.lookup).not.toHaveBeenCalled();
  expect(mocks.request).not.toHaveBeenCalled();
});

it("pins HTTPS to the checked IP, rejects redirects and oversized bodies, and stops expired tokens before DNS", async () => {
  mocks.resolve4.mockRejectedValue(error("ECONNREFUSED"));
  mocks.lookup.mockResolvedValue([{ address: publicIp, family: 4 }]);
  function serve(remoteAddress = publicIp, statusCode = 200, body = "ownership-fixture") {
    mocks.request.mockImplementation(() => {
      const req = Object.assign(new EventEmitter(), { destroyed: false, destroy() { this.destroyed = true; }, end() {} });
      req.end = () => queueMicrotask(() => {
        const socket = Object.assign(new EventEmitter(), { remoteAddress });
        req.emit("socket", socket); socket.emit("connect");
        if (req.destroyed) return;
        const response = Object.assign(new EventEmitter(), { statusCode, headers: {}, destroy() {} });
        req.emit("response", response);
        if (!req.destroyed) { response.emit("data", Buffer.from(body)); response.emit("end"); }
      });
      return req;
    });
  }
  serve();
  expect(await readOwnershipFile(`https://${host}`)).toBe("ownership-fixture");
  expect(mocks.request.mock.calls[0][0]).toMatchObject({
    hostname: publicIp, servername: host, port: 443, family: 4, method: "GET", path: OWNERSHIP_FILE_PATH,
    rejectUnauthorized: true, agent: false, headers: { Host: host },
  });
  expect(mocks.request.mock.calls[0][0].checkServerIdentity).toBeTypeOf("function");
  serve("216.198.79.195");
  await expect(readOwnershipFile(`https://${host}`)).rejects.toThrow("연결 대상 IP");
  serve(publicIp, 302);
  const beforeRedirect = mocks.request.mock.calls.length;
  await expect(readOwnershipFile(`https://${host}`)).rejects.toThrow("리다이렉트는 허용되지 않습니다");
  expect(mocks.request.mock.calls.length).toBe(beforeRedirect + 1);
  serve(publicIp, 200, "x".repeat(1025));
  await expect(readOwnershipFile(`https://${host}`)).rejects.toThrow("크기 제한");
  const beforeExpiry = mocks.resolve4.mock.calls.length;
  const expired = { vercelUrl: `https://${host}`, deploymentTokenHash: "0".repeat(64), deploymentTokenExpiresAt: new Date(0) } as Parameters<typeof verifyDeploymentChallenge>[1];
  await expect(verifyDeploymentChallenge("user-a", expired)).rejects.toMatchObject({ status: 410, message: "검증 토큰이 만료되었습니다. 재발급해 주세요." });
  expect(mocks.resolve4.mock.calls.length).toBe(beforeExpiry);
  expect(mocks.write).not.toHaveBeenCalled();
});
