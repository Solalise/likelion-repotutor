import { createSign } from "node:crypto";
import type { GithubRepositoryCoordinates } from "@/lib/repository/loadGithubRepository";
import { githubHeaders, GitHubApiError } from "./api";

interface InstallationTokenEntry { token: string; expiresAt: number }
const installationTokens = new Map<string, InstallationTokenEntry>();

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function appPrivateKey(): string {
  const encoded = process.env.GITHUB_APP_PRIVATE_KEY_BASE64?.trim();
  if (!encoded) throw new Error("GITHUB_APP_PRIVATE_KEY_BASE64 환경변수가 필요합니다.");
  return Buffer.from(encoded, "base64").toString("utf8");
}

function createAppJwt(): string {
  const appId = process.env.GITHUB_APP_ID?.trim();
  if (!appId) throw new Error("GITHUB_APP_ID 환경변수가 필요합니다.");
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId }));
  const unsigned = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(unsigned).end().sign(appPrivateKey()).toString("base64url");
  return `${unsigned}.${signature}`;
}

export async function getInstallationAccessToken(installationId: string): Promise<string> {
  if (!/^\d+$/.test(installationId)) throw new Error("GitHub installation ID가 올바르지 않습니다.");
  const cached = installationTokens.get(installationId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: githubHeaders(createAppJwt(), { "Content-Type": "application/json" }),
    body: JSON.stringify({ permissions: { contents: "read", metadata: "read" } }),
    cache: "no-store",
  });
  if (!response.ok) throw new GitHubApiError(`GitHub installation token 발급에 실패했습니다. (${response.status})`, response.status);
  const payload = await response.json() as { token: string; expires_at: string };
  const entry = { token: payload.token, expiresAt: new Date(payload.expires_at).getTime() };
  installationTokens.set(installationId, entry);
  while (installationTokens.size > 50) installationTokens.delete(installationTokens.keys().next().value!);
  return entry.token;
}

export function createInstallationFetcher(token: string): typeof fetch {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const original = input instanceof Request ? new URL(input.url) : new URL(input.toString());
    let target = original;
    if (original.origin === "https://codeload.github.com") {
      const match = original.pathname.match(/^\/([^/]+)\/([^/]+)\/tar\.gz\/([0-9a-f]{40})$/i);
      if (!match) throw new Error("허용되지 않은 GitHub archive 경로입니다.");
      const [, owner, repo, sha] = match;
      target = new URL(`https://api.github.com/repos/${owner}/${repo}/tarball/${sha}`);
    } else if (original.origin !== "https://api.github.com" && original.origin !== "https://github.com") {
      throw new Error("허용되지 않은 GitHub 요청 대상입니다.");
    }
    return fetch(target, {
      ...init,
      headers: githubHeaders(token, init?.headers),
      redirect: "follow",
      cache: "no-store",
    });
  };
}

export function installationCacheNamespace(installationId: string, repository: GithubRepositoryCoordinates): string {
  return `installation:${installationId}:${repository.fullName.toLowerCase()}`;
}
