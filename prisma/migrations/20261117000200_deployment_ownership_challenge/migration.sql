ALTER TABLE "user_repositories"
  ADD COLUMN "deployment_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deployment_token_hash" TEXT,
  ADD COLUMN "deployment_token_expires_at" TIMESTAMP(3),
  ADD COLUMN "deployment_token_issued_at" TIMESTAMP(3),
  ADD COLUMN "deployment_verification_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deployment_next_verification_at" TIMESTAMP(3);

CREATE TABLE "deployment_verification_rate_limits" (
  "user_id" TEXT NOT NULL,
  "window_started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "issuance_count" INTEGER NOT NULL DEFAULT 0,
  "check_count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "deployment_verification_rate_limits_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "deployment_verification_rate_limits_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
