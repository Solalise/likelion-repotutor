import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import { AccessStaticFindings } from "./AccessStaticFindings";
import { ManualSecurityTarget } from "./ManualSecurityTarget";
const analysis = analyzeSourceFiles([{path:"app/api/items/route.ts",content:'import {PrismaClient} from "@prisma/client"; const db=new PrismaClient(); export function GET(req) { const id=new URL(req.url).searchParams.get("id"); return db.item.findUnique({where:{id}}); }'}]);

it("renders code evidence as static suspicion and prepopulates only confirmed API information", () => {
  const fetcher = vi.spyOn(globalThis,"fetch");
  try {
    const html = renderToStaticMarkup(<AccessStaticFindings analysis={analysis} kind="IDOR" />);
    expect(html).toContain("취약점 의심 후보"); expect(html).toContain("취약점 확률 아님");
    expect(html).toContain("GET /api/items"); expect(html).toContain("소유권");
    expect(html).toContain("직접 확인할 사항"); expect(html).toContain("app/api/items/route.ts");
    expect(html).toContain('value="/api/items"');
    expect(html).not.toContain('type="checkbox" checked');
    expect(fetcher).not.toHaveBeenCalled();
  } finally { fetcher.mockRestore(); }
});
it("leaves unresolved API and method empty rather than inferring a target", () => {
  const candidate = {...analysis.accessControl!.findings[0],api:null};
  const html = renderToStaticMarkup(<ManualSecurityTarget kind="IDOR" candidate={candidate} />);
  expect(html).toContain('value="" selected=""'); expect(html).toContain("직접 선택");
  expect(html).not.toContain('value="/api/items"'); expect(html).not.toContain('type="checkbox" checked');
});
it.each([undefined, "failed", "partial"] as const)("keeps manual registration available when the report is %s", status => {
  const data = {...analysis, accessControl:status ? {...analysis.accessControl!,status,findings:[]} : undefined};
  const html=renderToStaticMarkup(<AccessStaticFindings analysis={data} kind="AUTHORIZATION" />);
  expect(html).toContain("수동"); expect(html).not.toContain("취약점 확정 결과");
  if(status==="failed") expect(html).toContain("기존 SQLi/XSS 결과 유지");
});
