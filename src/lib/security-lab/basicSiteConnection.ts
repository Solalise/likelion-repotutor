export const BASIC_SITE_URL = "http://127.0.0.1:4400";
export const IDOR_LAB_URL = `${BASIC_SITE_URL}/?lab=idor`;
export const SQLI_LAB_URL = `${BASIC_SITE_URL}/?lab=sqli`;
export type BasicSiteStatus = "checking" | "unavailable";
export type BasicSiteHealth = { idorEnabled: boolean; sqliEnabled: boolean; xssEnabled?: boolean; authzEnabled?: boolean };
/** Production bundles never probe or launch a visitor's loopback services. */
export function localPracticeAvailable(): boolean { return process.env.NODE_ENV !== "production"; }

export async function checkBasicSite(signal: AbortSignal): Promise<BasicSiteHealth | null> {
  if (!localPracticeAvailable()) return null;
  try {
    const response = await fetch(`${BASIC_SITE_URL}/api/health`, {
      signal, cache: "no-store", credentials: "omit", redirect: "error",
    });
    if (!response.ok) return null;
    const body = await response.json();
    if (body?.service !== "vulnlab-basic-site" || typeof body.idorEnabled !== "boolean" || typeof body.sqliEnabled !== "boolean") return null;
    return { idorEnabled: body.idorEnabled, sqliEnabled: body.sqliEnabled, ...(typeof body.xssEnabled === "boolean" ? { xssEnabled: body.xssEnabled } : {}), ...(typeof body.authzEnabled === "boolean" ? { authzEnabled: body.authzEnabled } : {}) };
  } catch {
    return null;
  }
}
