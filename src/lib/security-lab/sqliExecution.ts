import "server-only";
import { createManagedProbeExecutor } from "./managedProbeExecution";
import { approvalFingerprint, selectSqliApproval } from "./sqliPolicy";
import type { SqliRequestDraft } from "./sqliTypes";
const executor = createManagedProbeExecutor<SqliRequestDraft>({ select: selectSqliApproval, fingerprint: approvalFingerprint, counter: "sqliExecution", hasCandidate: (analysis, id) => Boolean(analysis.sqlInjection?.findings.some(f => f.id === id)) });
export const { status: sqliExecutionStatus, execute: executeSqliPair } = executor;
