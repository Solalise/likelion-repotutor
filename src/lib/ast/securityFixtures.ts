import type { SourceInput } from "@/types/analysis";

// Synthetic source only: never imported as application handlers or executed against a DB.
export const securityFixtures: Record<string, SourceInput[]> = {
  sqliVulnerable: [
    { path: "src/app/api/search/route.ts", content: "import { search } from '../../../search';\nexport function GET(req: Request) {\n const q = new URL(req.url).searchParams.get('q');\n return Response.json(search(q));\n}" },
    { path: "src/search.ts", content: "import { Pool } from 'pg';\nconst db = new Pool();\nexport function search(term: string) {\n return db.query('SELECT * FROM items WHERE name = ' + term);\n}" },
  ],
  sqliFixed: [
    { path: "src/app/api/search/route.ts", content: "import { search } from '../../../search';\nexport function GET(req: Request) {\n const q = new URL(req.url).searchParams.get('q');\n return Response.json(search(q));\n}" },
    { path: "src/search.ts", content: "import { Pool } from 'pg';\nconst db = new Pool();\nexport function search(term: string) {\n return db.query('SELECT * FROM items WHERE name = $1', [term]);\n}" },
  ],
  xssVulnerable: [
    { path: "src/app/api/echo/route.ts", content: "import { html } from '../../../html';\nexport function GET(req: Request) {\n const q = new URL(req.url).searchParams.get('q');\n return new Response(html(q), { headers: { 'Content-Type': 'text/html' } });\n}" },
    { path: "src/html.ts", content: "export function html(value: string) {\n return '<p>' + value + '</p>';\n}" },
  ],
  xssFixed: [{ path: "src/app/api/echo/route.ts", content: "export function GET(req: Request) {\n const q = new URL(req.url).searchParams.get('q');\n return Response.json({ text: q });\n}" }, { path: "src/view.tsx", content: "export function View({ text }: { text: string }) { return <p>{text}</p>; }\nconst node = document.createElement('p');\nnode.textContent = location.hash;" }],
  idorVulnerable: [{ path: "src/app/api/orders/[id]/route.ts", content: "import { PrismaClient } from '@prisma/client';\nconst db = new PrismaClient();\nexport async function GET(req: Request, context: { params: Promise<{ id: string }> }) {\n const id = (await context.params).id;\n return Response.json(await db.order.findUnique({ where: { id } }));\n}" }],
  idorFixed: [{ path: "src/app/api/orders/[id]/route.ts", content: "import { PrismaClient } from '@prisma/client';\nimport { getServerSession } from 'next-auth';\nconst db = new PrismaClient();\nexport async function GET(req: Request, context: { params: Promise<{ id: string }> }) {\n const session = await getServerSession();\n if (!session) return new Response(null, { status: 401 });\n const id = (await context.params).id;\n return Response.json(await db.order.findFirst({ where: { id, ownerId: session.user.id } }));\n}" }],
  authorizationVulnerable: [{ path: "src/app/api/admin/users/route.ts", content: "import { PrismaClient } from '@prisma/client';\nconst db = new PrismaClient();\nexport async function GET() {\n return Response.json(await db.user.findMany());\n}" }],
  authorizationFixed: [{ path: "src/app/api/admin/users/route.ts", content: "import { PrismaClient } from '@prisma/client';\nimport { getServerSession } from 'next-auth';\nconst db = new PrismaClient();\nexport async function GET() {\n const session = await getServerSession();\n if (!session || session.user.role !== 'ADMIN') return new Response(null, { status: 403 });\n return Response.json(await db.user.findMany());\n}" }],
  unsupportedLanguage: [{ path: "api/search.py", content: "def search(request): pass" }],
  unsupportedFramework: [{ path: "server.ts", content: "import express from 'express';\nconst app = express();\napp.get('/orders/:id', (req, res) => res.json(customStore.find(req.params.id)));" }],
  uncertainReturn: [{ path: "src/app/api/echo/route.ts", content: "function transform(value: string) { if (value) return value; return ''; }\nexport function GET(req: Request) {\n return new Response(transform(req.url), { headers: { 'Content-Type': 'text/html' } });\n}" }],
  unrelated: [{ path: "src/safe.ts", content: "const cache = { query: (text: string) => text };\ncache.query('hello');\nconst node = document.createElement('p');\nnode.textContent = location.hash;" }],
};
