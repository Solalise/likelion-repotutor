import {mkdir,writeFile,readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {beforeAll,describe,expect,it} from "vitest";
import {productionSources,runPipeline,auditWorkflow,referentialErrors} from "./auditRunner";
import {fixtureGold,realWorkflows} from "./gold";
import {pipelineSources} from "./pipelineFixture";
import {metrics,scoreRows} from "./oracle";

let fixture:ReturnType<typeof runPipeline>,real:ReturnType<typeof runPipeline>;
let fixtureRows:ReturnType<typeof scoreRows>,workflows:ReturnType<typeof auditWorkflow>[];
beforeAll(async()=>{
 fixture=runPipeline(pipelineSources,"manual-integration-fixture",[{route:"/login"},{route:"/api/login",method:"POST"},{route:"/api/limits",method:"GET"}]);
 fixtureRows=scoreRows(fixtureGold,fixture.input);
 real=runPipeline(await productionSources(),"RepoTutor-working-tree",[{route:"/repository"},...realWorkflows.map(item=>({route:item.route,method:item.method}))]);
 workflows=realWorkflows.map(item=>auditWorkflow(real,item.gold,item.route,item.method));
 if(process.env.REPOTUTOR_WRITE_AUDIT==="1") {
  const config=await readFile("next.config.ts","utf8");
  expect(config).not.toMatch(/\b(?:rewrites|basePath)\s*:/);
  const labelledFixtureIds=new Set(fixtureRows.flatMap(row=>[...row.observation.ids,...(row.observation.rawIds??[])]));
  const report={schemaVersion:1,createdAtUtc:new Date().toISOString(),environment:{node:process.version,platform:process.platform,arch:process.arch},
   sourceSnapshot:{head:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),basis:"Uncommitted working tree, content hashes are authoritative; not a clean HEAD benchmark.",
    routingConfig:{path:"next.config.ts",sha256:createHash("sha256").update(config).digest("hex"),review:"Only serverExternalPackages; no basePath/rewrites configured."}},
   fixture:{metrics:metrics(fixtureRows),rows:fixtureRows,performance:fixture.performance,flows:fixture.measured.map(item=>item.performance),
    referentialErrors:referentialErrors(fixture.input.analysis,fixture.input.flows),unreviewedOuterEdges:fixture.input.flows.reduce((count,flow)=>count+flow.edges.filter(edge=>!labelledFixtureIds.has(edge.id)&&!edge.sourceEdgeIds.some(id=>labelledFixtureIds.has(id))).length,0)},
   real:{performance:real.performance,manifest:real.manifest,features:real.features.filter(item=>real.input.entries.some(entry=>entry.nodeId===item.entryNodeId)).map(item=>({id:item.id,entryNodeId:item.entryNodeId,routePath:item.routePath,httpMethod:item.httpMethod,limited:item.limited,nodeCount:item.nodeIds.length,edgeCount:item.edgeIds?.length})),
    workflows:workflows.map((item,index)=>({id:realWorkflows[index].id,name:realWorkflows[index].name,...item})),
    referentialErrors:referentialErrors(real.input.analysis,real.input.flows),unsupportedRegions:real.input.analysis.functionControlFlows?.flatMap(cfg=>cfg.statements.filter(statement=>statement.kind==="unsupported").map(statement=>({id:statement.id,ownerFunctionId:cfg.ownerFunctionId,location:statement.location,syntaxKind:statement.syntaxKind,reason:statement.unsupportedReason,sourceCode:statement.sourceCode.slice(0,160)}))),limitations:{database:real.input.analysis.databaseAccess?.limitations,responses:real.input.analysis.serverResponses?.limitations,
     flows:real.measured.map(item=>({entry:item.flow.entryPoint,limitations:item.flow.limitations}))}},
   decision:{fullAutomaticEndToEndUi:"not-ready",evidenceInspectorUi:"conditional",reason:"Dynamic HTTP, cached-client provenance, response wrappers/return values, unsupported CFG and unreviewed output require explicit gaps; test success is not semantic completeness."}};
  await mkdir("docs/validation",{recursive:true});
  await writeFile("docs/validation/behavior-audit-stage4d.json",JSON.stringify(report,null,2)+"\n");
  await writeFile("docs/validation/behavior-audit-fixture.json",JSON.stringify({sources:pipelineSources,oracle:fixtureGold},null,2)+"\n");
 }
},180000);

describe("stage 4-D offline integration audit",()=>{
 it("resolves all selected entries and validates cross-layer IDs",()=>{
  expect(fixture.measured.every(item=>item.performance.validation.valid)).toBe(true);
  expect(real.measured.every(item=>item.performance.validation.valid)).toBe(true);
  expect(referentialErrors(fixture.input.analysis,fixture.input.flows)).toEqual([]);
  expect(referentialErrors(real.input.analysis,real.input.flows)).toEqual([]);
 });
 it("connects the manually labelled supported fixture path",()=>{
  const supported=fixtureRows.filter(item=>item.truth==="positive"&&item.id!=="fx-wrapper");
  expect(supported.map(item=>({id:item.id,outcome:item.outcome}))).toEqual(supported.map(item=>({id:item.id,outcome:"correct"})));
 });
 it("records a known wrapper recall gap instead of calling the fixture complete",()=>{
  expect(fixtureRows.find(item=>item.id==="fx-wrapper")!.outcome).toBe("unresolved");
  expect(metrics(fixtureRows).sampleRecall).toBeLessThan(1);
 });
 it("does not confirm unknown cache/URL origins or negative controls",()=>{
  expect(fixtureRows.filter(item=>item.truth==="unknown").every(item=>item.outcome==="unresolved")).toBe(true);
  expect(fixtureRows.filter(item=>item.truth==="negative").every(item=>item.outcome==="correct-rejection")).toBe(true);
 });
 for(const [index,item] of realWorkflows.entries()) it(`reports manually reviewed ${item.name} without hiding unresolved positives`,()=>{
  const audit=workflows[index];
  expect(audit.metrics.falseConfirmed).toBe(0);expect(audit.metrics.unknownConfirmations).toBe(0);
  expect(audit.rows.filter(row=>row.kind==="entry"||row.kind==="feature").every(row=>row.outcome==="correct")).toBe(true);
  expect(audit.rows.find(row=>row.kind==="http")!.outcome).toBe("unresolved");
  expect(audit.rows.find(row=>row.kind==="return")!.outcome).toBe("unresolved");
 });
 it("computes denominators without counting unknown or abstained positives as successes",()=>{
  const rows=structuredClone(fixtureRows.slice(0,4));
  rows[0].truth="positive";rows[0].outcome="correct";
  rows[1].truth="positive";rows[1].outcome="unresolved";
  rows[2].truth="negative";rows[2].outcome="false-confirmed";
  rows[3].truth="unknown";rows[3].outcome="unresolved";
  expect(metrics(rows)).toMatchObject({samplePrecision:0.5,sampleRecall:0.5,unknownTruth:1,unresolvedPositive:1,falseConfirmed:1});
  expect(metrics([])).toMatchObject({samplePrecision:null,sampleRecall:null});
 });
 it("detects a deliberately wrong HTTP target rather than silently calling it unresolved",()=>{
  const input=structuredClone(fixture.input),page=input.flows.find(flow=>flow.entryPoint.kind==="page")!;
  const boundary=page.httpRequests!.find(item=>item.boundary)!.boundary!;
  boundary.serverEntryPoint.routePath="/api/unrelated";
  const row=scoreRows(fixtureGold.filter(item=>item.id==="fx-http"),input)[0];
  expect(row.outcome).toBe("false-confirmed");expect(row.observation.wrongIds!.length).toBeGreaterThan(0);
 });
 it("detects a deliberately wrong outer call destination even with a valid raw edge ID",()=>{
  const input=structuredClone(fixture.input),page=input.flows.find(flow=>flow.entryPoint.kind==="page")!;
  const relation=page.edges.find(edge=>edge.relation==="call")!;
  relation.target=page.entryNodeId!;
  const row=scoreRows(fixtureGold.filter(item=>item.id==="fx-call"),input)[0];
  expect(row.outcome).toBe("false-confirmed");
 });
});
