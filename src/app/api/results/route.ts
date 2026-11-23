import { handleResults } from "@/lib/results/handlers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleResults(request);
export const POST = (request: Request) => handleResults(request);
