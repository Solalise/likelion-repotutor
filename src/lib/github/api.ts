import { db } from "@/lib/db";
import { decryptToken, encryptToken } from "@/lib/auth/tokenEncryption";

const GITHUB_API = "https://api.github.com";
const API_VERSION = "2022-11-28";

export class GitHubApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export function githubHeaders(token: string, extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("X-GitHub-Api-Version", API_VERSION);
  headers.set("User-Agent", "RepoTutor");
  return headers;
}

export async function githubResponse(pathname: string, token: string, init: RequestInit = {}): Promise<Response> {
  if (!pathname.startsWith("/")) throw new Error("GitHub API 경로는 /로 시작해야 합니다.");
  return fetch(`${GITHUB_API}${pathname}`, {
    ...init,
    headers: githubHeaders(token, init.headers),
    cache: "no-store",
  });
}

export async function githubJson<T>(pathname: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await githubResponse(pathname, token, init);
  if (response.ok) return response.json() as Promise<T>;
  if (response.status === 401) throw new GitHubApiError("GitHub 로그인이 만료되었습니다. 다시 로그인해 주세요.", 401);
  if (response.status === 403) throw new GitHubApiError("GitHub App에 이 작업을 수행할 권한이 없습니다.", 403);
  if (response.status === 404) throw new GitHubApiError("GitHub 설치 또는 저장소를 찾을 수 없습니다.", 404);
  if (response.status === 429) throw new GitHubApiError("GitHub API 요청 한도를 초과했습니다.", 429);
  throw new GitHubApiError(`GitHub API 요청에 실패했습니다. (${response.status})`, 502);
}

interface RefreshResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function refreshGitHubUserToken(account: {
  id: string;
  refresh_token: string | null;
}): Promise<string> {
  const refreshToken = decryptToken(account.refresh_token);
  const clientId = process.env.AUTH_GITHUB_ID;
  const clientSecret = process.env.AUTH_GITHUB_SECRET;
  if (!refreshToken || !clientId || !clientSecret) throw new GitHubApiError("GitHub 로그인이 만료되었습니다. 다시 로그인해 주세요.", 401);
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    cache: "no-store",
  });
  const payload = await response.json() as RefreshResponse;
  if (!response.ok || payload.error || !payload.access_token) throw new GitHubApiError("GitHub 로그인을 갱신하지 못했습니다. 다시 로그인해 주세요.", 401);
  const now = Math.floor(Date.now() / 1000);
  await db.account.update({
    where: { id: account.id },
    data: {
      access_token: encryptToken(payload.access_token),
      expires_at: payload.expires_in ? now + payload.expires_in : null,
      refresh_token: encryptToken(payload.refresh_token ?? refreshToken),
      refresh_token_expires_at: payload.refresh_token_expires_in ? now + payload.refresh_token_expires_in : undefined,
      token_type: payload.token_type,
      scope: payload.scope,
    },
  });
  return payload.access_token;
}

export async function getGitHubUserAccessToken(userId: string): Promise<string> {
  const account = await db.account.findFirst({ where: { userId, provider: "github" } });
  if (!account?.access_token) throw new GitHubApiError("연결된 GitHub 로그인 정보를 찾을 수 없습니다.", 401);
  const now = Math.floor(Date.now() / 1000);
  if (account.expires_at && account.expires_at <= now + 60) return refreshGitHubUserToken(account);
  const token = decryptToken(account.access_token);
  if (!token) throw new GitHubApiError("GitHub 로그인 토큰을 읽을 수 없습니다.", 401);
  return token;
}
