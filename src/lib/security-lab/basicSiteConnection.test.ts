import { afterEach, expect, it, vi } from "vitest";
import { BASIC_SITE_URL, checkBasicSite } from "./basicSiteConnection";

afterEach(() => vi.unstubAllGlobals());
it.each([[true, "ready"], [false, "disabled"]] as const)("checks IDOR enabled=%s without sending credentials", async (idorEnabled, expected) => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ service: "vulnlab-basic-site", idorEnabled }));
  vi.stubGlobal("fetch", fetcher);
  const signal = new AbortController().signal;
  expect(await checkBasicSite(signal)).toBe(expected);
  expect(fetcher).toHaveBeenCalledWith(`${BASIC_SITE_URL}/api/health`, { signal, cache: "no-store", credentials: "omit", redirect: "error" });
});
it.each([Response.json({ service: "other", idorEnabled: true }), Response.json({ service: "vulnlab-basic-site" }), new Response("error", { status: 503 }), new Response("not json")])("rejects unrelated or invalid health responses", async response => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  expect(await checkBasicSite(new AbortController().signal)).toBe("unavailable");
});
it.each([new TypeError("offline"), new DOMException("timeout", "AbortError")])("handles network failure and timeout", async error => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
  expect(await checkBasicSite(new AbortController().signal)).toBe("unavailable");
});
