export type RepositoryDeployment = {
  vercelUrl: string | null;
  ownershipStatus: "UNVERIFIED" | "VERIFIED";
  verifiedAt: string | null;
  challengeExpiresAt: string | null;
  verificationAttemptsRemaining: number;
  // URL registration never enables execution. A verified-target runner is not implemented yet.
  testRequestsAllowed: false;
};

/** Syntax validation only. Does not fetch the URL, resolve DNS or verify ownership/provider. */
export function normalizeVercelUrl(input: unknown): string {
  if (typeof input !== "string" || !input.trim() || input.length > 2048) {
    throw new Error("HTTPS 배포 URL을 2048자 이내로 입력해 주세요.");
  }
  const value = input.trim();
  if (!/^https:\/\//i.test(value) || /[\s\\]/.test(value)) {
    throw new Error("https://로 시작하는 배포 URL을 입력해 주세요.");
  }
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("올바른 배포 URL을 입력해 주세요."); }
  const labels = url.hostname.split(".");
  if (url.protocol !== "https:" || url.username || url.password || url.port
    || url.pathname !== "/" || url.search || url.hash
    || labels.length < 2 || url.hostname.length > 253
    || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
    || !/^[a-z]{2,63}$/i.test(labels.at(-1) ?? "")
    || /(?:^|\.)(?:localhost|local|internal|test|invalid|example|home|lan)$/i.test(url.hostname)) {
    throw new Error("경로·쿼리·인증 정보·별도 포트가 없는 공개 HTTPS 배포 주소를 입력해 주세요.");
  }
  return url.origin;
}

export function repositoryDeployment(connection: {
  vercelUrl: string | null;
  deploymentOwnershipStatus: "UNVERIFIED" | "VERIFIED";
  deploymentVerifiedAt: Date | null;
  deploymentTokenExpiresAt?: Date | null;
  deploymentVerificationAttempts?: number;
}): RepositoryDeployment {
  const verified = Boolean(connection.vercelUrl && connection.deploymentVerifiedAt
    && connection.deploymentOwnershipStatus === "VERIFIED");
  return {
    vercelUrl: connection.vercelUrl,
    ownershipStatus: verified ? "VERIFIED" : "UNVERIFIED",
    verifiedAt: verified ? connection.deploymentVerifiedAt!.toISOString() : null,
    challengeExpiresAt: connection.deploymentTokenExpiresAt?.toISOString() ?? null,
    verificationAttemptsRemaining: Math.max(0, 5 - (connection.deploymentVerificationAttempts ?? 0)),
    testRequestsAllowed: false,
  };
}
