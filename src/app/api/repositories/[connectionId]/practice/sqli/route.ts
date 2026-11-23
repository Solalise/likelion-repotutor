import { createProbeRoute } from "@/lib/security-lab/managedProbeRoute";
import { parseSqliDraft } from "@/lib/security-lab/sqliPolicy";
import { sqliExecutionStatus, executeSqliPair } from "@/lib/security-lab/sqliExecution";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export const POST = createProbeRoute({ parse: parseSqliDraft, status: sqliExecutionStatus, execute: executeSqliPair });
