import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({user:vi.fn(),connection:vi.fn(),latest:vi.fn(),token:vi.fn(),github:vi.fn(),fetch:vi.fn(),revoke:vi.fn(),sources:vi.fn(),create:vi.fn(),update:vi.fn(),load:vi.fn()}));
vi.mock("@/lib/auth/currentUser",()=>({requireUserId:m.user}));
vi.mock("@/lib/db",()=>({db:{userRepository:{findFirst:m.connection,updateMany:m.revoke,update:vi.fn()},analysisRun:{findFirst:m.latest,create:m.create,update:m.update},$transaction:(items:Promise<unknown>[])=>Promise.all(items)}}));
vi.mock("@/lib/github/api",async importOriginal=>({...await importOriginal<typeof import("@/lib/github/api")>(),getGitHubUserAccessToken:m.token,githubJson:m.github}));
vi.mock("@/lib/github/appAuthentication",()=>({getInstallationAccessToken:vi.fn(async()=>"app-token"),createInstallationFetcher:()=>m.fetch}));
vi.mock("@/lib/repository/loadGithubRepository",async importOriginal=>({...await importOriginal<typeof import("@/lib/repository/loadGithubRepository")>(),loadGithubRepository:m.load}));
vi.mock("@/lib/repository/loadLocalRepository",()=>({loadLocalRepository:m.sources}));
import {GET,POST} from "@/app/api/behavior/route";
import {analyzeSourceFiles} from "@/lib/ast/analyzer";
import {pipelineSources} from "@/lib/behavior/validation/pipelineFixture";
import {setGithubAnalysisCache,clearGithubAnalysisCacheForTests,getGithubAnalysisCache} from "@/lib/repository/githubAnalysisCache";
import {clearQueryCaches,queryCacheStats} from "./store";
const SHA="a".repeat(40),NEXT="b".repeat(40);
const base=analyzeSourceFiles(pipelineSources,"org/private");
function analysis(repo="org/private",sha=SHA){return {...base,repository:repo,source:"github" as const,collection:{source:"github" as const,discoveredFiles:5,collectedFiles:5,totalBytes:2000,durationMs:1,partial:false,commitSha:sha}};}
const connection={id:"own",userId:"user-a",repositoryId:"repo-1",active:true,installation:{id:"install-row",userId:"user-a",installationId:"7",suspendedAt:null},repository:{id:"repo-1",githubRepositoryId:"21",fullName:"org/private",htmlUrl:"https://github.com/org/private"}};
function request(params:Record<string,string>={}){return GET(new Request(`http://localhost/api/behavior?${new URLSearchParams({source:"connected",connectionId:"own",...params})}`));}
async function selection(){const response=await request(),body=await response.json();expect(response.status).toBe(200);const feature=body.features.find((item:{entryPoint:{routePath:string;method:string}})=>item.entryPoint.routePath==="/api/login"&&item.entryPoint.method==="POST");return {analysisId:body.snapshot.analysisId,featureId:feature.id};}
beforeEach(()=>{
 vi.resetAllMocks();clearGithubAnalysisCacheForTests();clearQueryCaches();vi.stubGlobal("fetch",m.fetch);
 m.user.mockResolvedValue("user-a");m.connection.mockImplementation(async({where})=>where.id==="own"&&where.userId==="user-a"&&where.active?connection:null);
 m.latest.mockResolvedValue({status:"COMPLETED",commitSha:SHA});m.token.mockResolvedValue("user-token");
 m.github.mockImplementation(async(path:string)=>path.endsWith("/contents")?[]:path.startsWith("/user/installations?")?{total_count:1,installations:[{id:7,suspended_at:null,permissions:{contents:"read"}}]}:{total_count:1,repositories:[{id:21,full_name:"org/private",permissions:{pull:true}}]});
 m.fetch.mockImplementation(async(input:string|URL)=>new Response(JSON.stringify(String(input).endsWith("/commits/HEAD")?{sha:SHA}:{private:false,full_name:"org/public"}),{status:200,headers:{"Content-Type":"application/json"}}));
 m.create.mockResolvedValue({id:"run"});m.update.mockResolvedValue({});m.load.mockResolvedValue({repository:"org/private",sources:pipelineSources,collection:{source:"github",commitSha:SHA,defaultBranch:"main",partial:false}});
 m.sources.mockResolvedValue(pipelineSources);setGithubAnalysisCache(`installation:7:org/private@${SHA}`,analysis());
});
afterEach(()=>vi.unstubAllGlobals());
describe("Behavior query API authorization and supply",()=>{
 it("returns code-free feature summaries and leaves unknown Flow counts explicit",async()=>{
  const response=await request(),body=await response.json();expect(response.status).toBe(200);
  expect(body.features.length).toBeGreaterThan(0);expect(body.features[0].flowCounts).toBeNull();expect(body.features[0].truncation.analysis).toBeNull();
  expect(JSON.stringify(body)).not.toContain("sourceCode");expect(queryCacheStats().builds).toBe(0);
  expect(m.connection).toHaveBeenCalledTimes(2);expect(response.headers.get("cache-control")).toBe("private, no-store");
 });
 it("supplies an initial page, bounded detail, CFG, and expansion with stable IDs",async()=>{
  const ids=await selection(),response=await request({...ids,view:"flow",limit:"3"}),graph=await response.json();expect(response.status).toBe(200);
  expect(graph.nodes.length).toBeLessThanOrEqual(3);expect(graph.truncation.projection).toBe(true);expect(graph.truncation.recoverableByExpansion).toBe(false);
  const root=graph.rootId,detail=await request({...ids,view:"node",nodeId:root});expect(detail.status).toBe(200);
  const data=await detail.json();expect(data.code.text).toContain("POST");expect(data.code.text.length).toBeLessThanOrEqual(6000);expect(data.cfg.available).toBe(true);
  const cfg=await request({...ids,view:"cfg",nodeId:root,limit:"2"});expect(cfg.status).toBe(200);expect((await cfg.json()).nodes).toHaveLength(2);
  const expanded=await request({...ids,view:"expand",nodeId:root,visible:graph.visibleNodeIds.join(","),limit:"3"}),delta=await expanded.json();
  expect(expanded.status).toBe(200);expect(delta.visibleNodeIds.length).toBeGreaterThan(graph.visibleNodeIds.length);
  expect(new Set(delta.nodes.map((node:{id:string})=>node.id)).size).toBe(delta.nodes.length);expect(new Set(delta.edges.map((edge:{id:string})=>edge.id)).size).toBe(delta.edges.length);
  const again=await(await request({...ids,view:"flow",limit:"3"})).json();expect(again.nodes.map((node:{id:string})=>node.id)).toEqual(graph.nodes.map((node:{id:string})=>node.id));expect(again.cacheHit).toBe(true);expect(queryCacheStats().builds).toBe(1);
  const list=await(await request()).json();expect(list.features.find((item:{id:string})=>item.id===ids.featureId).flowCounts.nodes).toBeGreaterThanOrEqual(graph.nodes.length);
 });
 it.each(["features","flow","node","expand","cfg"])("blocks revoked access on %s even after warming caches",async view=>{
  const ids=await selection(),graph=await(await request({...ids,view:"flow"})).json();
  m.github.mockImplementation(async(path:string)=>path.startsWith("/user/installations?")?{total_count:0,installations:[]}:{total_count:0,repositories:[]});
  const response=await request({...ids,view,nodeId:graph.rootId});expect([403,404]).toContain(response.status);expect(JSON.stringify(await response.json())).not.toContain("prisma");
 });
 it("rejects another user's connection before reading the cached snapshot",async()=>{
  const ids=await selection();m.user.mockResolvedValue("user-b");const response=await request({...ids,view:"flow"});expect(response.status).toBe(404);
 });
 it("reports partial source collection before generating any Flow",async()=>{
  const value=analysis();value.collection.partial=true;setGithubAnalysisCache(`installation:7:org/private@${SHA}`,value);
  const response=await request(),body=await response.json();expect(response.status).toBe(200);expect(body.snapshot.sourcePartial).toBe(true);
  expect(body.features.every((feature:{status:string;flowCounts:unknown})=>feature.status==="partial"&&feature.flowCounts===null)).toBe(true);
  expect(queryCacheStats().builds).toBe(0);
 });
 it("rejects foreign connection and mismatched repository snapshots",async()=>{
  expect((await request({connectionId:"foreign"})).status).toBe(404);
  setGithubAnalysisCache(`installation:7:org/private@${SHA}`,analysis("org/other"));
  expect((await request()).status).toBe(409);expect(queryCacheStats().builds).toBe(0);
 });
 it("checks access again after computation",async()=>{
  const ids=await selection();let count=0;m.connection.mockImplementation(async()=>++count===1?connection:null);
  const response=await request({...ids,view:"flow"});expect(response.status).toBe(404);
 });
 it("fails closed if GitHub Contents or HEAD verification fails",async()=>{
  const ids=await selection();m.github.mockRejectedValue(new Error("offline"));expect((await request({...ids,view:"flow"})).status).toBe(503);
  m.github.mockImplementation(async(path:string)=>path.endsWith("/contents")?[]:path.startsWith("/user/installations?")?{total_count:1,installations:[{id:7,suspended_at:null,permissions:{contents:"read"}}]}:{total_count:1,repositories:[{id:21,full_name:"org/private",permissions:{pull:true}}]});
  m.fetch.mockResolvedValue(new Response("error",{status:503}));expect((await request()).status).toBe(503);
 });
 it("invalidates an old SHA and never serves its graph after HEAD changes",async()=>{
  const ids=await selection();await request({...ids,view:"flow"});expect(queryCacheStats().flows.entries).toBe(1);
  m.fetch.mockImplementation(async()=>new Response(JSON.stringify({sha:NEXT}),{status:200}));expect((await request({...ids,view:"flow"})).status).toBe(409);expect(queryCacheStats().flows.entries).toBe(0);expect(getGithubAnalysisCache(`installation:7:org/private@${SHA}`)).toBeUndefined();
  setGithubAnalysisCache(`installation:7:org/private@${NEXT}`,analysis("org/private",NEXT));m.latest.mockResolvedValue({status:"COMPLETED",commitSha:NEXT});
  const next=await selection();expect(next.analysisId).not.toBe(ids.analysisId);expect((await request({...ids,view:"flow"})).status).toBe(409);
 });
 it("returns distinct missing, running, and unsupported-analysis states",async()=>{
  m.latest.mockResolvedValue(null);expect((await request()).status).toBe(409);
  m.latest.mockResolvedValue({status:"RUNNING"});expect((await request()).status).toBe(202);
  m.latest.mockResolvedValue({status:"COMPLETED",commitSha:SHA});const old=analysis();delete old.serverResponses;setGithubAnalysisCache(`installation:7:org/private@${SHA}`,old);
  expect((await request()).status).toBe(422);
 });
 it("rejects absent and cross-feature node IDs and bad inputs",async()=>{
  const ids=await selection();expect((await request({...ids,view:"node",nodeId:`n_${"0".repeat(24)}`})).status).toBe(404);
  expect((await request({...ids,view:"flow",featureId:`f_${"0".repeat(24)}`})).status).toBe(404);
  for(const params of ([{view:"unknown"},{view:"flow",limit:"10000"},{source:"local"},{extra:"bad"}] as Record<string,string>[]))expect([400,422]).toContain((await request(params)).status);
  const list=await(await request()).json(),other=list.features.find((item:{id:string})=>item.id!==ids.featureId);
  const graph=await(await request({...ids,view:"flow"})).json();expect((await request({...ids,featureId:other.id,view:"node",nodeId:graph.rootId})).status).toBe(404);
 });
 it("coalesces simultaneous Flow queries while authorizing each caller",async()=>{
  const ids=await selection(),before=m.connection.mock.calls.length;
  const responses=await Promise.all(Array.from({length:4},()=>request({...ids,view:"flow"})));expect(responses.every(response=>response.status===200)).toBe(true);
  expect(queryCacheStats().builds).toBe(1);expect(m.connection.mock.calls.length-before).toBe(8);
 });
 it("keeps public requests anonymous and denies newly private repositories on warm caches",async()=>{
  setGithubAnalysisCache(`org/public@${SHA}`,analysis("org/public"));
  const response=await request({source:"github",url:"https://github.com/org/public",connectionId:""});expect(response.status).toBe(400);
  const invoke=()=>GET(new Request("http://localhost/api/behavior?source=github&url=https://github.com/org/public"));
  expect((await invoke()).status).toBe(200);expect(m.user).not.toHaveBeenCalled();
  const publicCalls=m.fetch.mock.calls.filter(([url])=>String(url).includes("org/public"));for(const [,init]of publicCalls)expect(new Headers(init?.headers).has("Authorization")).toBe(false);
  m.fetch.mockResolvedValue(new Response(JSON.stringify({private:true,full_name:"org/public"}),{status:200}));expect((await invoke()).status).toBe(403);
 });
 it("prepares a connected repository once for simultaneous callers without returning analysis code",async()=>{
  clearGithubAnalysisCacheForTests();
  const invoke=()=>POST(new Request("http://localhost/api/behavior?source=connected&connectionId=own",{method:"POST",headers:{"X-RepoTutor-Prepare":"1"}}));
  const results=await Promise.all([invoke(),invoke()]);expect(results.map(item=>item.status)).toEqual([200,200]);expect(m.create).toHaveBeenCalledTimes(1);expect(m.load).toHaveBeenCalledTimes(1);
  for(const response of results){const body=await response.json();expect(body.features).toBeDefined();expect(body.files).toBeUndefined();}
  m.user.mockResolvedValue("user-b");m.load.mockClear();expect((await invoke()).status).toBe(404);expect(m.load).not.toHaveBeenCalled();
 });
 it("prepares a sample through the real analysis handler and returns only a summary",async()=>{
  clearGithubAnalysisCacheForTests();
  const response=await POST(new Request("http://localhost/api/behavior?source=sample",{method:"POST",headers:{"X-RepoTutor-Prepare":"1",Origin:"http://localhost"}}));
  expect(response.status).toBe(200);const body=await response.json();expect(body.features.length).toBeGreaterThan(0);expect(body.files).toBeUndefined();expect(JSON.stringify(body)).not.toContain("sourceCode");
  expect((await POST(new Request("http://localhost/api/behavior?source=sample",{method:"POST"}))).status).toBe(403);
  expect((await POST(new Request("http://localhost/api/behavior?source=sample",{method:"POST",headers:{"X-RepoTutor-Prepare":"1",Origin:"https://other.example"}}))).status).toBe(403);
 });
 it("provides the existing public sample without login and reports no runtime execution",async()=>{
  const response=await GET(new Request("http://localhost/api/behavior?source=sample"));expect(response.status).toBe(200);expect(m.user).not.toHaveBeenCalled();
  const body=await response.json();expect(body.snapshot.commitSha).toBeNull();expect(body.snapshot.version).toHaveLength(64);
 });
 it("uses the HTTP destination Host when Next canonicalizes the request URL",async()=>{
  const invoke=(origin:string)=>POST(new Request("http://localhost:3187/api/behavior?source=sample",{method:"POST",headers:{Host:"127.0.0.1:3187",Origin:origin,"X-RepoTutor-Prepare":"1"}}));
  expect((await invoke("http://127.0.0.1:3187")).status).toBe(200);
  expect((await invoke("http://localhost:3187")).status).toBe(403);
  expect((await invoke("https://other.example")).status).toBe(403);
 });
});
