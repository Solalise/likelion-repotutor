import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error Existing dependency-free Runner is implemented in JavaScript.
import { createRunner } from "../../../tools/security-lab-runner/server.mjs";
import { requestRunnerConnection, runnerTargetMatches } from "./runnerConnection";

afterEach(() => vi.unstubAllGlobals());

describe("existing Runner connection protocol", () => {
  it("pairs and checks approved targets without sending target HTTP or exposing test tokens; rejects wrong Origin and revoked sessions", async () => {
    let targetRequests = 0;
    const target = http.createServer((_request, response) => { targetRequests++; response.end("unexpected"); });
    await new Promise<void>(resolve => target.listen(0, "127.0.0.1", resolve));
    const runner = await createRunner({ rpcPort: 0, adminPort: 0 });
    const targetPort = (target.address() as import("node:net").AddressInfo).port;
    const nativeFetch = globalThis.fetch;
    const origin = "http://127.0.0.1:3100";
    const adminBase = `http://127.0.0.1:${runner.adminPort}`;
    const admin = async (path: string, input = {}) => {
      const response = await nativeFetch(`${adminBase}/admin/${path}`, {
        method: "POST", headers: { "Content-Type": "application/json", Origin: adminBase, "X-Admin-Key": runner.adminKey }, body: JSON.stringify(input),
      });
      expect(response.ok).toBe(true);
      return response.json();
    };
    const calls: string[] = [];
    const browserFetch = (allowedOrigin: string) => vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      calls.push(new URL(url).pathname);
      return nativeFetch(url, { ...init, headers: { ...init.headers, Origin: allowedOrigin } });
    });
    try {
      await admin("setup", {
        targetPort, allowedOrigin: origin, tokenA: "private-test-token-a", tokenB: "private-test-token-b",
        identityPath: "/me", subjectPointer: "/user/id", subjectA: "A", subjectB: "B",
        idPointer: "/order/id", ownerPointer: "/order/ownerId", protectedPointer: "/order/item", testOnly: true,
      });
      const code = (await admin("state")).pairing.code;
      browserFetch("http://127.0.0.1:3101");
      await expect(requestRunnerConnection({ kind: "pair", port: String(runner.rpcPort), code })).rejects.toMatchObject({ invalidSession: true });
      browserFetch(origin);
      const paired = await requestRunnerConnection({ kind: "pair", port: String(runner.rpcPort), code });
      expect(paired.session).toBeDefined();
      expect(runnerTargetMatches(targetPort, paired.state)).toBe(true);
      expect(runnerTargetMatches(targetPort === 4320 ? 4321 : 4320, paired.state)).toBe(false);
      expect(runnerTargetMatches(targetPort)).toBe(false);
      expect(JSON.stringify(paired)).not.toContain("private-test-token");
      expect(paired.state).not.toHaveProperty("plan");
      const state = await requestRunnerConnection({ kind: "state", session: paired.session! });
      expect(state.state.target).toBe(`http://127.0.0.1:${targetPort}`);
      await expect(requestRunnerConnection({ kind: "pair", port: String(runner.rpcPort), code })).rejects.toMatchObject({ invalidSession: true });
      await admin("clear");
      await expect(requestRunnerConnection({ kind: "state", session: paired.session! })).rejects.toMatchObject({ invalidSession: true });
      expect(calls.every(path => path === "/v1/pair" || path === "/v1/state")).toBe(true);
      expect(targetRequests).toBe(0);
    } finally {
      await runner.close();
      await new Promise<void>(resolve => target.close(() => resolve()));
    }
  });

  it("rejects invalid ports and expired sessions before contacting any server", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    for (const port of ["80", "65536", "4317/path", "localhost:4317"]) {
      await expect(requestRunnerConnection({ kind: "pair", port, code: "code" })).rejects.toThrow();
    }
    await expect(requestRunnerConnection({ kind: "state", session: { token: "memory-only", port: "4317", expiresAt: Date.now() - 1 } })).rejects.toMatchObject({ invalidSession: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not surface arbitrary error bodies or retain unrelated response data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "private-token-body" }), { status: 403 })));
    await expect(requestRunnerConnection({ kind: "pair", port: "4317", code: "code" })).rejects.toThrow("Origin");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ configured: true, paired: true, running: false, target: "http://evil.example:4320", token: "secret", expiresAt: Date.now() + 10000 }))));
    await expect(requestRunnerConnection({ kind: "pair", port: "4317", code: "code" })).rejects.toMatchObject({ invalidSession: true });
  });
});
