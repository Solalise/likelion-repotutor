// Human-only password prompts in an independent Windows console.
// No password is received by this script, placed in argv/env, or logged.
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, copyFileSync, readdirSync, unlinkSync, rmdirSync, constants } from "node:fs";
import { resolve, join, relative } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawnSync, spawn } from "node:child_process";

const root = "D:/VulnLabBackups/repo-tutor";
const source = resolve(root,"20261120-153624-KST");
const tool = resolve(root,"_tools/7zip-26.06/portable/x64/7za.exe");
const expected = "7eda74601b42d476fee03380b23798a4ec2a266e51d9a17a4c85d252dbce49c9";
const names = ["public.dump","manifest.json","SHA256SUMS.txt","archive-list.txt"];
const stamp = new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date()).replaceAll("-","").replaceAll(":","").replace(" ","-")+"-KST";
const resumeIndex=process.argv.indexOf("--resume");
const resume=resumeIndex>=0;
const directory = resume ? resolve(process.argv[resumeIndex+1]??"") : resolve(root,"encrypted",stamp);
if(!directory.startsWith(resolve(root,"encrypted")+"\\"))throw Error("Unexpected encryption directory");
const encrypted = join(directory,"repo-tutor-public.7z");
const resultFile = resolve(root,"_tools/encryption-session-result.json");
const temp = join(directory,".verify-"+randomUUID());
let stage="STARTING", temporaryCreated=false;
const result={status:"IN_PROGRESS",stage,directory,encryptedArchive:encrypted,method:"7z AES-256",fileNamesEncrypted:true,sourceDirectory:source,originalSha256:expected,startedAtUtc:new Date().toISOString()};
const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
function record(status,extra={}){Object.assign(result,{status,stage,...extra});writeFileSync(resultFile,JSON.stringify(result,null,2)+"\n");}
function powershell(code){return JSON.parse(execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",code],{encoding:"utf8",windowsHide:true}));}
function acl(path){const literal=path.replaceAll("'","''");const r=powershell(`$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$a=Get-Acl -LiteralPath '${literal}';$r=@($a.Access);[pscustomobject]@{currentUserOnly=($r.Count -gt 0 -and @($r|Where-Object {$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $sid -or $_.AccessControlType -ne 'Allow'}).Count -eq 0)}|ConvertTo-Json -Compress`);if(!r.currentUserOnly)throw Error("ACL validation failed");return true;}
function checkDisks(){const r=powershell("$a=Get-Partition -DriveLetter D;$b=Get-Partition -DriveLetter F;$v=Get-Volume -DriveLetter F;[pscustomobject]@{sourceDisk=$a.DiskNumber;copyDisk=$b.DiskNumber;copyRemovable=($v.DriveType -eq 'Removable');copyFreeBytes=$v.SizeRemaining}|ConvertTo-Json -Compress");if(r.sourceDisk===r.copyDisk||!r.copyRemovable||r.copyFreeBytes<1000000)throw Error("Independent USB storage not ready");return r;}
function runInteractive(args){return new Promise((done,fail)=>{
  // stdin remains the real console; Windows 7-Zip disables echo on that handle.
  // Output is shown only in this human console, never written to a log.
  const child=spawn(tool,args,{cwd:source,stdio:["inherit","pipe","pipe"],windowsHide:false});let output="";
  for(const stream of [child.stdout,child.stderr])stream.on("data",chunk=>{process.stdout.write(chunk);if(output.length<100000)output+=chunk.toString();});
  child.on("error",()=>fail(Error("7-Zip could not start")));
  child.on("close",code=>{result.lastToolExitCode=code;result.lastFailureCategory=code===0?null:/wrong password|password is incorrect|can not open encrypted archive/i.test(output)?"PASSWORD_NOT_ACCEPTED":/unsupported method/i.test(output)?"UNSUPPORTED_METHOD":/access is denied|permission denied/i.test(output)?"ACCESS_DENIED":/headers error|data error/i.test(output)?"ARCHIVE_DATA_OR_PASSWORD_ERROR":"OTHER_TOOL_ERROR";if(code===0)done();else fail(Error("7-Zip operation did not succeed"));});
});}
function cleanup(){if(!temporaryCreated||!existsSync(temp))return;const full=resolve(temp);if(!full.startsWith(resolve(directory)+"\\")||!full.includes("\\.verify-"))throw Error("Unsafe cleanup target");const entries=readdirSync(full,{withFileTypes:true});if(entries.some(e=>!e.isFile()||!names.includes(e.name)))throw Error("Unexpected extraction files; manual cleanup required");for(const entry of entries)unlinkSync(join(full,entry.name));rmdirSync(full);temporaryCreated=false;}
try {
  if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error("An independent interactive console is required");
  if(hash(join(source,"public.dump"))!==expected)throw Error("Original backup hash mismatch");
  const originalHashes=Object.fromEntries(names.map(n=>[n,hash(join(source,n))]));
  const originalManifest=JSON.parse(readFileSync(join(source,"manifest.json"),"utf8"));
  if(originalManifest.status!=="VERIFIED_ARCHIVE"||originalManifest.archiveSha256!==expected)throw Error("Original manifest mismatch");
  result.independentStorage=checkDisks();
  mkdirSync(directory,{recursive:true});acl(directory);acl(source);
  if(!resume&&existsSync(encrypted))throw Error("Encrypted archive already exists");
  if(resume&&!existsSync(encrypted))throw Error("Encrypted archive missing");
  console.log("VulnLab backup encryption - password is typed ONLY into 7-Zip's hidden prompts.");
  console.log("Use a unique password of at least 24 characters or 6+ random words. Keep it in your own password manager.");
  console.log("Do not send the password in chat. This script never reads or records it.");
  console.log("You will enter the SAME password for encryption, integrity testing, and local extraction.");
  if(!resume){
    stage="WAITING_FOR_ENCRYPTION_PASSWORD";record("WAITING_FOR_USER");
    await runInteractive(["a","-t7z","-mhe=on","-m0=lzma2","-mx=5","-p",encrypted,...names]);
  }
  if(!existsSync(encrypted)||statSync(encrypted).size<100)throw Error("Encrypted archive missing");
  stage="WAITING_FOR_INTEGRITY_TEST_PASSWORD";record("WAITING_FOR_USER");
  console.log("Step 2: enter the SAME password for the archive integrity test.");
  await runInteractive(["t",encrypted]);
  result.integrityTestPassed=true;
  stage="CHECKING_ENCRYPTED_HEADERS";record("IN_PROGRESS");
  // Closed stdin: listing must fail without a password. Never print the output.
  const noPassword=spawnSync(tool,["l",encrypted],{input:"",encoding:"utf8",timeout:10000,windowsHide:true});
  if(noPassword.error||noPassword.status===0)throw Error("Header encryption was not verified");
  result.headerListingWithoutPasswordRejected=true;
  mkdirSync(temp);temporaryCreated=true;acl(temp);
  stage="WAITING_FOR_LOCAL_DECRYPTION_PASSWORD";record("WAITING_FOR_USER");
  console.log("Step 3: enter the SAME password for temporary LOCAL decryption. No database connection is made.");
  await runInteractive(["x","-y",`-o${temp}`,encrypted]);
  result.decryptedSha256=hash(join(temp,"public.dump"));
  if(result.decryptedSha256!==expected)throw Error("Decrypted dump hash mismatch");
  if(!names.every(n=>hash(join(temp,n))===originalHashes[n]))throw Error("Decrypted metadata mismatch");
  result.allDecryptedFilesMatch=true;
  cleanup();result.temporaryPlaintextRemoved=!existsSync(temp);
  if(!names.every(n=>hash(join(source,n))===originalHashes[n]))throw Error("Original backup changed");
  result.originalFilesUnchanged=true;
  stage="COPYING_ENCRYPTED_ARCHIVE";record("IN_PROGRESS");
  result.independentStorage=checkDisks();
  const copyDirectory=resolve("F:/VulnLabBackups/repo-tutor",stamp);
  if(!relative("F:/VulnLabBackups/repo-tutor",copyDirectory)||relative("F:/VulnLabBackups/repo-tutor",copyDirectory).startsWith(".."))throw Error("Unexpected USB destination");
  mkdirSync(copyDirectory,{recursive:true});
  const copy=join(copyDirectory,"repo-tutor-public.7z");
  copyFileSync(encrypted,copy,constants.COPYFILE_EXCL);
  result.encryptedSha256=hash(encrypted);result.independentCopySha256=hash(copy);
  if(result.encryptedSha256!==result.independentCopySha256)throw Error("USB copy hash mismatch");
  result.independentCopy=copy;result.archiveBytes=statSync(encrypted).size;
  writeFileSync(join(directory,"SHA256SUMS.txt"),`${result.encryptedSha256}  repo-tutor-public.7z\n`,{flag:"wx"});
  writeFileSync(join(copyDirectory,"SHA256SUMS.txt"),`${result.encryptedSha256}  repo-tutor-public.7z\n`,{flag:"wx"});
  result.localArchiveCurrentUserOnly=acl(encrypted);
  result.completedAtUtc=new Date().toISOString();stage="COMPLETE";record("VERIFIED_ENCRYPTED_BACKUP_AND_INDEPENDENT_COPY");
  writeFileSync(join(directory,"encryption-verification.json"),JSON.stringify(result,null,2)+"\n",{flag:"wx"});
  console.log("SUCCESS: encryption, integrity test, decrypted hashes and independent encrypted USB copy verified.");
} catch(error) {
  try{cleanup();result.temporaryPlaintextRemoved=!existsSync(temp);}catch{result.temporaryPlaintextRemoved=false;}
  record("STOPPED_OR_FAILED",{failedStage:stage,errorCode:/^[A-Z0-9_]+$/.test(error?.code??"")?error.code:"USER_ACTION_OR_VERIFICATION_REQUIRED"});
  if(existsSync(directory))writeFileSync(join(directory,"encryption-verification.failed.json"),JSON.stringify(result,null,2)+"\n");
  console.error("Stopped. No successful encrypted backup is claimed. Original backup is retained. Report the stage only, never a password.");
  process.exitCode=1;
}
