import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { requireRepositoryAccess } from "@/lib/github/repositoryAccess";
import { normalizeVercelUrl, repositoryDeployment } from "./deployment";
import { OWNERSHIP_FILE_PATH, readOwnershipFile } from "./deploymentVerificationRequest";

type Connection = Awaited<ReturnType<typeof requireRepositoryAccess>>;
export class DeploymentVerificationError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

const TOKEN_LIFETIME_MS = 15 * 60 * 1000;
const WINDOW_MS = 60 * 60 * 1000;

function tokenDigest(userId: string, connection: Connection, fileContent: string) {
  return createHash("sha256").update(JSON.stringify([
    userId, connection.id, connection.repositoryId, connection.vercelUrl, fileContent,
  ])).digest();
}

// Durable per-user budget across repositories, URL changes, reissues and server instances.
async function reserveBudget(userId: string, action: "issue" | "check") {
  const now = new Date();
  await db.deploymentVerificationRateLimit.upsert({
    where: { userId }, create: { userId, windowStartedAt: now }, update: {},
  });
  await db.deploymentVerificationRateLimit.updateMany({
    where: { userId, windowStartedAt: { lte: new Date(now.getTime() - WINDOW_MS) } },
    data: { windowStartedAt: now, issuanceCount: 0, checkCount: 0 },
  });
  const reserved = action === "issue"
    ? await db.deploymentVerificationRateLimit.updateMany({
      where: { userId, issuanceCount: { lt: 10 } }, data: { issuanceCount: { increment: 1 } },
    })
    : await db.deploymentVerificationRateLimit.updateMany({
      where: { userId, checkCount: { lt: 30 } }, data: { checkCount: { increment: 1 } },
    });
  if (reserved.count !== 1) throw new DeploymentVerificationError("시간당 발급 10회·확인 30회 제한에 도달했습니다. 다음 제한 시간 창에서 다시 시도해 주세요.", 429);
}

export async function issueDeploymentChallenge(userId: string, connection: Connection) {
  if (!connection.vercelUrl) throw new DeploymentVerificationError("배포 URL을 먼저 저장해 주세요.", 400);
  normalizeVercelUrl(connection.vercelUrl);
  const now = new Date();
  const cooldown = new Date(now.getTime() - 60_000);
  if (connection.deploymentTokenIssuedAt && connection.deploymentTokenIssuedAt > cooldown) {
    throw new DeploymentVerificationError("토큰 발급 후 60초가 지나야 재발급할 수 있습니다.", 429);
  }
  await reserveBudget(userId, "issue");
  const fileContent = `vulnlab-ownership=${randomBytes(32).toString("hex")}`;
  const expiresAt = new Date(now.getTime() + TOKEN_LIFETIME_MS);
  const updated = await db.userRepository.updateMany({
    where: {
      id: connection.id, userId, active: true, vercelUrl: connection.vercelUrl,
      deploymentVersion: connection.deploymentVersion,
      OR: [{ deploymentTokenIssuedAt: null }, { deploymentTokenIssuedAt: { lte: cooldown } }],
    },
    data: {
      deploymentVersion: { increment: 1 },
      deploymentTokenHash: tokenDigest(userId, connection, fileContent).toString("hex"),
      deploymentTokenExpiresAt: expiresAt, deploymentTokenIssuedAt: now,
      deploymentVerificationAttempts: 0, deploymentNextVerificationAt: null,
      deploymentOwnershipStatus: "UNVERIFIED", deploymentVerifiedAt: null,
    },
  });
  if (updated.count !== 1) throw new DeploymentVerificationError("연결 정보가 변경되었거나 토큰이 이미 발급되었습니다. 화면을 새로고침해 주세요.", 409);
  return {
    filePath: OWNERSHIP_FILE_PATH, fileContent, expiresAt: expiresAt.toISOString(),
    deployment: repositoryDeployment({
      ...connection, deploymentOwnershipStatus: "UNVERIFIED", deploymentVerifiedAt: null,
      deploymentTokenExpiresAt: expiresAt, deploymentVerificationAttempts: 0,
    }),
  };
}

export async function verifyDeploymentChallenge(userId: string, connection: Connection) {
  const now = new Date();
  if (!connection.vercelUrl || !connection.deploymentTokenHash || !connection.deploymentTokenExpiresAt) {
    throw new DeploymentVerificationError("검증 토큰을 먼저 발급해 주세요. 사용이 끝난 토큰은 다시 사용할 수 없습니다.", 409);
  }
  if (connection.deploymentTokenExpiresAt <= now) throw new DeploymentVerificationError("검증 토큰이 만료되었습니다. 재발급해 주세요.", 410);
  if (connection.deploymentVerificationAttempts >= 5) throw new DeploymentVerificationError("토큰당 확인 5회 제한에 도달했습니다. 재발급해 주세요.", 429);
  if (connection.deploymentNextVerificationAt && connection.deploymentNextVerificationAt > now) {
    throw new DeploymentVerificationError("확인 요청 사이에 10초 이상 기다려 주세요.", 429);
  }
  await reserveBudget(userId, "check");
  const claim = await db.userRepository.updateMany({
    where: {
      id: connection.id, userId, active: true, vercelUrl: connection.vercelUrl,
      deploymentVersion: connection.deploymentVersion, deploymentTokenHash: connection.deploymentTokenHash,
      deploymentTokenExpiresAt: { gt: now }, deploymentVerificationAttempts: { lt: 5 },
      OR: [{ deploymentNextVerificationAt: null }, { deploymentNextVerificationAt: { lte: now } }],
    },
    data: { deploymentVerificationAttempts: { increment: 1 }, deploymentNextVerificationAt: new Date(now.getTime() + 10_000) },
  });
  if (claim.count !== 1) throw new DeploymentVerificationError("연결 정보가 변경되었거나 확인 요청이 이미 진행 중입니다. 잠시 후 다시 시도해 주세요.", 409);

  let body: string;
  try { body = (await readOwnershipFile(connection.vercelUrl)).trim(); }
  catch (error) {
    throw new DeploymentVerificationError(error instanceof Error ? error.message : "확인 파일을 읽지 못했습니다.", 400);
  }
  const actual = tokenDigest(userId, connection, body);
  const expected = Buffer.from(connection.deploymentTokenHash, "hex");
  if (!/^vulnlab-ownership=[0-9a-f]{64}$/.test(body)
    || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new DeploymentVerificationError("확인 파일의 토큰이 일치하지 않습니다. 최신 토큰을 배치하고 배포가 완료되었는지 확인해 주세요.", 400);
  }
  // Network activity can outlive permission/URL changes: recheck authorization and
  // atomically match the URL, revision, token and claimed attempt before consuming it.
  await requireRepositoryAccess(userId, connection.id);
  const verifiedAt = new Date();
  const updated = await db.userRepository.updateMany({
    where: {
      id: connection.id, userId, active: true, vercelUrl: connection.vercelUrl,
      deploymentVersion: connection.deploymentVersion, deploymentTokenHash: connection.deploymentTokenHash,
      deploymentVerificationAttempts: connection.deploymentVerificationAttempts + 1,
      deploymentTokenExpiresAt: { gt: verifiedAt },
    },
    data: {
      deploymentOwnershipStatus: "VERIFIED", deploymentVerifiedAt: verifiedAt,
      deploymentTokenHash: null, deploymentTokenExpiresAt: null,
      deploymentNextVerificationAt: null, deploymentVersion: { increment: 1 },
    },
  });
  if (updated.count !== 1) throw new DeploymentVerificationError("토큰이 만료되었거나 URL·토큰·진행 상태가 변경되었습니다. 최신 연결 정보를 확인해 주세요.", 409);
  return repositoryDeployment({
    ...connection, deploymentOwnershipStatus: "VERIFIED", deploymentVerifiedAt: verifiedAt,
    deploymentTokenExpiresAt: null, deploymentVerificationAttempts: connection.deploymentVerificationAttempts + 1,
  });
}
