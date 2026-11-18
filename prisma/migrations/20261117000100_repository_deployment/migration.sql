CREATE TYPE "DeploymentOwnershipStatus" AS ENUM ('UNVERIFIED', 'VERIFIED');

ALTER TABLE "user_repositories"
  ADD COLUMN "vercel_url" TEXT,
  ADD COLUMN "deployment_ownership_status" "DeploymentOwnershipStatus" NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN "deployment_verified_at" TIMESTAMP(3);

ALTER TABLE "user_repositories" ADD CONSTRAINT "deployment_verification_requires_url"
  CHECK (
    ("deployment_ownership_status" = 'UNVERIFIED' AND "deployment_verified_at" IS NULL)
    OR ("deployment_ownership_status" = 'VERIFIED' AND "vercel_url" IS NOT NULL AND "deployment_verified_at" IS NOT NULL)
  );
