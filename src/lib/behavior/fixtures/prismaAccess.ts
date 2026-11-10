import type { SourceInput } from "@/types/analysis";

/** Synthetic code; no database execution, result or authentication claims. */
export const prismaAccessSources: SourceInput[] = [
  {path:"lib/db.ts",content:'import { PrismaClient as Client } from "@prisma/client"; export const prisma = new Client();'},
  {path:"lib/query.ts",content:[
    "export async function lookup(client) {",
    "  if (allowed) { return await client.user.findUnique({ where: { id: 42 } }); }",
    "}",
  ].join("\n")},
  {path:"app/api/users/route.ts",content:[
    'import { prisma } from "../../../lib/db";',
    'import { lookup } from "../../../lib/query";',
    "export async function POST() {",
    "  await lookup(prisma);",
    "  await prisma.$transaction(async tx => { await tx.user.update({ where: { id: 42 }, data: { active: true } }); });",
    "  unknownDb.user.findMany();",
    "}",
  ].join("\n")},
  {path:"app/page.tsx",content:[
    "export default function Page() {",
    '  return <button onClick={() => fetch("/api/users", { method: "POST" })}>Send</button>;',
    "}",
  ].join("\n")},
];
