import { mkdirSync, writeFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";

// Same public CA source as Supabase Dashboard (production environment):
// https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json
const source = "https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt";
const response = await fetch(source, { signal: AbortSignal.timeout(15000), redirect: "error" });
if (!response.ok || response.url !== source) throw new Error("Official CA download failed");
const pem = await response.text(), ca = new X509Certificate(pem);
if (!ca.ca || !ca.verify(ca.publicKey) || !ca.subject.includes("Supabase") || Date.parse(ca.validTo) <= Date.now()) throw new Error("Invalid official CA");
if (ca.fingerprint256 !== "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA") throw new Error("Official CA changed; review provider rotation before replacing the trusted file");
mkdirSync("certs", { recursive: true });
writeFileSync("certs/supabase-prod-ca-2021.crt", pem);
console.log(JSON.stringify({ officialDownload: true, subject: ca.subject, issuer: ca.issuer, validFrom: ca.validFrom, validTo: ca.validTo, fingerprint256: ca.fingerprint256 }));
