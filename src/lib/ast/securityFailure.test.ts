import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ sql: false, xss: false }));
vi.mock("./sqlInjection", async original => {
  const actual = await original<typeof import("./sqlInjection")>();
  return { ...actual, collectSqlInjection: (...args: Parameters<typeof actual.collectSqlInjection>) => {
    if (state.sql) throw new Error("synthetic parser-pass failure");
    return actual.collectSqlInjection(...args);
  } };
});
vi.mock("./xss", async original => {
  const actual = await original<typeof import("./xss")>();
  return { ...actual, collectXss: (...args: Parameters<typeof actual.collectXss>) => {
    if (state.xss) throw new Error("synthetic output-pass failure");
    return actual.collectXss(...args);
  } };
});
import { analyzeSourceFiles } from "./analyzer";
import { scanPresentation } from "@/lib/repository/scanPresentation";
beforeEach(() => { state.sql = false; state.xss = false; });
it.each(["sql", "xss"] as const)("isolates %s failure and never reports it as zero-candidate completion", kind => {
  state[kind] = true;
  const a = analyzeSourceFiles([{ path: "app/api/search/route.ts", content: "import {Pool} from 'pg'; const db=new Pool(); export function GET(req) { db.query('SELECT '+req.url); return new Response(req.url,{headers:{'Content-Type':'text/html'}}); }" }]);
  expect(scanPresentation(a, kind === "sql" ? "SQL_INJECTION" : "XSS")).toMatchObject({ status: "failed", candidates: 0 });
  expect(kind === "sql" ? a.xss?.findings.length : a.sqlInjection?.findings.length).toBe(1);
  expect(a.files).toHaveLength(1);
});
