import type { SourceInput } from "@/types/analysis";

/** Synthetic source only; no real traffic, stored data or authentication claims. */
export const httpBoundarySources: SourceInput[] = [
  { path: "app/page.tsx", content: [
    "export default function Page() {",
    "  async function submit(allowed: boolean, dynamicUrl: string) {",
    '    const URL = "/api/users/42";',
    '    if (allowed) { await fetch(URL, { method: "POST" }); }',
    "    fetch(dynamicUrl);",
    "  }",
    "  return <button onClick={() => submit(true, location.href)}>Send</button>;",
    "}",
  ].join("\n") },
  { path: "app/api/users/[id]/route.ts", content: [
    'import { processInput } from "../../../../lib/process";',
    "export function POST() { return processInput(); }",
  ].join("\n") },
  { path: "lib/process.ts", content: 'export function processInput() { throw new Error("example"); }' },
];
