import path from "node:path";
import {createHash} from "node:crypto";
import {loadLocalRepository} from "./loadLocalRepository";
import {analyzeSourceFiles} from "@/lib/ast/analyzer";
import {getGithubAnalysisCache,setGithubAnalysisCache} from "./githubAnalysisCache";
import {coalesceAnalysis} from "./analysisWork";
export async function loadSampleAnalysis(){
 const started=Date.now(),sources=await loadLocalRepository(path.join(process.cwd(),"sample-repository"));sources.sort((a,b)=>a.path.localeCompare(b.path));
 const version=createHash("sha256").update(JSON.stringify(sources)).digest("hex"),key=`behavior-sample@${version}`;
 const analysis=await coalesceAnalysis(key,()=>{
  const current=getGithubAnalysisCache(key);if(current)return current;
  const value={...analyzeSourceFiles(sources),source:"sample" as const,collection:{source:"sample" as const,discoveredFiles:sources.length,collectedFiles:sources.length,totalBytes:sources.reduce((sum,item)=>sum+Buffer.byteLength(item.content,"utf8"),0),durationMs:Date.now()-started,partial:false}};
  setGithubAnalysisCache(key,value);return value;
 });return {analysis,version,key};
}
export const wantsAnalysisReceipt=(request:Request)=>request.headers.get("accept")==="application/vnd.repotutor.analysis-receipt+json";
