import type { SourceInput } from "@/types/analysis";

/** Hand-written integration repository. Source is never executed. */
export const pipelineSources:SourceInput[]=[
 {path:"app/login/page.tsx",content:[
  '"use client";',
  'import type {FormEvent} from "react";',
  'import {sendLogin} from "../../client";',
  'function Widget(_props:{onClick?:(event:FormEvent<HTMLFormElement>)=>Promise<void>}){return <div/>;}',
  'export default function LoginPage(){',
  ' async function handleLogin(event:FormEvent<HTMLFormElement>){event.preventDefault(); await sendLogin();}',
  ' return <><form onSubmit={handleLogin}><button>Login</button></form><Widget onClick={handleLogin}/></>;',
  '}',
 ].join("\n")},
 {path:"client.ts",content:[
  'export async function sendLogin(allowed:boolean=Math.random()>0.5,dynamicUrl:string=location.pathname){',
  ' if (allowed) return fetch("/api/login",{method:"POST"});',
  ' fetch("https://external.example/api/login",{method:"POST"});',
  ' return fetch(dynamicUrl);',
  '}',
  'export function unrelated(){return fetch("/api/unrelated");}',
 ].join("\n")},
 {path:"app/api/login/route.ts",content:[
  'import {PrismaClient} from "@prisma/client";',
  'const prisma=new PrismaClient();',
  'export async function POST(){',
  ' const user=await prisma.user.findUnique({where:{id:42}});',
  ' if (!user) return Response.json({error:"missing"},{status:404});',
  ' const preview=Response.json({preview:true});',
  ' return Response.json({user},{status:200});',
  '}',
 ].join("\n")},
 {path:"app/api/unrelated/route.ts",content:'export function GET(){return Response.json({unrelated:true});}'},
 {path:"app/api/limits/route.ts",content:[
  'import {PrismaClient} from "@prisma/client";',
  'const cached=(globalThis as unknown as {client?:PrismaClient}).client ?? new PrismaClient();',
  'function wrap(value:unknown){return Response.json(value);}',
  'function value(){return {id:1};}',
  'const items:number[]=[]; const choice:number=Date.now(); function work(_value:number){}',
  'export function GET(){',
  ' const fake={user:{findUnique(){return null;}}}; fake.user.findUnique();',
  ' cached.user.findMany();',
  ' for(const item of items){work(item);}',
  ' switch(choice){case 1: work(choice); break; default: break;}',
  ' return wrap(value());',
  '}',
 ].join("\n")},
];
