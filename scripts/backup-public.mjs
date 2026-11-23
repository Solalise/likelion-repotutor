// Explicit local backup only. No restore, DDL, DML or migration commands.
import { config } from "dotenv";
import { Client } from "pg";
import { checkedDatabaseUrl } from "../src/lib/databaseTls.ts";
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, renameSync, unlinkSync, createReadStream } from "node:fs";
import { join, resolve, relative } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";

if (!process.argv.includes("--approved-local-backup")) throw new Error("Explicit backup approval flag required");
config({ path: [".env.local", ".env"], quiet: true });
const root = resolve("D:/VulnLabBackups/repo-tutor");
const toolBin = join(root, "_tools/pgsql-17.12/pgsql/bin");
const pgDump = join(toolBin, "pg_dump.exe"), pgRestore = join(toolBin, "pg_restore.exe");
const stamp = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date()).replaceAll("-", "").replaceAll(":", "").replace(" ", "-") + "-KST";
const directory = join(root, stamp), partial = join(directory, "public.dump.partial"), archive = join(directory, "public.dump"), passFile = join(directory, ".temporary-pgpass");
const workspace = resolve(process.cwd());
if (directory === workspace || !relative(workspace, directory).startsWith("..") || !directory.startsWith(root + "\\")) throw new Error("Backup target is not outside the workspace");
if (existsSync(directory)) throw new Error("Backup directory already exists");
mkdirSync(directory);

function aclCheck(path) {
  const literal = path.replaceAll("'", "''");
  const command = `$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $acl=Get-Acl -LiteralPath '${literal}'; $rules=@($acl.Access); [pscustomobject]@{onlyCurrentUser=($rules.Count -gt 0 -and @($rules | Where-Object {$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $sid -or $_.AccessControlType -ne 'Allow'}).Count -eq 0);ruleCount=$rules.Count} | ConvertTo-Json -Compress`;
  const result = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8", windowsHide: true }));
  if (!result.onlyCurrentUser) throw new Error("Backup ACL validation failed");
  return result;
}
async function sha256(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => ["systemroot", "windir", "path", "temp", "tmp", "userprofile", "appdata", "localappdata", "comspec", "pathext"].includes(key.toLowerCase())));
function run(file, args, environment, capture = false) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(file, args, { env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", diagnostics = "", bytes = 0;
    const timer = setTimeout(() => child.kill(), 120000);
    child.stdout.on("data", chunk => { bytes += chunk.length; if (capture && output.length < 1000000) output += chunk.toString(); });
    child.stderr.on("data", chunk => { if (diagnostics.length < 100000) diagnostics += chunk.toString(); });
    child.on("error", () => { clearTimeout(timer); reject(new Error("Client tool failed to start")); });
    child.on("close", status => { clearTimeout(timer); resolveResult({ exitCode: status, output, diagnostics, outputBytes: bytes }); });
  });
}
function checkRun(result) {
  // Never print client diagnostics: they can contain connection metadata or data.
  if (result.exitCode !== 0 || result.diagnostics.trim()) throw new Error("Client command failed or emitted diagnostics; backup is not verified");
}
const quote = value => '"' + value.replaceAll('"', '""') + '"';
async function counts(client, names) {
  const result = {};
  for (const name of names) {
    const { rows: [row] } = await client.query(`SELECT count(*)::text AS count FROM public.${quote(name)}`);
    result[name] = row.count;
  }
  return result;
}

let client, stage = "directory-acl";
const manifest = { status: "IN_PROGRESS", startedAtUtc: new Date().toISOString(), scope: "public schema only", archiveFormat: "PostgreSQL custom", directory, productionRestorePerformed: false, migrationsExecuted: false };
try {
  manifest.directoryAcl = aclCheck(directory);
  stage = "connection-settings";
  const original = new URL(checkedDatabaseUrl(process.env.DIRECT_DATABASE_URL, "prisma"));
  if (original.port === "6543") throw new Error("Session/direct connection required");
  const caPath = original.searchParams.get("sslcert"), ca = new X509Certificate(readFileSync(caPath));
  const source = new URL(original);
  source.searchParams.delete("sslcert"); source.searchParams.delete("sslaccept");
  source.searchParams.set("sslmode", "verify-full"); source.searchParams.set("sslrootcert", caPath);
  manifest.caFingerprint256 = ca.fingerprint256;
  manifest.tlsMode = "verify-full";
  const dumpVersion = execFileSync(pgDump, ["--version"], { encoding: "utf8", windowsHide: true }).trim();
  const restoreVersion = execFileSync(pgRestore, ["--version"], { encoding: "utf8", windowsHide: true }).trim();
  manifest.tools = { pgDump: dumpVersion, pgRestore: restoreVersion, sourcePage: "https://www.enterprisedb.com/download-postgresql-binaries?lang=en", archiveSource: "https://get.enterprisedb.com/postgresql/postgresql-17.12-2-windows-x64-binaries.zip", pgDumpSha256: await sha256(pgDump), pgRestoreSha256: await sha256(pgRestore) };
  stage = "read-only-snapshot";
  client = new Client({ connectionString: source.toString(), connectionTimeoutMillis: 15000, query_timeout: 20000 });
  client.on("error", () => {});
  await client.connect();
  if (client.connection.stream.authorized !== true) throw new Error("TLS connection not authorized");
  manifest.tlsProtocol = client.connection.stream.getProtocol();
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL statement_timeout = '15s'");
  const { rows: [server] } = await client.query("SELECT current_setting('server_version') AS version, current_setting('server_version_num')::int AS version_num, current_setting('transaction_read_only') AS read_only, transaction_timestamp() AS snapshot_at, pg_export_snapshot() AS snapshot");
  if (server.read_only !== "on" || Math.floor(server.version_num / 10000) !== 17 || !dumpVersion.includes("17.12") || !restoreVersion.includes("17.12")) throw new Error("Unexpected PostgreSQL version or transaction mode");
  manifest.serverVersion = server.version;
  manifest.snapshotAtUtc = server.snapshot_at.toISOString();
  const { rows: tables } = await client.query("SELECT c.relname AS name, c.relkind AS kind, EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e') AS extension_owned FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname");
  const names = tables.map(t => t.name);
  if (!["users", "repositories", "analysis_runs", "_prisma_migrations"].every(name => names.includes(name))) throw new Error("Required source tables missing");
  manifest.tables = tables;
  manifest.rowCountsBefore = await counts(client, names);
  stage = "pg-dump";
  const escape = value => value.replaceAll("\\", "\\\\").replaceAll(":", "\\:");
  writeFileSync(passFile, [original.hostname, original.port || "5432", decodeURIComponent(original.pathname.slice(1)), decodeURIComponent(original.username), decodeURIComponent(original.password)].map(escape).join(":") + "\n", { flag: "wx" });
  aclCheck(passFile);
  const databaseEnvironment = { ...cleanEnv, PGHOST: original.hostname, PGPORT: original.port || "5432", PGDATABASE: decodeURIComponent(original.pathname.slice(1)), PGUSER: decodeURIComponent(original.username), PGPASSFILE: passFile, PGSSLMODE: "verify-full", PGSSLROOTCERT: caPath, PGCONNECT_TIMEOUT: "15", PGAPPNAME: "vulnlab-pre-migration-backup", PGOPTIONS: "-c default_transaction_read_only=on" };
  const dump = await run(pgDump, ["--format=custom", "--schema=public", "--compress=gzip:6", "--lock-wait-timeout=10000", `--snapshot=${server.snapshot}`, `--file=${partial}`, "--no-password"], databaseEnvironment);
  checkRun(dump);
  manifest.pgDumpExitCode = dump.exitCode;
  unlinkSync(passFile);
  await client.query("ROLLBACK");
  stage = "pg-restore-list-offline";
  // No database option and no PG connection environment: never connects to DB.
  const list = await run(pgRestore, ["--list", partial], cleanEnv, true);
  checkRun(list);
  const missing = tables.filter(t => t.kind === "r" && !t.extension_owned && !list.output.split(/\r?\n/).some(line => line.includes(` TABLE DATA public ${t.name} `))).map(t => t.name);
  if (missing.length || !list.output.includes(" TABLE DATA public _prisma_migrations ")) throw new Error("Archive table data coverage incomplete");
  writeFileSync(join(directory, "archive-list.txt"), list.output, { flag: "wx" });
  manifest.archiveListEntries = list.output.split(/\r?\n/).filter(line => /^\d+;/.test(line)).length;
  manifest.tableDataCoverageComplete = true;
  stage = "pg-restore-full-read-offline";
  // Render every archived item to the Windows null device, without executing SQL.
  const fullRead = await run(pgRestore, ["--file=NUL", partial], cleanEnv);
  checkRun(fullRead);
  manifest.offlineFullReadExitCode = fullRead.exitCode;
  stage = "post-backup-row-counts";
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL statement_timeout = '15s'");
  manifest.rowCountsAfter = await counts(client, names);
  await client.query("ROLLBACK");
  manifest.rowCountsUnchanged = names.every(name => manifest.rowCountsBefore[name] === manifest.rowCountsAfter[name]);
  stage = "archive-hash";
  if (readFileSync(partial).subarray(0,5).toString() !== "PGDMP" || statSync(partial).size < 100) throw new Error("Invalid custom archive");
  const hash = await sha256(partial);
  renameSync(partial, archive);
  writeFileSync(join(directory, "SHA256SUMS.txt"), `${hash}  public.dump\n`, { flag: "wx" });
  if (await sha256(archive) !== hash) throw new Error("Archive SHA-256 reread mismatch");
  manifest.archiveSha256 = hash;
  manifest.archiveBytes = statSync(archive).size;
  manifest.archiveFile = "public.dump";
  manifest.archiveAcl = aclCheck(archive);
  manifest.hashRereadMatched = true;
  manifest.storageEncryption = "Not enabled by this script; NTFS ACL protection only. Encrypt before off-device storage.";
  manifest.actualRestoreTested = false;
  manifest.completedAtUtc = new Date().toISOString();
  manifest.status = "VERIFIED_ARCHIVE";
  writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest,null,2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status: manifest.status, directory, archive, archiveBytes: manifest.archiveBytes, sha256: hash, hashRereadMatched: true, currentUserOnly: manifest.archiveAcl.onlyCurrentUser, tableCount: tables.length, archiveListEntries: manifest.archiveListEntries, fullArchiveReadPassed: true, rowCountsUnchanged: manifest.rowCountsUnchanged, majorTableCountsBefore: { users: manifest.rowCountsBefore.users, repositories: manifest.rowCountsBefore.repositories, analysis_runs: manifest.rowCountsBefore.analysis_runs }, majorTableCountsAfter: { users: manifest.rowCountsAfter.users, repositories: manifest.rowCountsAfter.repositories, analysis_runs: manifest.rowCountsAfter.analysis_runs }, serverVersion: manifest.serverVersion, dumpVersion, restoreVersion, actualRestoreTested: false }));
} catch (error) {
  manifest.status = "FAILED"; manifest.failedStage = stage; manifest.completedAtUtc = new Date().toISOString();
  try { writeFileSync(join(directory,"manifest.failed.json"),JSON.stringify(manifest,null,2)+"\n"); } catch {}
  console.log(JSON.stringify({status:"FAILED",stage,directory,errorCode:/^[A-Z0-9_]+$/.test(error?.code??"")?error.code:"BACKUP_NOT_VERIFIED"}));
  process.exitCode=1;
} finally {
  if (existsSync(passFile)) unlinkSync(passFile);
  if (client) { await client.query("ROLLBACK").catch(()=>{}); await client.end().catch(()=>{}); }
}
