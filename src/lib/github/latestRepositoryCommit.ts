import { createInstallationFetcher, getInstallationAccessToken } from "./appAuthentication";

const inFlight = new Map<string, Promise<{ sha: string; branch: string; checkedAt: string }>>();

/** Call only after fresh repository authorization. Coalesce concurrent requests, never cache access. */
export async function latestRepositoryCommit(input: { userId: string; connectionId: string; installationId: string; repository: string; branch: string }) {
  const key = JSON.stringify([input.userId, input.connectionId, input.installationId, input.repository, input.branch]);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const work = (async () => {
    const [owner, repository, extra] = input.repository.split("/");
    if (!owner || !repository || extra || !input.branch || input.branch.length > 255) throw new Error("INVALID_COMMIT_TARGET");
    const token = await getInstallationAccessToken(input.installationId);
    const fetcher = createInstallationFetcher(token);
    const response = await fetcher(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits/${encodeURIComponent(input.branch)}`, {
      // The SHA media type avoids downloading commit patches or any source archive.
      headers: { Accept: "application/vnd.github.sha" }, cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("COMMIT_LOOKUP_FAILED");
    const sha = (await response.text()).trim();
    if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error("INVALID_COMMIT_SHA");
    return { sha: sha.toLowerCase(), branch: input.branch, checkedAt: new Date().toISOString() };
  })();
  inFlight.set(key, work);
  try { return await work; }
  finally { if (inFlight.get(key) === work) inFlight.delete(key); }
}
