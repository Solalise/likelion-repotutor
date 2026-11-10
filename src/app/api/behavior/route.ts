import {NextResponse} from "next/server";
import {resolveQuerySubject} from "@/lib/behavior/query/source";
import {QueryError,snapshot,summaries,getFlowIndex} from "@/lib/behavior/query/store";
import {graphPage,nodeDetail,cfgPage,QUERY_LIMITS} from "@/lib/behavior/query/projector";
import {RepositoryAccessError} from "@/lib/github/repositoryAccess";
import {GithubRepositoryError} from "@/lib/repository/loadGithubRepository";
import {parseGithubRepositoryUrl} from "@/lib/repository/loadGithubRepository";
import {requireUserId} from "@/lib/auth/currentUser";
import {requireRepositoryAccess} from "@/lib/github/repositoryAccess";
import {requirePublicRepositoryAccess} from "@/lib/github/publicRepositoryAccess";
import {coalesceAnalysis} from "@/lib/repository/analysisWork";
import {GET as analyzePublic} from "@/app/api/analyze/route";
import {GET as analyzeConnected} from "@/app/api/repositories/[connectionId]/analyze/route";

export const runtime="nodejs";
export const dynamic="force-dynamic";
function json(body:unknown,status=200){return NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store",Vary:"Cookie","X-Content-Type-Options":"nosniff"}});}
const keys=new Set(["source","connectionId","url","view","analysisId","featureId","nodeId","visible","limit","offset","codeOffset","evidence"]);
function number(params:URLSearchParams,key:string,fallback:number,max:number,min=0){const raw=params.get(key);if(raw===null)return fallback;if(!/^\d{1,8}$/.test(raw)||Number(raw)>max||Number(raw)<min)throw new QueryError("INVALID_INPUT",`Invalid ${key}`);return Number(raw);}
function id(params:URLSearchParams,key:string,prefix:string){const value=params.get(key);if(!value||!new RegExp(`^${prefix}_[a-f0-9]{24}$`).test(value))throw new QueryError("INVALID_INPUT",`Valid ${key} required`);return value;}
export async function GET(request:Request){
 try{
  if(request.url.length>16384)throw new QueryError("INVALID_INPUT","Query is too large");
  const params=new URL(request.url).searchParams;
  for(const key of params.keys())if(!keys.has(key)||params.getAll(key).length!==1)throw new QueryError("INVALID_INPUT",`Unknown or duplicate parameter ${key}`);
  const view=params.get("view")??"features";if(!["features","flow","node","expand","cfg"].includes(view))throw new QueryError("INVALID_INPUT","Unsupported view");
  const limit=number(params,"limit",view==="cfg"?40:QUERY_LIMITS.initial,QUERY_LIMITS.maxPage,1),offset=number(params,"offset",0,1000000),codeOffset=number(params,"codeOffset",0,10000000);
  const {subject,revalidate}=await resolveQuerySubject(params),snap=snapshot(subject);
  let body:unknown;
  if(view==="features"){const features=summaries(subject);body={snapshot:snap,status:features.length?"indexed":"unsupported",features,countsNotice:"Source-scope counts until selected Flow is generated; flowCounts remains null, truncation not assessed. No completeness claim."};}
  else {
   if(id(params,"analysisId","a")!==snap.analysisId)throw new QueryError("STALE_ANALYSIS","Snapshot ID does not match current authorized repository",409,true);
   const featureId=id(params,"featureId","f"),{index,cacheHit}=await getFlowIndex(subject,featureId);
   if(view==="flow")body={...graphPage(index,limit,params.has("nodeId")?id(params,"nodeId","n"):index.root),cacheHit};
   else if(view==="node")body=nodeDetail(index,subject.analysis,id(params,"nodeId","n"),offset,codeOffset,params.has("evidence")?number(params,"evidence",0,100000):undefined);
   else if(view==="cfg")body=cfgPage(index,subject.analysis,id(params,"nodeId","n"),offset,limit);
   else {
    const visible=params.get("visible")?.split(",").filter(Boolean)??[];
    if(visible.length>QUERY_LIMITS.maxVisible||visible.some(value=>!/^n_[a-f0-9]{24}$/.test(value)))throw new QueryError("INVALID_INPUT","Invalid visible node IDs");
    body={...graphPage(index,limit,id(params,"nodeId","n"),visible,true),cacheHit};
   }
  }
  // Access is intentionally checked again after expensive work, even on cache hits.
  await revalidate();
  if(Buffer.byteLength(JSON.stringify(body),"utf8")>256*1024)throw new QueryError("RESPONSE_BUDGET","Choose a smaller page or detail offset",413);
  return json(body);
 }catch(error){
  if(error instanceof QueryError)return json({status:error.http===202?"in-progress":error.code==="STALE_ANALYSIS"?"stale":"unavailable",error:{code:error.code,message:error.message,retryable:error.retryable}},error.http);
  if(error instanceof RepositoryAccessError||error instanceof GithubRepositoryError)return json({status:"unavailable",error:{code:"ACCESS_DENIED",message:error.message,retryable:error.status>=500}},error.status);
  return json({status:"unavailable",error:{code:"QUERY_UNAVAILABLE",message:"Behavior query failed; analysis data is unchanged",retryable:true}},503);
 }
}

/** Explicit preparation action. Legacy handlers keep their normal responses; receipt mode avoids serializing the AST. */
export async function POST(request:Request){
 try{
  const url=new URL(request.url),origin=request.headers.get("origin");
  // Next may canonicalize request.url to localhost; the HTTP Host remains the browser's destination.
  const expectedOrigin=request.headers.get("host")?new URL(`${url.protocol}//${request.headers.get("host")}`).origin:url.origin;
  if(request.headers.get("X-RepoTutor-Prepare")!=="1"||(origin&&origin!==expectedOrigin))throw new QueryError("INVALID_ORIGIN","Same-origin preparation header required",403);
  if(request.url.length>4096)throw new QueryError("INVALID_INPUT","Preparation query is too large");
  for(const key of url.searchParams.keys())if(!["source","url","connectionId"].includes(key)||url.searchParams.getAll(key).length!==1)throw new QueryError("INVALID_INPUT","Preparation accepts repository identifiers only");
  const source=url.searchParams.get("source")??"sample",headers={Accept:"application/vnd.repotutor.analysis-receipt+json"};
  let work:()=>Promise<Response>,key:string;
  if(source==="connected"){
   const connectionId=url.searchParams.get("connectionId");if(!connectionId||!/^[-\w]{1,160}$/.test(connectionId)||url.searchParams.has("url"))throw new QueryError("INVALID_INPUT","Valid connectionId required");
   let userId:string;try{userId=await requireUserId();}catch{throw new QueryError("AUTH_REQUIRED","Login required",401);}
   await requireRepositoryAccess(userId,connectionId);
   key=`prepare:${userId}:${connectionId}`;
   work=()=>analyzeConnected(new Request(request.url,{headers}),{params:Promise.resolve({connectionId})});
  }else if(source==="github"){
   const repositoryUrl=url.searchParams.get("url");if(!repositoryUrl||repositoryUrl.length>2048||url.searchParams.has("connectionId"))throw new QueryError("INVALID_INPUT","Public repository URL required");
   const repository=parseGithubRepositoryUrl(repositoryUrl);await requirePublicRepositoryAccess(repositoryUrl);
   key=`prepare-public:${repository.fullName.toLowerCase()}`;
   work=()=>analyzePublic(new Request(`${url.origin}/api/analyze?${new URLSearchParams({source:"github",url:repositoryUrl})}`,{headers}));
  }else if(source==="sample"&&!url.searchParams.has("url")&&!url.searchParams.has("connectionId")){
   key="prepare-sample";work=()=>analyzePublic(new Request(`${url.origin}/api/analyze?source=sample`,{headers}));
  }else throw new QueryError("UNSUPPORTED_TARGET","Unsupported preparation target",422);
  const receipt=await coalesceAnalysis(key,work);
  if(!receipt.ok)throw new QueryError("ANALYSIS_PREPARATION_FAILED","Existing analysis handler could not complete preparation",receipt.status,receipt.status>=500);
  return GET(new Request(`${url.origin}/api/behavior?${url.searchParams}`));
 }catch(error){
  if(error instanceof QueryError)return json({status:"unavailable",error:{code:error.code,message:error.message,retryable:error.retryable}},error.http);
  if(error instanceof RepositoryAccessError||error instanceof GithubRepositoryError)return json({status:"unavailable",error:{code:"ACCESS_DENIED",message:error.message,retryable:error.status>=500}},error.status);
  return json({status:"unavailable",error:{code:"PREPARATION_UNAVAILABLE",message:"Analysis could not be prepared",retryable:true}},503);
 }
}
