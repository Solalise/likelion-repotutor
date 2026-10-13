import { promises as fs } from "node:fs";
import path from "node:path";
import type { SourceInput } from "@/types/analysis";

const SUPPORTED_EXTENSION = /\.(?:tsx?|jsx?)$/;

async function walk(directory: string, root: string): Promise<SourceInput[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(absolutePath, root);
    if (!entry.isFile() || !SUPPORTED_EXTENSION.test(entry.name)) return [];
    return [{ path: path.relative(root, absolutePath).replaceAll("\\", "/"), content: await fs.readFile(absolutePath, "utf8") }];
  }));
  return nested.flat();
}

export async function loadLocalRepository(directory: string): Promise<SourceInput[]> {
  return walk(directory, directory);
}
