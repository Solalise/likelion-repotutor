import "server-only";
import { createManagedProbePolicy, ManagedProbeError } from "./managedProbePolicy";
import { managedXssRegistry } from "./xssRegistry";
import { safeXssProbe, isSafeXssPair } from "./xssProbe";
import type { XssRequestDraft } from "./xssTypes";
const policy = createManagedProbePolicy<XssRequestDraft>({ version: "xss-practice-v1", prefix: "xss:", marker: safeXssProbe, validInputs: isSafeXssPair, registry: managedXssRegistry });
export const { approvalFingerprint: xssApprovalFingerprint, selectApproval: selectXssApproval, parseDraft: parseXssDraft } = policy;
export { ManagedProbeError as XssExecutionError };
