"use client";

const EVENT = "vulnlab:vercel-connection-changed";
const CHANNEL = "vulnlab-vercel-connection";

/** Non-secret invalidation only; nothing is persisted to browser storage. */
export function notifyVercelChanged() {
  window.dispatchEvent(new Event(EVENT));
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel(CHANNEL);
      channel.postMessage("changed");
      channel.close();
    } catch { /* Same-tab invalidation remains available when cross-tab messaging is blocked. */ }
  }
}

export function subscribeVercelChanged(refresh: () => void) {
  window.addEventListener(EVENT, refresh);
  let channel: BroadcastChannel | undefined;
  try { channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : undefined; }
  catch { /* Users can refresh another tab manually if the browser blocks messaging. */ }
  if (channel) channel.onmessage = event => { if (event.data === "changed") refresh(); };
  return () => { window.removeEventListener(EVENT, refresh); channel?.close(); };
}
