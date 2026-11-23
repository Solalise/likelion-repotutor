// Compare backup COPY values with live values in memory. Never print row data.
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Client } from "pg";
import { checkedDatabaseUrl } from "../src/lib/databaseTls.ts";
config({path:[".env.local",".env"],quiet:true});
const directory="D:/VulnLabBackups/repo-tutor/20261120-153624-KST";
const bytes=readFileSync(directory+"/public.dump");
if(createHash("sha256").update(bytes).digest("hex")!=="7eda74601b42d476fee03380b23798a4ec2a266e51d9a17a4c85d252dbce49c9")throw Error("Backup hash mismatch");
const cleanEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>["systemroot","windir","path","temp","tmp"].includes(k.toLowerCase())));
const restored=spawnSync("D:/VulnLabBackups/repo-tutor/_tools/pgsql-17.12/pgsql/bin/pg_restore.exe",["--data-only","--file=-",directory+"/public.dump"],{env:cleanEnv,encoding:"utf8",maxBuffer:20*1024*1024,windowsHide:true});
if(restored.status!==0||restored.stderr.trim())throw Error("Offline archive read failed");
function field(value){
  if(value==="\\N")return null;
  return value.replace(/\\([0-7]{1,3}|x[0-9a-fA-F]{1,2}|.)/g,(_m,c)=>{
    if(/^[0-7]+$/.test(c))return String.fromCharCode(parseInt(c,8));
    if(/^x[0-9a-f]+$/i.test(c))return String.fromCharCode(parseInt(c.slice(1),16));
    return ({b:"\b",f:"\f",n:"\n",r:"\r",t:"\t",v:"\v","\\":"\\"})[c]??c;
  });
}
const tables=new Map();let current;
for(const line of restored.stdout.split(/\r?\n/)){
  const start=/^COPY public\.([a-z_]+) \(([^)]+)\) FROM stdin;$/.exec(line);
  if(start){const columns=start[2].split(", ").map(s=>s.replace(/^"|"$/g,""));if(columns.some(c=>!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(c)))throw Error("Unsupported archive columns");current={name:start[1],columns,rows:[]};tables.set(start[1],current);continue;}
  if(current&&line==="\\."){current=undefined;continue;}
  if(current){const row=line.split("\t").map(field);if(row.length!==current.columns.length)throw Error("Unsupported COPY row format");current.rows.push(row);}
}
if(current)throw Error("Incomplete COPY data");
const manifest=JSON.parse(readFileSync(directory+"/manifest.json","utf8"));
if(tables.size!==manifest.tables.length||manifest.tables.some(t=>!tables.has(t.name)))throw Error("Backup table coverage mismatch");
const digest=rows=>createHash("sha256").update(rows.map(r=>JSON.stringify(r)).sort().join("\n")).digest("hex");
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const url=new URL(checkedDatabaseUrl(process.env.DIRECT_DATABASE_URL,"prisma")),ca=url.searchParams.get("sslcert");url.searchParams.delete("sslcert");url.searchParams.delete("sslaccept");url.searchParams.set("sslmode","verify-full");url.searchParams.set("sslrootcert",ca);
const client=new Client({connectionString:url.toString(),connectionTimeoutMillis:15000,query_timeout:15000});client.on("error",()=>{});
try{
  await client.connect();await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL TIME ZONE 'UTC'");await client.query("SET LOCAL DateStyle='ISO, YMD'");await client.query("SET LOCAL IntervalStyle='postgres'");await client.query("SET LOCAL extra_float_digits=3");await client.query("SET LOCAL bytea_output='hex'");
  const {rows:metadata}=await client.query("SELECT table_name,column_name,udt_name FROM information_schema.columns WHERE table_schema='public'");
  const comparisons=[];
  for(const t of tables.values()){
    const {rows}=await client.query(`SELECT ARRAY[${t.columns.map(c=>quote(c)+"::text").join(",")}] AS fields FROM public.${quote(t.name)}`);
    let values=rows.map(r=>r.fields.map((v,i)=>metadata.some(m=>m.table_name===t.name&&m.column_name===t.columns[i]&&m.udt_name==="bool")?(v===null?null:v==="true"?"t":"f"):v));
    if(process.argv.includes("--after-approved-migration")&&t.name==="_prisma_migrations"){
      const name=t.columns.indexOf("migration_name"),checksum=t.columns.indexOf("checksum"),finished=t.columns.indexOf("finished_at"),rolledBack=t.columns.indexOf("rolled_back_at");
      const added=values.filter(v=>v[name]==="20261119000100_security_test_records");
      if(added.length!==1||added[0][checksum]!=="817d115b257e654cf9f7325f90a3f7b2cb300317637d0cc00f612b42aea49e22"||!added[0][finished]||added[0][rolledBack]!==null)throw Error("Approved migration history mismatch");
      values=values.filter(v=>v[name]!=="20261119000100_security_test_records");
    }
    comparisons.push({table:t.name,backupRows:t.rows.length,currentRows:values.length,contentMatched:digest(t.rows)===digest(values)});
  }
  await client.query("ROLLBACK");const changed=comparisons.filter(t=>!t.contentMatched);
  console.log(JSON.stringify({check:"full-public-backup-content-comparison",allTablesMatched:changed.length===0,tableCount:comparisons.length,comparisons}));
  if(changed.length)process.exitCode=2;
}catch(error){console.log(JSON.stringify({check:"full-public-backup-content-comparison",errorCode:/^[A-Z0-9_]+$/.test(error?.code??"")?error.code:"COMPARISON_FAILED"}));process.exitCode=1;}
finally{await client.end().catch(()=>{});}
