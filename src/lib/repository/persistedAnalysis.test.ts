import { expect, it } from "vitest";
import { analyzeSourceFiles } from "@/lib/ast/analyzer";
import { restoreAnalysis, serializeAnalysis, storedCode, storedGuide } from "./persistedAnalysis";
import type { RepositoryAnalysis } from "@/types/analysis";

it("persists security evidence, stack, versions and guides without complete sources or secret literals", () => {
  const analysis = { ...analyzeSourceFiles([{ path: "app/api/items/route.ts", content:
    'export async function GET(request: Request) { const unused = "PRIVATE_LITERAL_123"; const value = request.url; return db.query("select * from items where id=" + value); }',
  }], "org/app"), source: "github" as const,
    collection: { source: "github" as const, commitSha: "a".repeat(40), discoveredFiles: 1, collectedFiles: 1, totalBytes: 200, durationMs: 1, partial: false } };
  const stored = serializeAnalysis(analysis);
  const json = JSON.stringify(stored);
  expect(json).not.toContain("PRIVATE_LITERAL_123");
  expect(stored.analysis.files[0].sourceCode).toBe("");
  expect(stored.analysis.files[0].functions.every(fn => fn.sourceCode === "")).toBe(true);
  expect(stored.analysis.scannerRevision).toBe(analysis.scannerRevision);
  expect(stored.analysis.sqlInjection?.findings.length).toBe(analysis.sqlInjection?.findings.length);
  expect(stored.baseGuide.guides).toHaveLength(4);
  const restored = restoreAnalysis({ analysisResult: JSON.parse(json), commitSha: analysis.collection.commitSha, completedAt: new Date("2026-11-24T00:00:00Z") }, "org/app")!;
  expect(restored.analyzedAt).toBe("2026-11-24T00:00:00.000Z");
  expect(restored.savedReviewGuides).toEqual(stored.baseGuide);
  expect(restored.stats).toEqual(analysis.stats);
  expect(restoreAnalysis({ analysisResult: stored, commitSha: "b".repeat(40) }, "org/app")).toBeNull();
  expect(restoreAnalysis({ analysisResult: stored, commitSha: analysis.collection.commitSha }, "other/app")).toBeNull();
});

it("removes tokens, environment reads and literals in bounded evidence and saved guide sources", () => {
  for (const code of ['const key = "gsk_private_value";', 'process.env.PRIVATE_VALUE', '// password=hunter2\ndb.query(input)', 'const a = `secret-value ${input}`;']) {
    const result = storedCode(code);
    expect(result).not.toMatch(/gsk_private_value|process\.env|hunter2|secret-value/);
  }
  const bundle = storedGuide({ origin: "ai", guides: [], reason: "Authorization: Bearer private" });
  expect(JSON.stringify(bundle)).not.toContain("Bearer private");
});

it("keeps sensitive identities distinct and references consistent without storing their original values", () => {
  const first = "gsk_private_first", second = "gsk_private_second";
  const analysis: RepositoryAnalysis = { repository: "org/app", source: "github", files: [], stats: { files: 0, functions: 0, relations: 1 },
    nodes: [first, second].map(id => ({ id, type: "file", name: "file", filePath: id })),
    edges: [{ id: "edge", source: first, target: second, relation: "import" }] };
  const stored = serializeAnalysis(analysis).analysis;
  expect(stored.nodes[0].id).not.toBe(stored.nodes[1].id);
  expect(stored.nodes[0].id).toMatch(/^private-ref:[a-f0-9]{64}$/);
  expect(stored.edges[0].source).toBe(stored.nodes[0].id);
  expect(stored.edges[0].target).toBe(stored.nodes[1].id);
  expect(stored.nodes[0].filePath).toBe(stored.nodes[0].id);
  expect(serializeAnalysis(analysis).analysis.nodes).toEqual(stored.nodes);
  expect(JSON.stringify(stored)).not.toContain(first);
  expect(JSON.stringify(stored)).not.toContain(second);
});
