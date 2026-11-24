import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { analyzeSourceFiles } from "./analyzer";
import { scanPresentation } from "@/lib/repository/scanPresentation";
import { AnalysisSummary } from "@/components/repository/AnalysisSummary";

it("identifies package/import evidence and distinguishes Mongo SQL scope from no candidates", () => {
  const a = analyzeSourceFiles([{ path: "src/db.ts", content: "import mongoose from 'mongoose'; export const db=mongoose;" }], "synthetic", [{ path: "package.json", dependencies: ["next", "react", "mongoose"] }]);
  expect(a.technology).toMatchObject({ frameworks: ["Next.js", "React"], databases: ["MongoDB"], persistence: ["Mongoose (ODM)"] });
  expect(a.technology?.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ package: "mongoose", kind: "import" }), expect.objectContaining({ package: "next", kind: "dependency" })]));
  expect(scanPresentation(a, "SQL_INJECTION").status).toBe("unsupported");
  const html = renderToStaticMarkup(<AnalysisSummary analysis={a} />);
  expect(html).toContain("NoSQL Injection은 미지원");
  expect(html).toContain("개발자용 전체 진단");
  expect(html).not.toMatch(/<details[^>]*open/);
});

it("recognizes file-level and inline Server Action FormData sources without inventing API URLs", () => {
  for (const directive of ["file", "inline"]) {
    const a = analyzeSourceFiles([{ path: "app/actions.ts", content: `${directive === "file" ? "'use server';" : ""} import {Pool} from 'pg'; const db=new Pool(); export async function search(data: FormData) { ${directive === "inline" ? "'use server';" : ""} const term=data.get('q'); return db.query('SELECT '+term); }` }]);
    expect(a.serverActions).toHaveLength(1);
    expect(a.sqlInjection?.findings[0].relationship).toBe("input-flow-observed");
    expect(a.sqlInjection?.findings[0].apiContexts).toEqual([]);
    expect(a.sqlInjection?.findings[0].evidence.some(e => e.description.includes("Server Action"))).toBe(true);
  }
});

it("traces async page searchParams and destructured Route Handler params", () => {
  const page = analyzeSourceFiles([{ path: "app/page.tsx", content: "import {Pool} from 'pg'; const db=new Pool(); export default async function Page({searchParams}) { const {q}=await searchParams; db.query('SELECT '+q); return <p>ok</p>; }" }]);
  expect(page.sqlInjection?.findings[0].relationship).toBe("input-flow-observed");
  const route = analyzeSourceFiles([{ path: "app/api/items/[id]/route.ts", content: "import {Pool} from 'pg'; const db=new Pool(); export async function GET(req, {params}) { const {id}=await params; return db.query('SELECT '+id); }" }]);
  expect(route.sqlInjection?.findings[0].relationship).toBe("input-flow-observed");
});

it("reviews only source-proven direct Mongoose Action calls and leaves policy/runtime unconfirmed", () => {
  const a = analyzeSourceFiles([{ path: "app/actions.ts", content: "'use server'; import {model} from 'mongoose'; const Order=model('Order', {}); export async function remove(data: FormData) { return Order.findByIdAndDelete(data.get('id')); }" }]);
  expect(a.accessControl?.findings.map(f => f.type)).toEqual(["IDOR", "AUTHORIZATION"]);
  expect(a.accessControl?.findings[0]).toMatchObject({ api: null, runtimeExploitation: "not-tested", assessment: "STATIC_REVIEW_ONLY" });
  expect(a.accessControl?.status).toBe("partial");
  const lookalike = analyzeSourceFiles([{ path: "app/actions.ts", content: "'use server'; const Order={findById:(id)=>id}; export async function load(id) { return Order.findById(id); }" }]);
  expect(lookalike.accessControl?.findings).toEqual([]);
});

it("classifies tags, globals, hooks and imported calls without hiding shadowed/internal calls", () => {
  const a = analyzeSourceFiles([{ path: "app/page.tsx", content: "import {useState} from 'react'; import clean from 'sanitize-html'; import Button from './missingButton'; export default function Page() { useState(''); Math.max(1,2); clean('x'); missingAuth(); return <svg><path /></svg>; }" }]);
  const relations = a.files.flatMap(f => f.functions.flatMap(fn => fn.relations ?? []));
  for (const kind of ["native-tag", "builtin", "react-hook", "external-library", "internal-unresolved"]) expect(relations.some(r => r.diagnosticKind === kind)).toBe(true);
  const html = renderToStaticMarkup(<AnalysisSummary analysis={a} />);
  expect(html).toContain("보안 관련 진단"); expect(html).toContain("missingAuth");
  expect(html.split("개발자용 전체 진단")[0]).not.toContain("./missingButton");
});

it("does not treat an ordinary FormData parameter as a Server Action", () => {
  const a = analyzeSourceFiles([{ path: "src/helper.ts", content: "export async function ordinary(data: FormData) { return data.get('id'); }" }]);
  expect(a.serverActions).toEqual([]);
  expect(a.sqlInjection?.coverage?.inputs).toEqual([]);
});
