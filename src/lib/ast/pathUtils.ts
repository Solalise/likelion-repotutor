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

export function symbolNodeId(filePath: string, symbol: string): string {
  return `symbol:${normalizePath(filePath)}#${symbol}`;
}
