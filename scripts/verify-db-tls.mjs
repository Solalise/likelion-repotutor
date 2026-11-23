// Explicit opt-in: read-only real DB checks; credentials/output remain private.
import { config } from "dotenv";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { checkedDatabaseUrl } from "../src/lib/databaseTls.ts";
import { rootCertificates } from "node:tls";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, unlinkSync, rmdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { lookup } from "node:dns/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

config({ path: [".env.local", ".env"], quiet: true });
if (!process.argv.includes("--read-only")) throw new Error("Explicit --read-only opt-in is required");
let failures = 0;
const report = result => { console.log(JSON.stringify(result)); if(result.passed===false) failures++; };
const code = error => /^[A-Z0-9_]+$/.test(error?.code ?? "") ? error.code : "CHECK_FAILED";
const runtime = checkedDatabaseUrl(process.env.DATABASE_URL, "pg");
const cli = checkedDatabaseUrl(process.env.DIRECT_DATABASE_URL, "prisma");
const temp = mkdtempSync(join(tmpdir(), "vulnlab-tls-")), wrongCa = join(temp, "unrelated-public-root.crt");
writeFileSync(wrongCa, rootCertificates[0]);

async function pgCheck(label, url, expectedError) {
  const client = new Client({connectionString:url,connectionTimeoutMillis:10000,query_timeout:10000});
  client.on("error",()=>{});
  try {
    await client.connect();
    const stream=client.connection.stream;
    if(expectedError) { report({check:label,passed:false,unexpectedConnection:true}); return; }
    if(stream.authorized!==true) { report({check:label,passed:false,authorized:false}); return; }
    await client.query("BEGIN READ ONLY");
    const {rows:[row]}=await client.query("SELECT 1 AS ok, current_setting('transaction_read_only') AS read_only, to_regclass('public.users') IS NOT NULL AS users_present, to_regclass('public.repositories') IS NOT NULL AS repositories_present, to_regclass('public.analysis_runs') IS NOT NULL AS analyses_present, to_regclass('public.security_test_records') IS NOT NULL AS records_present, to_regclass('public._prisma_migrations') IS NOT NULL AS history_present");
    report({check:label,passed:row.ok===1&&row.read_only==="on",authorized:stream.authorized,protocol:stream.getProtocol(),existingTables:{users:row.users_present,repositories:row.repositories_present,analyses:row.analyses_present,securityTestRecord:row.records_present}});
    const {rows:[objects]}=await client.query("SELECT NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('security_test_records','security_test_records_user_id_updated_at_idx','security_test_records_user_id_repository_full_name_kind_sta_idx','security_test_records_pkey')) AS new_object_names_available, (SELECT count(*)=2 FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('users','analysis_runs') AND column_name='id' AND data_type='text') AS foreign_key_column_types_match");
    report({check:"migration-object-preflight-read-only",passed:objects.new_object_names_available&&objects.foreign_key_column_types_match,newObjectNamesAvailable:objects.new_object_names_available,foreignKeyColumnTypesMatch:objects.foreign_key_column_types_match});
    if(row.history_present) {
      const {rows}=await client.query("SELECT migration_name, checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM public._prisma_migrations ORDER BY started_at");
      const local=readdirSync("prisma/migrations",{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>({name:d.name,checksum:createHash("sha256").update(readFileSync(join("prisma/migrations",d.name,"migration.sql"))).digest("hex")}));
      const applied=rows.filter(r=>r.finished&&!r.rolled_back);
      report({check:"migration-history-read-only",passed:true,applied:applied.map(r=>r.migration_name),pending:local.filter(m=>!applied.some(r=>r.migration_name===m.name)).map(m=>m.name),checksumConflicts:local.filter(m=>applied.some(r=>r.migration_name===m.name&&r.checksum!==m.checksum)).map(m=>m.name),unfinished:rows.filter(r=>!r.finished&&!r.rolled_back).map(r=>r.migration_name),appliedWithoutLocalFile:applied.filter(r=>!local.some(m=>m.name===r.migration_name)).map(r=>r.migration_name)});
    } else report({check:"migration-history-read-only",passed:true,historyTablePresent:false});
    await client.query("ROLLBACK");
  } catch(error) { report({check:label,passed:Boolean(expectedError&&expectedError.includes(code(error))),code:code(error),expectedRejection:Boolean(expectedError)}); }
  finally { await client.end().catch(()=>{}); }
}
async function prismaCliCheck(label,url,expectedRejection=false) {
  return new Promise(resolveResult=>{
    const child=spawn(process.execPath,[resolve("node_modules/prisma/build/index.js"),"db","execute","--stdin"],{env:{...process.env,DIRECT_DATABASE_URL:url},windowsHide:true,stdio:["pipe","pipe","pipe"]});
    let output="",done=false;
    const timer=setTimeout(()=>{child.kill();finish({check:label,passed:false,code:"TIMEOUT"});},30000);
    function finish(result){if(done)return;done=true;clearTimeout(timer);report(result);resolveResult();}
    for(const stream of [child.stdout,child.stderr]) stream.on("data",chunk=>{if(output.length<100000)output+=chunk.toString();});
    child.on("error",error=>finish({check:label,passed:false,code:code(error)}));
    child.on("close",status=>{
      const tlsFailure=/P1011|TLS connection|certificate|certification|SSL error|TLS handshake/i.test(output);
      finish({check:label,passed:expectedRejection?status!==0&&tlsFailure:status===0,exitCode:status,expectedRejection,tlsFailure});
    });
    // No DDL/DML. Explicit server-side read-only transaction, always rolled back.
    child.stdin.end("BEGIN READ ONLY; SELECT 1; ROLLBACK;\n");
  });
}
try {
  await pgCheck("pg-runtime-strict",runtime);
  const prisma=new PrismaClient({adapter:new PrismaPg({connectionString:runtime,connectionTimeoutMillis:10000})});
  try {
    const rows=await prisma.$transaction(async tx=>{await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");return tx.$queryRawUnsafe("SELECT 1 AS ok, current_setting('transaction_read_only') AS read_only");},{maxWait:15000,timeout:15000});
    report({check:"PrismaPg-runtime-strict",passed:rows[0]?.ok===1&&rows[0]?.read_only==="on"});
  } catch(error) { report({check:"PrismaPg-runtime-strict",passed:false,code:code(error)}); }
  finally {await prisma.$disconnect();}
  const badCa=new URL(runtime);badCa.searchParams.set("sslrootcert",wrongCa);
  await pgCheck("pg-untrusted-ca-rejected",badCa.toString(),["SELF_SIGNED_CERT_IN_CHAIN","UNABLE_TO_VERIFY_LEAF_SIGNATURE","UNABLE_TO_GET_ISSUER_CERT_LOCALLY"]);
  const badHostname=new URL(runtime);badHostname.hostname=(await lookup(badHostname.hostname,{family:4})).address;
  await pgCheck("pg-wrong-hostname-rejected",badHostname.toString(),["ERR_TLS_CERT_ALTNAME_INVALID"]);
  await prismaCliCheck("Prisma-CLI-strict-read-only",cli);
  const cliBadCa=new URL(cli);cliBadCa.searchParams.set("sslcert",wrongCa);
  await prismaCliCheck("Prisma-CLI-untrusted-ca-rejected",cliBadCa.toString(),true);
  const cliBadHostname=new URL(cli);cliBadHostname.hostname=(await lookup(cliBadHostname.hostname,{family:4})).address;
  await prismaCliCheck("Prisma-CLI-wrong-hostname-rejected",cliBadHostname.toString(),true);
} finally { unlinkSync(wrongCa); rmdirSync(temp); }
process.exitCode=failures?1:0;
