import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";

/** Fail closed for Supabase; never log the connection URL or parser error. */
export function checkedDatabaseUrl(value: string, driver: "pg" | "prisma", environment: Record<string, string | undefined> = process.env): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("DB_CONNECTION_URL_INVALID"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("DB_CONNECTION_URL_INVALID");
  const supabase = url.hostname.endsWith(".pooler.supabase.com") || /^db\.[a-z0-9-]+\.supabase\.co$/.test(url.hostname);
  if (!supabase) return value;
  if (driver === "prisma" && url.hostname.endsWith(".pooler.supabase.com") && url.port === "6543") throw new Error("DB_CLI_SESSION_CONNECTION_REQUIRED");
  if (environment.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("DB_TLS_VERIFICATION_DISABLED");
  const mode = driver === "pg" ? "verify-full" : "require", caKey = driver === "pg" ? "sslrootcert" : "sslcert";
  const allowed = new Set(["sslmode", caKey, ...(driver === "prisma" ? ["sslaccept"] : [])]);
  for (const key of url.searchParams.keys()) {
    if ((key.startsWith("ssl") || key === "uselibpqcompat") && !allowed.has(key)) throw new Error("DB_TLS_SETTINGS_UNSAFE");
    if (url.searchParams.getAll(key).length !== 1) throw new Error("DB_CONNECTION_URL_AMBIGUOUS");
    if (["host", "hostaddr", "port", "user", "password"].includes(key)) throw new Error("DB_CONNECTION_TARGET_OVERRIDE");
  }
  if (url.searchParams.get("sslmode") !== mode || driver === "prisma" && url.searchParams.get("sslaccept") !== "strict") throw new Error("DB_TLS_STRICT_SETTINGS_REQUIRED");
  const path = url.searchParams.get(caKey);
  if (!path) throw new Error("DB_TLS_CA_REQUIRED");
  try {
    const certificate = new X509Certificate(readFileSync(path));
    if (!certificate.ca || Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now()) throw new Error();
  } catch { throw new Error("DB_TLS_CA_INVALID_OR_UNREADABLE"); }
  return value;
}
