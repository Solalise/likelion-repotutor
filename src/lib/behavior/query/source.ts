import {requireUserId} from "@/lib/auth/currentUser";
import {requireRepositoryAccess,RepositoryAccessError} from "@/lib/github/repositoryAccess";
import {requirePublicRepositoryAccess} from "@/lib/github/publicRepositoryAccess";
import {getInstallationAccessToken,createInstallationFetcher} from "@/lib/github/appAuthentication";
import {db} from "@/lib/db";
import {getGithubAnalysisCache,deleteGithubAnalysisCache,githubAnalysisCacheKey,retainGithubAnalysisVersion} from "@/lib/repository/githubAnalysisCache";
import {parseGithubRepositoryUrl} from "@/lib/repository/loadGithubRepository";
import {loadSampleAnalysis} from "@/lib/repository/sampleAnalysis";
import {analysisWorkPending} from "@/lib/repository/analysisWork";
import {QueryError,observeVersion,type QuerySubject} from "./store";

async function head(repository:string,fetcher:typeof fetch=fetch):Promise<string> {
 const response=await fetcher(`https://api.github.com/repos/${repository}/commits/HEAD`,{headers:{Accept:"application/vnd.github+json","User-Agent":"RepoTutor"},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new QueryError("ACCESS_UNVERIFIABLE","Cannot verify repository HEAD",503,true);
 const payload=await response.json() as {sha?:unknown};
 if(typeof payload.sha!=="string"||!/^[a-f0-9]{40}$/i.test(payload.sha))throw new QueryError("ACCESS_UNVERIFIABLE","Invalid repository HEAD metadata",503,true);
 return payload.sha.toLowerCase();
}
function requireMetadata(subject:QuerySubject,key:string){
 const a=subject.analysis;
 if(!a.entryPoints||!a.functionControlFlows||!a.reactEventBindings||!a.httpRequests||!a.databaseAccess||!a.serverResponses){deleteGithubAnalysisCache(key);throw new QueryError("UNSUPPORTED_ANALYSIS","Rerun analysis to supply current behavior metadata",422,true);}
 return subject;
}
export async function resolveQuerySubject(params:URLSearchParams):Promise<{subject:QuerySubject;revalidate:()=>Promise<void>}> {
 const source=params.get("source")??"sample";
 if(source==="sample"){
  if(params.has("url")||params.has("connectionId"))throw new QueryError("INVALID_INPUT","Sample does not accept repository identifiers");
  const {analysis,version,key}=await loadSampleAnalysis();
  observeVersion("sample",version);retainGithubAnalysisVersion("behavior-sample@",key);
  return {subject:requireMetadata({scope:"sample",version,source:"sample",analysis},key),revalidate:async()=>{}};
 }
 if(source==="connected"){
  if(params.has("url"))throw new QueryError("INVALID_INPUT","Connected source does not accept url");
  const connectionId=params.get("connectionId");if(!connectionId||!/^[-\w]{1,160}$/.test(connectionId))throw new QueryError("INVALID_INPUT","Valid connectionId required");
  let userId:string;try{userId=await requireUserId();}catch{throw new QueryError("AUTH_REQUIRED","Login required",401);}
  const connection=await requireRepositoryAccess(userId,connectionId);
  const latest=await db.analysisRun.findFirst({where:{repositoryId:connection.repositoryId,requestedByUserId:userId},orderBy:{startedAt:"desc"}});
  if(latest?.status==="RUNNING")throw new QueryError("ANALYSIS_IN_PROGRESS","Repository analysis is running",202,true);
  if(!latest||latest.status!=="COMPLETED"||!latest.commitSha)throw new QueryError("ANALYSIS_MISSING","Complete repository analysis first",409,true);
  const token=await getInstallationAccessToken(connection.installation.installationId),fetcher=createInstallationFetcher(token);
  const version=await head(connection.repository.fullName,fetcher),key=githubAnalysisCacheKey(`installation:${connection.installation.installationId}`,connection.repository.fullName,version);
  const scope=JSON.stringify(["connected",userId,connectionId,connection.repositoryId,connection.installation.installationId,connection.repository.fullName.toLowerCase()]);
  observeVersion(scope,version);retainGithubAnalysisVersion(`installation:${connection.installation.installationId}:${connection.repository.fullName.toLowerCase()}@`,key);
  if(latest.commitSha.toLowerCase()!==version)throw new QueryError("STALE_ANALYSIS","Repository changed; analyze the current commit",409,true);
  const analysis=getGithubAnalysisCache(key);
  if(!analysis)throw new QueryError(analysisWorkPending(key)?"ANALYSIS_IN_PROGRESS":"ANALYSIS_MISSING","Analysis cache unavailable; rerun repository analysis",analysisWorkPending(key)?202:409,true);
  if(analysis.repository.toLowerCase()!==connection.repository.fullName.toLowerCase()||analysis.collection?.commitSha?.toLowerCase()!==version)throw new QueryError("STALE_ANALYSIS","Cached snapshot does not match repository and commit",409,true);
  const subject=requireMetadata({scope,version,source:"connected",analysis},key);
  return {subject,revalidate:async()=>{
   const current=await requireRepositoryAccess(userId,connectionId);
   if(current.repositoryId!==connection.repositoryId||current.installation.installationId!==connection.installation.installationId||current.repository.fullName!==connection.repository.fullName)throw new RepositoryAccessError("Repository connection changed",409);
   const next=await head(current.repository.fullName,fetcher);
   if(next!==version){observeVersion(scope,next);throw new QueryError("STALE_ANALYSIS","Repository changed during query",409,true);}
  }};
 }
 if(source==="github"){
  if(params.has("connectionId"))throw new QueryError("INVALID_INPUT","Public source does not accept connectionId");
  const url=params.get("url");if(!url||url.length>2048)throw new QueryError("INVALID_INPUT","Public GitHub URL required");
  const coordinates=parseGithubRepositoryUrl(url);await requirePublicRepositoryAccess(url);
  const version=await head(coordinates.fullName),key=`${coordinates.fullName.toLowerCase()}@${version}`,analysis=getGithubAnalysisCache(key);
  const scope=`public:${coordinates.fullName.toLowerCase()}`;observeVersion(scope,version);retainGithubAnalysisVersion(`${coordinates.fullName.toLowerCase()}@`,key);
  if(!analysis)throw new QueryError(analysisWorkPending(key)?"ANALYSIS_IN_PROGRESS":"ANALYSIS_MISSING","Run the public repository analysis first",analysisWorkPending(key)?202:409,true);
  if(analysis.repository.toLowerCase()!==coordinates.fullName.toLowerCase()||analysis.collection?.commitSha?.toLowerCase()!==version)throw new QueryError("STALE_ANALYSIS","Cached snapshot does not match public repository",409,true);
  const subject=requireMetadata({scope,version,source:"github",analysis},key);
  return {subject,revalidate:async()=>{await requirePublicRepositoryAccess(url);const next=await head(coordinates.fullName);if(next!==version){observeVersion(scope,next);throw new QueryError("STALE_ANALYSIS","Repository changed during query",409,true);}}};
 }
 throw new QueryError("UNSUPPORTED_TARGET","Only sample, public GitHub, or connected repositories are supported",422);
}
