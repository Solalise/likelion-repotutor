import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { beforeEach, expect, it, vi } from "vitest";
function event() { const listeners: Array<(value?: unknown) => void> = []; return { addListener: (fn: (value?: unknown) => void) => listeners.push(fn), emit: (value?: unknown) => listeners.forEach(fn => fn(value)) }; }
function port(origin = "http://localhost:3000/services", name = "vulnlab-review-v1", internal = false) {
  const p = { name, sender: internal ? { id: "own-extension" } : { url: origin, tab: { id: 1 } }, onMessage: event(), onDisconnect: event(), postMessage: vi.fn(), disconnect: vi.fn() };
  p.disconnect.mockImplementation(() => p.onDisconnect.emit()); return p;
}
const session = { protocol: "vulnlab-review-v1", id: "own:sha:7", project: "org/app", commit: "a".repeat(40), site: "https://sandbox.example.org", guides: ["SQL_INJECTION", "XSS", "IDOR", "AUTHORIZATION"].map(kind => ({ kind })) };
let external: ReturnType<typeof event>, internal: ReturnType<typeof event>, create: ReturnType<typeof vi.fn>;
beforeEach(() => {
  external = event(); internal = event(); create = vi.fn().mockResolvedValue({});
  const script = readFileSync("extensions/vulnlab/background.js", "utf8").replace('import { appOrigins } from "./config.js";', 'const appOrigins = ["http://localhost:3000"];');
  runInNewContext(script, { URL, chrome: { runtime: { id: "own-extension", onConnectExternal: external, onConnect: internal }, sidePanel: { setPanelBehavior: vi.fn().mockResolvedValue({}) }, tabs: { create } } });
});
it("rejects wrong origins, ports, protocols and extension callers", () => {
  for (const address of ["https://untrusted.example", "http://localhost:4000/services"]) { const p = port(address); external.emit(p); expect(p.disconnect).toHaveBeenCalledOnce(); }
  const p = port(); external.emit(p); p.onMessage.emit({ type: "SESSION", session: { ...session, site: "javascript:alert(1)" } }); expect(p.disconnect).toHaveBeenCalledOnce();
  const caller = port("", "vulnlab-panel", true); caller.sender.id = "another-extension"; internal.emit(caller); expect(caller.disconnect).toHaveBeenCalledOnce();
});
it("reports explicit site-open failures to the same session", async () => {
  create.mockRejectedValueOnce(new Error("Cannot open"));
  const web = port(); external.emit(web); web.onMessage.emit({ type: "SESSION", session });
  const panel = port("", "vulnlab-panel", true); internal.emit(panel); panel.onMessage.emit({ type: "OPEN_SITE" });
  web.onMessage.emit({ type: "OPEN_CONFIRMED", sessionId: session.id });
  await vi.waitFor(() => expect(panel.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "ERROR", sessionId: session.id })));
});
it("connects site-free educational guides but does not navigate without a registered site", () => {
  const web = port(); external.emit(web); web.onMessage.emit({ type: "SESSION", session: { ...session, site: null } });
  expect(web.postMessage).toHaveBeenLastCalledWith({ type: "READY" });
  const panel = port("", "vulnlab-panel", true); internal.emit(panel); panel.onMessage.emit({ type: "OPEN_SITE" });
  web.onMessage.emit({ type: "OPEN_CONFIRMED", sessionId: session.id });
  expect(create).not.toHaveBeenCalled();
});
it("opens only the session URL after explicit user request and fresh page confirmation", () => {
  const web = port(); external.emit(web); web.onMessage.emit({ type: "SESSION", session });
  expect(create).not.toHaveBeenCalled();
  web.onMessage.emit({ type: "OPEN_CONFIRMED", sessionId: session.id }); expect(create).not.toHaveBeenCalled();
  const panel = port("", "vulnlab-panel", true); internal.emit(panel); panel.onMessage.emit({ type: "OPEN_SITE", url: "https://attacker.example" });
  expect(web.postMessage).toHaveBeenLastCalledWith({ type: "OPEN_SITE", sessionId: session.id }); expect(create).not.toHaveBeenCalled();
  web.onMessage.emit({ type: "OPEN_CONFIRMED", sessionId: "wrong" }); expect(create).not.toHaveBeenCalled();
  web.onMessage.emit({ type: "OPEN_CONFIRMED", sessionId: session.id, url: "https://attacker.example" }); expect(create).toHaveBeenCalledExactlyOnceWith({ url: session.site });
});
it("forwards bounded manual records to the authenticated bridge and clears on disconnect", () => {
  const web = port(); external.emit(web); web.onMessage.emit({ type: "SESSION", session });
  const panel = port("", "vulnlab-panel", true); internal.emit(panel);
  panel.onMessage.emit({ type: "SAVE", kind: "XSS", sessionId: "spoofed", review: { observed: "synthetic" } });
  expect(web.postMessage).toHaveBeenLastCalledWith({ type: "SAVE", kind: "XSS", sessionId: session.id, review: { observed: "synthetic" } });
  web.onMessage.emit({ type: "SAVED", sessionId: session.id, kind: "XSS", id: "record-1" }); expect(panel.postMessage).toHaveBeenLastCalledWith({ type: "SAVED", sessionId: session.id, kind: "XSS", id: "record-1" });
  web.disconnect(); expect(panel.postMessage).toHaveBeenLastCalledWith({ type: "DISCONNECTED" });
  const calls = web.postMessage.mock.calls.length; panel.onMessage.emit({ type: "SAVE" }); expect(web.postMessage).toHaveBeenCalledTimes(calls);
});
it("ships MV3 sidePanel-only permissions and no host or content access", () => {
  const manifest = JSON.parse(readFileSync("extensions/vulnlab/manifest.json", "utf8"));
  expect(manifest.manifest_version).toBe(3); expect(manifest.permissions).toEqual(["sidePanel"]);
  expect(manifest.host_permissions).toBeUndefined(); expect(manifest.content_scripts).toBeUndefined();
  for (const path of [manifest.side_panel.default_path, manifest.background.service_worker]) expect(readFileSync(`extensions/vulnlab/${path}`, "utf8").length).toBeGreaterThan(0);
});
