import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { initialLabData, labSessionReducer, LabSessionProvider } from "./LabSession";
import { DashboardView, ResultsView, ServicesView, LearningView } from "./WorkspaceViews";
import { securityNavigation, activeSecurityPath } from "@/lib/security-lab/navigation";
import type { RunnerPlan } from "@/lib/security-lab/runnerTypes";

const observedPlan: RunnerPlan = { id:"real-plan",target:"http://127.0.0.1:4320",input:{apiPath:"/orders/{resourceId}",resourceA:"101",resourceB:"102",policy:"owner-only"},requests:[],policy:"owner-only",expiresAt:999999,approved:true,used:true,result:{verdict:"confirmed",reason:"HTTP evidence",scope:"bounded",requestCount:5,evidence:[]} };
describe("tab-scoped actual results and session lifecycle",()=>{
  it("starts empty and never invents a connected service or saved history",()=>{
    expect(initialLabData().session).toBeUndefined();expect(initialLabData().records).toEqual([]);
    for(const View of [DashboardView,ResultsView]){const html=renderToStaticMarkup(<LabSessionProvider><View/></LabSessionProvider>);expect(html).toContain("아직");expect(html).not.toContain("http://127.0.0.1:4320");}
  });
  it("retains actual results across navigation state updates without copying the pairing token",()=>{
    let state={epoch:0,data:initialLabData()};
    state=labSessionReducer(state,{type:"merge",epoch:0,patch:{session:{token:"private-pair-token",port:"4317",expiresAt:9999}}});
    state=labSessionReducer(state,{type:"record",epoch:0,plan:observedPlan,observedAt:123});
    state=labSessionReducer(state,{type:"merge",epoch:0,patch:{apiPath:"/fixed/{resourceId}"}});
    expect(state.data.records).toHaveLength(1);expect(state.data.records[0].result.reason).toBe("HTTP evidence");
    expect(JSON.stringify(state.data.records)).not.toContain("private-pair-token");
    expect(labSessionReducer(state,{type:"record",epoch:0,plan:observedPlan,observedAt:456}).data.records).toHaveLength(1);
  });
  it("records no preview as an execution and bounds the session history",()=>{
    let state={epoch:0,data:initialLabData()};
    expect(labSessionReducer(state,{type:"record",epoch:0,plan:{...observedPlan,result:undefined},observedAt:1}).data.records).toEqual([]);
    for(let index=0;index<15;index++)state=labSessionReducer(state,{type:"record",epoch:0,plan:{...observedPlan,id:String(index)},observedAt:index});
    expect(state.data.records).toHaveLength(10);expect(state.data.records[0].id).toBe("14");
  });
  it("expires connection but keeps tab results and ignores late callbacks from the expired session",()=>{
    let state={epoch:0,data:{...initialLabData(),session:{token:"secret",port:"4317",expiresAt:1}}};
    const withRecord=labSessionReducer(state,{type:"record",epoch:0,plan:observedPlan,observedAt:1});
    const expired=labSessionReducer(withRecord,{type:"expire",epoch:0});
    expect(expired.data.session).toBeUndefined();expect(expired.data.records).toHaveLength(1);
    expect(labSessionReducer(expired,{type:"merge",epoch:0,patch:{session:state.data.session}})).toEqual(expired);
  });
  it("clears login/logout state and prevents an in-flight response repopulating another account",()=>{
    const state=labSessionReducer({epoch:0,data:initialLabData()},{type:"record",epoch:0,plan:observedPlan,observedAt:1});
    const cleared=labSessionReducer(state,{type:"reset"});
    expect(cleared.data.records).toEqual([]);
    expect(labSessionReducer(cleared,{type:"record",epoch:0,plan:observedPlan,observedAt:2})).toEqual(cleared);
  });
});
describe("six primary destinations and local-first entry",()=>{
  it("exposes exactly the six requested menus and maps preserved routes to auxiliary sections",()=>{
    expect(securityNavigation.map(item=>item.label)).toEqual(["대시보드","내 웹서비스","공격 실습","검증 결과","취약점 학습","설정"]);
    expect(new Set(securityNavigation.map(item=>item.href)).size).toBe(6);
    expect(activeSecurityPath("/security-lab/project")).toBe("/practice");expect(activeSecurityPath("/repository")).toBe("/settings");
  });
  it("provides local connection without GitHub and keeps unsupported attacks informational",()=>{
    const html=renderToStaticMarkup(<LabSessionProvider><ServicesView/></LabSessionProvider>);
    expect(html).toContain("GitHub 로그인 없이 사용할 수 있습니다");expect(html).not.toContain("승인된 계획 실제 실행");
    expect(html).toContain('id="pair-code"');
    const learning=renderToStaticMarkup(<LearningView/>);expect(learning).toContain('href="/security-lab"');expect(learning).toContain("준비 중");
  });
});
