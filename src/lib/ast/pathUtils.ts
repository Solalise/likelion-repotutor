import { createHash } from "node:crypto";

const CODE_EXTENSION = /\.(?:tsx?|jsx?)$/;

export function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function withoutExtension(filePath: string): string {
  return normalizePath(filePath).replace(CODE_EXTENSION, "");
}

export function fileNodeId(filePath: string): string {
  return `file:${normalizePath(filePath)}`;
}

/** Identity is deterministic within a source snapshot; edits before a declaration can change it. */
export function symbolNodeId(filePath: string, symbol: string, declaration: { start: number; scope: string }): string {
  // Keep deep lexical scopes compact for graph selection and AI selection requests.
  const scope = createHash("sha256").update(declaration.scope).digest("hex").slice(0, 16);
  return `symbol:${normalizePath(filePath)}#${symbol}@${declaration.start}[${scope}]`;
}
