/* global chrome */
import { appOrigins } from "./config.js";

let bridge = null;
let session = null;
let pendingOpen = false;
const panels = new Set();
const broadcast = message => { for (const panel of panels) { try { panel.postMessage(message); } catch { panels.delete(panel); } } };
const reset = () => { session = null; pendingOpen = false; broadcast({ type: "DISCONNECTED" }); };
const forward = message => { if (bridge && session) bridge.postMessage({ ...message, sessionId: session.id }); };
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onConnectExternal.addListener(port => {
  let origin;
  try { origin = new URL(port.sender?.url).origin; } catch { port.disconnect(); return; }
  if (port.name !== "vulnlab-review-v1" || !appOrigins.includes(origin) || !port.sender?.tab
    || port.sender.origin && port.sender.origin !== origin) { port.disconnect(); return; }
  if (bridge) bridge.disconnect(); reset(); bridge = port;
  port.onDisconnect.addListener(() => { if (bridge === port) { bridge = null; reset(); } });
  port.onMessage.addListener(message => {
    if (bridge !== port || !message || typeof message !== "object") return;
    if (message.type === "SESSION") {
      const next = message.session;
      try {
        const site = next.site === null ? null : new URL(next.site);
        if (JSON.stringify(next).length > 250000 || next.protocol !== "vulnlab-review-v1" || typeof next.id !== "string"
          || !/^[a-f0-9]{40,64}$/i.test(next.commit) || site && (site.protocol !== "https:" || site.username || site.password || site.search || site.hash)
          || !Array.isArray(next.guides) || next.guides.length !== 4
          || ["SQL_INJECTION", "XSS", "IDOR", "AUTHORIZATION"].some(kind => !next.guides.some(g => g.kind === kind))) throw new Error();
        session = next; port.postMessage({ type: "READY" }); broadcast({ type: "SESSION", session });
      } catch { port.disconnect(); }
      return;
    }
    if (!session) return;
    if (message.type === "REQUEST_OPEN" && session.site) { pendingOpen = true; forward({ type: "OPEN_SITE" }); return; }
    if (message.sessionId !== session.id) return;
    if (message.type === "OPEN_CONFIRMED" && pendingOpen && session.site) {
      pendingOpen = false;
      // Ordinary navigation to the stored URL; not ownership verification or test authorization.
      const sessionId = session.id;
      chrome.tabs.create({ url: session.site }).catch(() => broadcast({ type: "ERROR", sessionId, message: "사이트를 열지 못했습니다." }));
    }
    if (message.type === "SAVED" && ["SQL_INJECTION", "XSS", "IDOR", "AUTHORIZATION"].includes(message.kind) && session.recordProgress) {
      session.recordProgress.current = [...new Set([...session.recordProgress.current, message.kind])];
    }
    if (["SAVED", "ERROR"].includes(message.type)) { pendingOpen = false; broadcast(message); }
  });
});

chrome.runtime.onConnect.addListener(port => {
  if (port.sender?.id !== chrome.runtime.id || port.name !== "vulnlab-panel") { port.disconnect(); return; }
  panels.add(port);
  port.postMessage(session && bridge ? { type: "SESSION", session } : { type: "DISCONNECTED" });
  port.onDisconnect.addListener(() => panels.delete(port));
  port.onMessage.addListener(message => {
    if (message?.type === "PING") { port.postMessage({ type: "PONG" }); return; }
    if (!bridge || !session) { port.postMessage({ type: "DISCONNECTED" }); return; }
    if (message?.type === "OPEN_SITE" && session.site) { pendingOpen = true; forward({ type: "OPEN_SITE" }); }
    if (message?.type === "SAVE" && JSON.stringify(message).length < 16000) forward(message);
  });
});
