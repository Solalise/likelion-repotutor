import "server-only";
import { createManagedProbePolicy, ManagedProbeError } from "./managedProbePolicy";
import type { SqliRequestDraft } from "./sqliTypes";
import { isSafeSqliPair, safeSqliProbe } from "./sqliProbe";
import { managedSqliRegistry } from "./sqliRegistry";
const policy = createManagedProbePolicy<SqliRequestDraft>({ version: "sqli-practice-v1", prefix: "sqli:", marker: safeSqliProbe, validInputs: isSafeSqliPair, registry: managedSqliRegistry });
export const { approvalFingerprint, selectApproval: selectSqliApproval, parseDraft: parseSqliDraft } = policy;
export { ManagedProbeError as SqliExecutionError };
