import type { SourceInput } from "@/types/analysis";

/** Synthetic source; no DB, network request, response delivery or runtime result is observed. */
export const serverResponseSources:SourceInput[]=[
  {path:"app/api/users/route.ts",content:[
    'import {NextResponse} from "next/server";',
    'import {PrismaClient} from "@prisma/client";',
    'const prisma=new PrismaClient();',
    'export async function GET() {',
    '  const user=await prisma.user.findUnique({where:{id:42}});',
    '  const alias=user;',
    '  const unused=NextResponse.json({preview:true});',
    '  if (!user) return NextResponse.json({error:"missing"},{status:404});',
    '  const response=NextResponse.json({user:alias},{status:200});',
    '  return response;',
    '}',
  ].join("\n")},
  {path:"app/page.tsx",content:'export default function Page(){return <button onClick={()=>fetch("/api/users")}>Load</button>;}'},
];
