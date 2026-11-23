import { expect, it, vi } from "vitest";
vi.mock("./accessControl", async original => ({ ...await original<typeof import("./accessControl")>(), collectAccessControl: () => { throw new Error("unsupported access pass"); } }));
import { analyzeSourceFiles } from "./analyzer";
it("retains SQLi/XSS and graph output when the additive access pass fails", () => {
  const a = analyzeSourceFiles([{path:"app/api/search/route.ts", content:'import {PrismaClient} from "@prisma/client"; const db=new PrismaClient(); export function GET(req) { const q=new URL(req.url).searchParams.get("q"); db.$queryRawUnsafe("SELECT "+q); return new Response(q,{headers:{"Content-Type":"text/html"}}); }'}]);
  expect(a.accessControl).toMatchObject({status:"failed",findings:[]});
  expect(a.sqlInjection!.findings.length).toBeGreaterThan(0);
  expect(a.xss!.findings.length).toBeGreaterThan(0);
  expect(a.functionControlFlows!.length).toBeGreaterThan(0);
});
