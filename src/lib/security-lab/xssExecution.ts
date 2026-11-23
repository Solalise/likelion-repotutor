import "server-only";
import { createManagedProbeExecutor } from "./managedProbeExecution";
import { selectXssApproval, xssApprovalFingerprint } from "./xssPolicy";
import type { XssRequestDraft } from "./xssTypes";
const executor = createManagedProbeExecutor<XssRequestDraft>({ select: selectXssApproval, fingerprint: xssApprovalFingerprint, counter: "xssExecution", hasCandidate: (analysis, id) => Boolean(analysis.xss?.findings.some(f => f.id === id && f.disposition === "candidate")) });
export const { status: xssExecutionStatus, execute: executeXssPair } = executor;
