import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { X509Certificate } from "node:crypto";
import { parse } from "dotenv";

const caPath = resolve("certs/supabase-prod-ca-2021.crt").replaceAll("\\", "/");
const ca = new X509Certificate(readFileSync(caPath));
const fingerprint = "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA";
if (!ca.ca || ca.fingerprint256 !== fingerprint || Date.parse(ca.validFrom) > Date.now() || Date.parse(ca.validTo) <= Date.now()) throw new Error("Official CA verification failed");

// Prepare every edit before writing. Preserve endpoints, credentials and other settings.
const edits = [".env", ".env.local"].map(file => {
  let content = readFileSync(file, "utf8"); const values = parse(content);
  const urls = ["DATABASE_URL", "DIRECT_DATABASE_URL"].map(name => {
    const url = new URL(values[name]);
    if (!url.hostname.endsWith(".pooler.supabase.com") || url.searchParams.has("host")) throw new Error("Unexpected database target; no environment files changed");
    return { name, url, original: new URL(values[name]) };
  });
  if (urls[0].url.hostname !== urls[1].url.hostname || urls[0].url.username !== urls[1].url.username || urls[0].url.pathname !== urls[1].url.pathname) throw new Error("Endpoint mismatch; no environment files changed");
  for (const { name, url, original } of urls) {
    for (const key of ["ssl", "sslmode", "sslaccept", "sslcert", "sslrootcert", "sslkey", "sslidentity", "sslpassword", "uselibpqcompat"]) url.searchParams.delete(key);
    url.searchParams.set("sslmode", name === "DATABASE_URL" ? "verify-full" : "require");
    url.searchParams.set(name === "DATABASE_URL" ? "sslrootcert" : "sslcert", caPath);
    if (name === "DIRECT_DATABASE_URL") url.searchParams.set("sslaccept", "strict");
    if (["hostname", "port", "username", "password", "pathname"].some(key => url[key] !== original[key])) throw new Error("Target changed; no environment files changed");
    const pattern = new RegExp(`^(\\s*(?:export\\s+)?)${name}\\s*=[^\\r\\n]*`, "gm");
    if ([...content.matchAll(pattern)].length !== 1) throw new Error("Ambiguous environment entry; no files changed");
    content = content.replace(pattern, (_match, prefix) => `${prefix}${name}=${JSON.stringify(url.toString())}`);
  }
  return { file, content };
});
for (const { file, content } of edits) writeFileSync(file, content);
console.log(JSON.stringify({ updatedFiles: edits.map(e => e.file), targetsAndCredentialsPreserved: true, runtime: "verify-full + sslrootcert", cli: "require + sslaccept=strict + sslcert", caFingerprint: fingerprint }));
