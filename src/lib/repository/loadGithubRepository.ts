import { gunzipSync } from "node:zlib";
import type { SourceInput } from "@/types/analysis";

const GITHUB_API_ORIGIN = "https://api.github.com";
const GITHUB_ARCHIVE_ORIGIN = "https://codeload.github.com";
const SUPPORTED_EXTENSION = /\.(?:tsx?|jsx?)$/i;
const EXCLUDED_DIRECTORY = /^(?:node_modules|\.next|dist|build|coverage|\.git|generated|__generated__|fixtures?|__fixtures__)$/i;
const GENERATED_FILE = /(?:\.d\.ts|\.min\.[cm]?[jt]sx?|(?:^|[._-])(?:generated|gen)(?:[._-]|\.[cm]?[jt]sx?$))/i;
const COMMIT_SHA = /^[0-9a-f]{40}$/i;

export const GITHUB_COLLECTION_LIMITS = {
  maxFiles: 40, maxFileBytes: 256 * 1024, maxTotalBytes: 2 * 1024 * 1024,
  maxArchiveBytes: 15 * 1024 * 1024, maxExtractedBytes: 50 * 1024 * 1024,
  timeoutMs: 20_000, freshnessTtlMs: 60_000, cacheTtlMs: 30 * 60_000, maxCacheEntries: 8,
} as const;

export interface GithubRepositoryCoordinates { owner: string; repo: string; fullName: string; url: string }
export interface GithubCollectionInfo {
  repositoryUrl: string; defaultBranch: string; commitSha: string;
  discoveredFiles: number; collectedFiles: number; totalBytes: number; archiveBytes: number;
  durationMs: number; partial: boolean; treeTruncated: boolean; cached: boolean; apiRequestCount: number;
  notice?: string;
}
export interface GithubRepositoryLoadResult { repository: string; sources: SourceInput[]; collection: GithubCollectionInfo }

interface GithubRepositoryResponse { default_branch: string | null; full_name: string }
interface GithubCommitResponse { sha: string }
interface ArchiveFile { path: string; size: number; content: Buffer }
interface RepositoryCacheEntry {
  repository: string; defaultBranch: string; commitSha: string; checkedAt: number; metadataAt: number;
}
interface SourceCacheEntry { value: GithubRepositoryLoadResult; storedAt: number }

const repositoryCache = new Map<string, RepositoryCacheEntry>();
const sourceCache = new Map<string, SourceCacheEntry>();
const inFlight = new Map<string, Promise<GithubRepositoryLoadResult>>();

export class GithubRepositoryError extends Error {
  constructor(message: string, public readonly status = 500) { super(message); this.name = "GithubRepositoryError"; }
}

function isValidOwner(value: string): boolean {
  return value.length <= 39 && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(value) && !value.includes("--");
}
function isValidRepositoryName(value: string): boolean {
  return value.length <= 100 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !value.includes("..");
}

export function parseGithubRepositoryUrl(input: string): GithubRepositoryCoordinates {
  let parsed: URL;
  try { parsed = new URL(input.trim()); } catch { throw new GithubRepositoryError("올바른 GitHub 저장소 URL을 입력해 주세요.", 400); }
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new GithubRepositoryError("https://github.com/owner/repo 형식의 공개 저장소 URL만 지원합니다.", 400);
  }
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length !== 2) throw new GithubRepositoryError("파일이나 브랜치 URL이 아닌 https://github.com/owner/repo 형식으로 입력해 주세요.", 400);
  const [owner, rawRepo] = parts;
  const repo = rawRepo.endsWith(".git") ? rawRepo.slice(0, -4) : rawRepo;
  if (!isValidOwner(owner) || !isValidRepositoryName(repo)) throw new GithubRepositoryError("GitHub owner 또는 저장소 이름이 올바르지 않습니다.", 400);
  return { owner, repo, fullName: `${owner}/${repo}`, url: `https://github.com/${owner}/${repo}` };
}

function shouldCollect(path: string, size: number): boolean {
  const parts = path.split("/");
  const fileName = parts.at(-1) ?? "";
  return SUPPORTED_EXTENSION.test(fileName) && !parts.slice(0, -1).some((part) => EXCLUDED_DIRECTORY.test(part))
    && !GENERATED_FILE.test(fileName) && size > 0 && size <= GITHUB_COLLECTION_LIMITS.maxFileBytes;
}
function isToolingFile(filePath: string): boolean {
  return /(?:^|\/)(?:plugins?|scripts?|config|configs|tooling|buildSrc|\.github)(?:\/|$)|(?:^|\/)(?:babel|metro|webpack|vite|jest|eslint|prettier)\.config\./i.test(filePath);
}
function sourcePriority(filePath: string): number {
  if (/(?:^|\/)app\//i.test(filePath) || /(?:^|\/)src\/features?\/.+\/(?:screens?|views?|routes?)\//i.test(filePath)) return 0;
  if (/(?:^|\/)src\/(?:features?|screens?|routes?|api|domain|services?)\//i.test(filePath)) return 1;
  if (/(?:^|\/)src\//i.test(filePath)) return 2;
  if (/(?:^|\/)(?:test|tests|__tests__)(?:\/|$)/i.test(filePath)) return 5;
  if (isToolingFile(filePath)) return 8;
  return 4;
}
function collectionBucket(filePath: string): "entry" | "screen" | "logic" | "shared" | "tooling" | "other" {
  if (isToolingFile(filePath)) return "tooling";
  if (/(?:^|\/)app\//i.test(filePath) || /(?:route|page)\.[cm]?[jt]sx?$/i.test(filePath)) return "entry";
  if (/(?:^|\/)(?:screens?|views?)\//i.test(filePath)) return "screen";
  if (/(?:^|\/)src\/features?\/.+\/(?:services?|utils?)\//i.test(filePath)) return "logic";
  if (/(?:^|\/)src\/components\/(?:common|ui|layout|feedback)\//i.test(filePath)) return "shared";
  return "other";
}

function apiUrl(pathname: string): string { return `${GITHUB_API_ORIGIN}${pathname}`; }
function githubHeaders(): HeadersInit {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "RepoTutor" };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}
function waitMessage(response: Response): string {
  const retryAfter = Number(response.headers.get("retry-after"));
  const resetAt = Number(response.headers.get("x-ratelimit-reset")) * 1000;
  const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000
    : Number.isFinite(resetAt) && resetAt > Date.now() ? resetAt - Date.now() : 0;
  return waitMs > 0 ? ` 약 ${Math.max(1, Math.ceil(waitMs / 60_000))}분 후 다시 시도해 주세요.` : " 잠시 후 다시 시도해 주세요.";
}

async function githubJson<T>(url: string, deadline: number, fetcher: typeof fetch): Promise<T> {
  if (!url.startsWith(`${GITHUB_API_ORIGIN}/`)) throw new GithubRepositoryError("허용되지 않은 GitHub API 요청입니다.", 400);
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new GithubRepositoryError("GitHub 저장소를 가져오는 시간이 초과되었습니다. 더 작은 저장소로 다시 시도해 주세요.", 504);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), remaining);
  try {
    const response = await fetcher(url, { headers: githubHeaders(), signal: controller.signal, cache: "no-store" });
    if (response.ok) return await response.json() as T;
    const remainingRequests = response.headers.get("x-ratelimit-remaining");
    if (response.status === 401) throw new GithubRepositoryError("GitHub 인증에 실패했습니다. 서버의 GITHUB_TOKEN 설정을 확인해 주세요.", 502);
    if ((response.status === 403 && remainingRequests === "0") || response.status === 429) {
      throw new GithubRepositoryError(`GitHub API 기본 요청 한도를 초과했습니다.${waitMessage(response)}`, 429);
    }
    if (response.status === 403) throw new GithubRepositoryError(`GitHub가 일시적으로 요청을 제한했습니다(secondary rate limit 또는 접근 제한).${waitMessage(response)}`, 429);
    if (response.status === 404) throw new GithubRepositoryError("공개 저장소를 찾을 수 없습니다. URL과 저장소 공개 여부를 확인해 주세요.", 404);
    if (response.status === 409) throw new GithubRepositoryError("커밋이 없는 빈 저장소는 분석할 수 없습니다.", 422);
    throw new GithubRepositoryError(`GitHub API 요청에 실패했습니다. (상태 코드 ${response.status})`, 502);
  } catch (error: unknown) {
    if (error instanceof GithubRepositoryError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new GithubRepositoryError("GitHub 저장소를 가져오는 시간이 초과되었습니다. 더 작은 저장소로 다시 시도해 주세요.", 504);
    throw new GithubRepositoryError("GitHub에 연결하지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.", 502);
  } finally { clearTimeout(timeout); }
}

async function resolveArchiveHead(coordinates: GithubRepositoryCoordinates, deadline: number, fetcher: typeof fetch): Promise<string> {
  const url = `https://github.com/${coordinates.owner}/${coordinates.repo}/archive/HEAD.tar.gz`;
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new GithubRepositoryError("GitHub 저장소 확인 시간이 초과되었습니다.", 504);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), remaining);
  try {
    const response = await fetcher(url, {
      headers: { Accept: "application/gzip", "User-Agent": "RepoTutor" },
      signal: controller.signal,
      cache: "no-store",
      redirect: "manual",
    });
    if (![301, 302, 307, 308].includes(response.status)) throw new GithubRepositoryError("GitHub 기본 브랜치 아카이브를 확인하지 못했습니다.", 502);
    const location = response.headers.get("location");
    if (!location) throw new GithubRepositoryError("GitHub 기본 브랜치 아카이브 위치가 없습니다.", 502);
    const target = new URL(location);
    const expectedPrefix = `/${coordinates.owner}/${coordinates.repo}/tar.gz/`;
    if (target.protocol !== "https:" || target.origin !== GITHUB_ARCHIVE_ORIGIN || !target.pathname.startsWith(expectedPrefix)) {
      throw new GithubRepositoryError("허용되지 않은 GitHub 아카이브 이동 경로입니다.", 502);
    }
    const sha = target.pathname.slice(expectedPrefix.length);
    if (!COMMIT_SHA.test(sha)) throw new GithubRepositoryError("GitHub 아카이브의 커밋 정보가 올바르지 않습니다.", 502);
    return sha;
  } catch (error: unknown) {
    if (error instanceof GithubRepositoryError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new GithubRepositoryError("GitHub 저장소 확인 시간이 초과되었습니다.", 504);
    throw new GithubRepositoryError("GitHub 기본 브랜치 아카이브를 확인하지 못했습니다.", 502);
  } finally { clearTimeout(timeout); }
}

function setBounded<K, V>(cache: Map<K, V>, key: K, value: V, maxEntries: number = GITHUB_COLLECTION_LIMITS.maxCacheEntries): void {
  cache.delete(key); cache.set(key, value);
  while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
}
function getCachedSources(key: string, now: number): GithubRepositoryLoadResult | undefined {
  const entry = sourceCache.get(key);
  if (!entry) return undefined;
  if (now - entry.storedAt >= GITHUB_COLLECTION_LIMITS.cacheTtlMs) { sourceCache.delete(key); return undefined; }
  sourceCache.delete(key); sourceCache.set(key, entry);
  return entry.value;
}
function cachedResult(value: GithubRepositoryLoadResult, startedAt: number, apiRequestCount: number): GithubRepositoryLoadResult {
  return { ...value, sources: [...value.sources], collection: { ...value.collection, cached: true, apiRequestCount, durationMs: Date.now() - startedAt } };
}

function diversifyFeatures(items: ArchiveFile[]): ArchiveFile[] {
  const groups = new Map<string, ArchiveFile[]>();
  for (const item of items) {
    const group = item.path.match(/(?:^|\/)src\/features?\/([^/]+)/i)?.[1] ?? item.path;
    groups.set(group, [...(groups.get(group) ?? []), item]);
  }
  const result: ArchiveFile[] = [];
  let index = 0;
  while (result.length < items.length) {
    let added = false;
    for (const group of groups.values()) {
      if (group[index]) { result.push(group[index]); added = true; }
    }
    if (!added) break;
    index += 1;
  }
  return result;
}

function selectWithinLimits(items: ArchiveFile[]): ArchiveFile[] {
  const sorted = [...items].sort((a, b) => sourcePriority(a.path) - sourcePriority(b.path) || a.path.localeCompare(b.path));
  const buckets = new Map<string, ArchiveFile[]>();
  for (const item of sorted) { const bucket = collectionBucket(item.path); buckets.set(bucket, [...(buckets.get(bucket) ?? []), item]); }
  const quotas = { entry: 12, screen: 12, logic: 8, shared: 4, tooling: 4 } as const;
  const reserved = Object.entries(quotas).flatMap(([bucket, count]) => {
    const candidates = buckets.get(bucket) ?? [];
    return (bucket === "screen" || bucket === "logic" ? diversifyFeatures(candidates) : candidates).slice(0, count);
  });
  const reservedPaths = new Set(reserved.map((item) => item.path));
  const ordered = [...reserved, ...sorted.filter((item) => !reservedPaths.has(item.path))];
  const selected: ArchiveFile[] = [];
  let totalBytes = 0;
  for (const item of ordered) {
    if (selected.length >= GITHUB_COLLECTION_LIMITS.maxFiles) break;
    if (totalBytes + item.size > GITHUB_COLLECTION_LIMITS.maxTotalBytes) continue;
    selected.push(item); totalBytes += item.size;
  }
  return selected;
}

function tarString(buffer: Buffer, start: number, length: number): string {
  const end = buffer.indexOf(0, start);
  return buffer.subarray(start, end >= start && end < start + length ? end : start + length).toString("utf8").trim();
}
function tarSize(buffer: Buffer, offset: number): number {
  const value = tarString(buffer, offset + 124, 12).replace(/\0/g, "").trim();
  if (!/^[0-7]*$/.test(value)) throw new GithubRepositoryError("GitHub 저장소 압축 파일의 형식이 올바르지 않습니다.", 502);
  return value ? Number.parseInt(value, 8) : 0;
}
function safeArchivePath(rawPath: string): string | undefined {
  if (!rawPath || rawPath.includes("\\") || rawPath.startsWith("/") || /^[A-Za-z]:/.test(rawPath)) {
    throw new GithubRepositoryError("안전하지 않은 경로가 저장소 압축 파일에서 발견되었습니다.", 422);
  }
  const parts = rawPath.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) throw new GithubRepositoryError("안전하지 않은 경로가 저장소 압축 파일에서 발견되었습니다.", 422);
  return parts.length <= 1 ? undefined : parts.slice(1).join("/");
}
function paxPath(buffer: Buffer): string | undefined {
  let cursor = 0;
  while (cursor < buffer.length) {
    const space = buffer.indexOf(32, cursor);
    if (space < 0) break;
    const length = Number.parseInt(buffer.subarray(cursor, space).toString("ascii"), 10);
    if (!Number.isSafeInteger(length) || length <= 0 || cursor + length > buffer.length) break;
    const record = buffer.subarray(space + 1, cursor + length - 1).toString("utf8");
    if (record.startsWith("path=")) return record.slice(5);
    cursor += length;
  }
  return undefined;
}
function parseTar(buffer: Buffer, deadline: number): ArchiveFile[] {
  const files: ArchiveFile[] = [];
  let offset = 0;
  let pendingPath: string | undefined;
  while (offset + 512 <= buffer.length) {
    if (Date.now() > deadline) throw new GithubRepositoryError("GitHub 저장소 압축 해제 시간이 초과되었습니다.", 504);
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const headerPath = prefix ? `${prefix}/${name}` : name;
    const size = tarSize(buffer, offset);
    const type = header[156];
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (!Number.isSafeInteger(size) || size < 0 || dataEnd > buffer.length) throw new GithubRepositoryError("GitHub 저장소 압축 파일이 손상되었습니다.", 502);
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === 120) pendingPath = paxPath(data);
    else if (type === 76) pendingPath = tarString(data, 0, data.length);
    else if (type === 0 || type === 48) {
      const path = safeArchivePath(pendingPath ?? headerPath);
      if (path && shouldCollect(path, size)) files.push({ path, size, content: buffer.subarray(dataStart, dataEnd) });
      pendingPath = undefined;
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return files;
}

async function downloadArchive(coordinates: GithubRepositoryCoordinates, sha: string, deadline: number, fetcher: typeof fetch): Promise<{ files: ArchiveFile[]; archiveBytes: number }> {
  const url = `${GITHUB_ARCHIVE_ORIGIN}/${coordinates.owner}/${coordinates.repo}/tar.gz/${sha}`;
  if (!url.startsWith(`${GITHUB_ARCHIVE_ORIGIN}/`) || !COMMIT_SHA.test(sha)) throw new GithubRepositoryError("허용되지 않은 GitHub 아카이브 요청입니다.", 400);
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new GithubRepositoryError("GitHub 저장소 다운로드 시간이 초과되었습니다.", 504);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), remaining);
  try {
    const response = await fetcher(url, { headers: { Accept: "application/gzip", "User-Agent": "RepoTutor" }, signal: controller.signal, cache: "no-store" });
    if (!response.ok) {
      if (response.status === 404) throw new GithubRepositoryError("저장소 아카이브를 찾을 수 없습니다.", 404);
      throw new GithubRepositoryError(`GitHub 저장소 아카이브 다운로드에 실패했습니다. (상태 코드 ${response.status})`, 502);
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > GITHUB_COLLECTION_LIMITS.maxArchiveBytes) throw new GithubRepositoryError("저장소 압축 파일이 허용 크기를 초과했습니다.", 413);
    if (!response.body) throw new GithubRepositoryError("GitHub 저장소 아카이브 응답이 비어 있습니다.", 502);
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let archiveBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      archiveBytes += value.byteLength;
      if (archiveBytes > GITHUB_COLLECTION_LIMITS.maxArchiveBytes) { await reader.cancel(); throw new GithubRepositoryError("저장소 압축 파일이 허용 크기를 초과했습니다.", 413); }
      chunks.push(Buffer.from(value));
    }
    let extracted: Buffer;
    try { extracted = gunzipSync(Buffer.concat(chunks), { maxOutputLength: GITHUB_COLLECTION_LIMITS.maxExtractedBytes }); }
    catch { throw new GithubRepositoryError("저장소 압축 해제 크기가 허용 한도를 초과했거나 압축 파일이 손상되었습니다.", 413); }
    return { files: parseTar(extracted, deadline), archiveBytes };
  } catch (error: unknown) {
    if (error instanceof GithubRepositoryError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new GithubRepositoryError("GitHub 저장소 다운로드 시간이 초과되었습니다.", 504);
    throw new GithubRepositoryError("GitHub 저장소 아카이브를 다운로드하지 못했습니다.", 502);
  } finally { clearTimeout(timeout); }
}

async function loadGithubRepositoryUncached(coordinates: GithubRepositoryCoordinates, fetcher: typeof fetch): Promise<GithubRepositoryLoadResult> {
  const startedAt = Date.now();
  const deadline = startedAt + GITHUB_COLLECTION_LIMITS.timeoutMs;
  const now = Date.now();
  let metadata = repositoryCache.get(coordinates.fullName);
  let apiRequestCount = 0;
  let archiveHeadSha: string | undefined;
  if (metadata && now - metadata.checkedAt < GITHUB_COLLECTION_LIMITS.freshnessTtlMs) {
    const cached = getCachedSources(`${coordinates.fullName}@${metadata.commitSha}`, now);
    if (cached) return cachedResult(cached, startedAt, 0);
  }
  if (!metadata || now - metadata.metadataAt >= GITHUB_COLLECTION_LIMITS.cacheTtlMs) {
    apiRequestCount += 1;
    try {
      const repository = await githubJson<GithubRepositoryResponse>(apiUrl(`/repos/${coordinates.owner}/${coordinates.repo}`), deadline, fetcher);
      if (!repository.default_branch) throw new GithubRepositoryError("기본 브랜치가 없는 빈 저장소는 분석할 수 없습니다.", 422);
      metadata = { repository: repository.full_name || coordinates.fullName, defaultBranch: repository.default_branch, commitSha: "", checkedAt: 0, metadataAt: now };
    } catch (error: unknown) {
      if (!(error instanceof GithubRepositoryError) || error.status !== 429) throw error;
      try { archiveHeadSha = await resolveArchiveHead(coordinates, deadline, fetcher); }
      catch { throw error; }
      metadata = { repository: coordinates.fullName, defaultBranch: "HEAD", commitSha: archiveHeadSha, checkedAt: now, metadataAt: now };
    }
  }
  if (metadata.defaultBranch === "HEAD" && !archiveHeadSha) archiveHeadSha = await resolveArchiveHead(coordinates, deadline, fetcher);
  let commit: GithubCommitResponse;
  if (archiveHeadSha) commit = { sha: archiveHeadSha };
  else {
    apiRequestCount += 1;
    commit = await githubJson<GithubCommitResponse>(apiUrl(`/repos/${coordinates.owner}/${coordinates.repo}/commits/${encodeURIComponent(metadata.defaultBranch)}`), deadline, fetcher);
  }
  if (!COMMIT_SHA.test(commit.sha)) throw new GithubRepositoryError("GitHub가 올바르지 않은 커밋 정보를 반환했습니다.", 502);
  metadata = { ...metadata, commitSha: commit.sha, checkedAt: now };
  setBounded(repositoryCache, coordinates.fullName, metadata, GITHUB_COLLECTION_LIMITS.maxCacheEntries * 2);
  const cacheKey = `${coordinates.fullName}@${commit.sha}`;
  const cached = getCachedSources(cacheKey, now);
  if (cached) return cachedResult(cached, startedAt, apiRequestCount);
  const archive = await downloadArchive(coordinates, commit.sha, deadline, fetcher);
  const eligible = archive.files.sort((a, b) => a.path.localeCompare(b.path));
  if (eligible.length === 0) throw new GithubRepositoryError("분석할 수 있는 JavaScript 또는 TypeScript 소스 파일이 없습니다.", 422);
  const selected = selectWithinLimits(eligible);
  const sources = selected.map((file) => ({ path: file.path, content: file.content.toString("utf8") }));
  const totalBytes = sources.reduce((sum, source) => sum + Buffer.byteLength(source.content, "utf8"), 0);
  const partial = sources.length < eligible.length;
  const result: GithubRepositoryLoadResult = {
    repository: metadata.repository,
    sources,
    collection: {
      repositoryUrl: coordinates.url, defaultBranch: metadata.defaultBranch, commitSha: commit.sha,
      discoveredFiles: eligible.length, collectedFiles: sources.length, totalBytes, archiveBytes: archive.archiveBytes,
      durationMs: Date.now() - startedAt, partial, treeTruncated: false, cached: false, apiRequestCount,
      notice: partial ? `수집 제한으로 ${eligible.length}개 중 ${sources.length}개 파일 분석` : undefined,
    },
  };
  setBounded(sourceCache, cacheKey, { value: result, storedAt: now });
  return result;
}

export async function loadGithubRepository(repositoryUrl: string, fetcher: typeof fetch = fetch): Promise<GithubRepositoryLoadResult> {
  const coordinates = parseGithubRepositoryUrl(repositoryUrl);
  const existing = inFlight.get(coordinates.fullName);
  if (existing) return cachedResult(await existing, Date.now(), 0);
  const pending = loadGithubRepositoryUncached(coordinates, fetcher);
  inFlight.set(coordinates.fullName, pending);
  try { return await pending; }
  finally { if (inFlight.get(coordinates.fullName) === pending) inFlight.delete(coordinates.fullName); }
}

export function clearGithubRepositoryCachesForTests(): void {
  repositoryCache.clear(); sourceCache.clear(); inFlight.clear();
}
