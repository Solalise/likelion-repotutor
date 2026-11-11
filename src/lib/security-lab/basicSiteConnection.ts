export const BASIC_SITE_URL = "http://127.0.0.1:4400";
export const IDOR_LAB_URL = `${BASIC_SITE_URL}/lab/idor`;
export type BasicSiteStatus = "checking" | "ready" | "disabled" | "unavailable";

export async function checkBasicSite(signal: AbortSignal): Promise<BasicSiteStatus> {
  try {
    const response = await fetch(`${BASIC_SITE_URL}/api/health`, {
      signal, cache: "no-store", credentials: "omit", redirect: "error",
    });
    if (!response.ok) return "unavailable";
    const body = await response.json();
    if (body?.service !== "vulnlab-basic-site" || typeof body.idorEnabled !== "boolean") return "unavailable";
    return body.idorEnabled ? "ready" : "disabled";
  } catch {
    return "unavailable";
  }
}
