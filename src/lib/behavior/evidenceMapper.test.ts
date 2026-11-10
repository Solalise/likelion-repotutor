import { describe, expect, it } from "vitest";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import { createEvidenceMapper } from "./evidenceMapper";
import { nextLoginSources } from "./fixtures/nextLogin";

const analysis = analyzeSourceFiles(nextLoginSources);
const source = analysis.files.flatMap(file => file.functions).find(fn => fn.name === "onSubmit")!;
const call = source.relations!.find(item => item.relation === "call")!;
const edge = analysis.edges.find(item => item.source === source.id && item.relation === "call")!;

describe("behavior evidence mapping", () => {
  it("maps exact original node/edge IDs and source locations without generated excerpts", () => {
    const evidence = createEvidenceMapper(analysis).edgeEvidence(edge);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      location: { filePath: "app/login/page.tsx", startLine: 3, endLine: 3, precision: "line" },
      excerpt: "  const onSubmit = () => submit();", confidence: "confirmed", sourceNodeIds: [source.id], sourceEdgeIds: [edge.id],
    });
  });

  it("maps multiline call evidence to a true source range", () => {
    const input = analyzeSourceFiles([{ path: "app/page.tsx", content: [
      "function helper(value: object) { return value; }", "export default function Page() {", "  helper(", "    { ok: true }", "  );", "  return <div/>;", "}",
    ].join("\n") }]);
    const callEdge = input.edges.find(item => item.relation === "call")!;
    const mapped = createEvidenceMapper(input).edgeEvidence(callEdge)[0];
    expect(mapped.location).toMatchObject({ precision: "range", startLine: 3, endLine: 5 });
    expect(mapped.excerpt).toBe("  helper(\n    { ok: true }\n  );");
  });

  it("rejects unknown nodes, edges, changed excerpts, and invalid lines", () => {
    const mapper = createEvidenceMapper(analysis);
    expect(mapper.declaration("not-a-node")).toBeUndefined();
    expect(mapper.relation(source.id, { ...call, evidence: "invented()" }, [edge.id])).toBeUndefined();
    expect(mapper.relation(source.id, call, ["not-an-edge"])).toBeUndefined();
    const broken = structuredClone(analysis);
    broken.files.find(file => file.path === source.filePath)!.functions.find(fn => fn.id === source.id)!.relations!.find(item => item.relation === "call")!.line = 999;
    expect(createEvidenceMapper(broken).edgeEvidence(edge)).toEqual([]);
  });

  it("does not anchor evidence on a previous unrelated line", () => {
    const input = analyzeSourceFiles([{ path: "app/page.tsx", content: "function helper() {}\nexport default function Page() {\n  const unrelated = 1;\n  helper();\n  return <div/>;\n}" }]);
    const fn = input.files[0].functions.find(fn => fn.name === "Page")!;
    const relation = fn.relations!.find(item => item.relation === "call")!;
    relation.line = 3;
    const graphEdge = input.edges.find(item => item.relation === "call")!;
    graphEdge.line = 3;
    expect(createEvidenceMapper(input).edgeEvidence(graphEdge)).toEqual([]);
  });

  it("rejects conflicting duplicate IDs rather than arbitrarily choosing a declaration", () => {
    const input = structuredClone(analysis);
    const original = input.nodes.find(node => node.id === source.id)!;
    input.nodes.push({ ...original, sourceCode: "() => invented()" });
    expect(createEvidenceMapper(input).declaration(source.id)).toBeUndefined();
  });

  it("keeps inferred evidence inferred and never fabricates a missing line", () => {
    const input = analyzeSourceFiles([{ path: "app/page.tsx", content: "export default function Page() { unknownFunction(); return <div/>; }" }]);
    const fn = input.files[0].functions[0];
    const relation = fn.relations!.find(item => item.relation === "call")!;
    const mapped = createEvidenceMapper(input).relation(fn.id, relation)!;
    expect(mapped.confidence).toBe("inferred");
    expect(mapped.sourceEdgeIds).toEqual([]);
    expect(mapped.location).toMatchObject({ startLine: 1, endLine: 1 });
  });
});
