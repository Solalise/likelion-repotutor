// Read-only PostgreSQL TLS handshake. No authentication message or SQL is sent.
import { readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { connect, getCACertificates } from "node:tls";
import { parse } from "dotenv";

const files = Object.fromEntries([".env", ".env.local"].map(path => {
  try { return [path, parse(readFileSync(path))]; } catch { return [path, {}]; }
}));
const settings = { ...files[".env"], ...files[".env.local"], ...process.env };
const safeCode = error => /^[A-Z0-9_]+$/.test(error?.code ?? "") ? error.code : "CONNECTION_FAILED";
function describeUrl(value, name) {
  if (!value) return { present: false };
  try {
    const url = new URL(value);
    return { present: true, supabase: /\.(?:supabase\.co|pooler\.supabase\.com)$/.test(url.hostname),
      pooler: url.hostname.endsWith(".pooler.supabase.com"), port: url.port || "5432",
      sslmode: url.searchParams.get("sslmode"), caConfigured: url.searchParams.has("sslrootcert") || url.searchParams.has("sslcert"),
      sslaccept: url.searchParams.get("sslaccept"), fileValuesAgree: files[".env"][name] === files[".env.local"][name] };
  } catch { return { present: true, invalid: true }; }
}
console.log(JSON.stringify({ node: process.version, caCounts: Object.fromEntries(["default", "bundled", "system", "extra"].map(k => [k,getCACertificates(k).length])),
  runtime: describeUrl(settings.DATABASE_URL,"DATABASE_URL"), cli: describeUrl(settings.DIRECT_DATABASE_URL || settings.DATABASE_URL,"DIRECT_DATABASE_URL"),
  processDbOverride: Boolean(process.env.DATABASE_URL || process.env.DIRECT_DATABASE_URL),
  bypassConfigured: settings.NODE_TLS_REJECT_UNAUTHORIZED === "0" || settings.PGSSLMODE === "no-verify",
  globalCustomCaConfigured: Boolean(settings.NODE_EXTRA_CA_CERTS || settings.PGSSLROOTCERT || settings.SSL_CERT_FILE),
}));

function certificate(socket) {
  const peer = socket.getPeerCertificate(true), chain = [], seen = new Set(); let item = peer;
  while (item?.fingerprint256 && !seen.has(item.fingerprint256)) {
    seen.add(item.fingerprint256);
    chain.push({ issuer: item.issuer, subjectOrganization: item.subject?.O, fingerprint256: item.fingerprint256, validFrom: item.valid_from, validTo: item.valid_to });
    item = item.issuerCertificate;
  }
  return chain;
}
export function handshake(value, ca) {
  return new Promise(resolve => {
    const url = new URL(value), socket = createConnection({ host:url.hostname, port:Number(url.port || 5432) });
    let secure, done = false;
    const timer = setTimeout(()=>finish({ok:false,code:"TIMEOUT"}),10000);
    function finish(result) { if(done) return; done=true; clearTimeout(timer); secure?.destroy(); socket.destroy(); resolve(result); }
    socket.on("error",error=>finish({ok:false,code:safeCode(error)}));
    socket.once("connect",()=>{ const request=Buffer.alloc(8); request.writeInt32BE(8); request.writeInt32BE(80877103,4); socket.write(request); });
    socket.once("data",data=>{
      if(data.length!==1||data.toString()!=="S") return finish({ok:false,code:"TLS_NOT_OFFERED"});
      secure=connect({socket,servername:url.hostname,rejectUnauthorized:true,minVersion:"TLSv1.2",...(ca?{ca}: {})});
      secure.once("secureConnect",()=>finish({ok:secure.authorized,protocol:secure.getProtocol(),chain:certificate(secure)}));
      secure.once("error",error=>finish({ok:false,code:safeCode(error),chain:certificate(secure)}));
    });
  });
}
let ca;
if(process.argv.includes("--official-ca")) ca=readFileSync("certs/supabase-prod-ca-2021.crt","utf8");
for(const name of ["DATABASE_URL","DIRECT_DATABASE_URL"]) {
  if(!settings[name]) continue;
  console.log(JSON.stringify({endpoint:name,trust:ca?"official-ca":"node-default",...await handshake(settings[name],ca)}));
}
