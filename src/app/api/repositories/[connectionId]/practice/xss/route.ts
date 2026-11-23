import { createProbeRoute } from "@/lib/security-lab/managedProbeRoute";
import { parseXssDraft } from "@/lib/security-lab/xssPolicy";
import { xssExecutionStatus, executeXssPair } from "@/lib/security-lab/xssExecution";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export const POST = createProbeRoute({ parse: parseXssDraft, status: xssExecutionStatus, execute: executeXssPair });
