import { afterEach, expect, it, vi } from "vitest";
import { BASIC_SITE_URL, checkBasicSite } from "./basicSiteConnection";

afterEach(() => vi.unstubAllGlobals());
it.each([[true, true], [true, false], [false, true], [false, false]] as const)("checks IDOR=%s and SQLi=%s activation without sending credentials", async (idorEnabled, sqliEnabled) => {
  const expected = { idorEnabled, sqliEnabled };
  const fetcher = vi.fn().mockResolvedValue(Response.json({ service: "vulnlab-basic-site", ...expected }));
  vi.stubGlobal("fetch", fetcher);
  const signal = new AbortController().signal;
  expect(await checkBasicSite(signal)).toEqual(expected);
  expect(fetcher).toHaveBeenCalledWith(`${BASIC_SITE_URL}/api/health`, { signal, cache: "no-store", credentials: "omit", redirect: "error" });
});
it.each([Response.json({ service: "other", idorEnabled: true, sqliEnabled: true }), Response.json({ service: "vulnlab-basic-site", idorEnabled: true }), new Response("error", { status: 503 }), new Response("not json")])("rejects unrelated or invalid health responses", async response => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  expect(await checkBasicSite(new AbortController().signal)).toBeNull();
});
it.each([new TypeError("offline"), new DOMException("timeout", "AbortError")])("handles network failure and timeout", async error => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
  expect(await checkBasicSite(new AbortController().signal)).toBeNull();
});
