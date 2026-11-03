CREATE TYPE "RepositoryVisibility" AS ENUM ('PUBLIC', 'PRIVATE', 'INTERNAL');
CREATE TYPE "RepositoryPermission" AS ENUM ('READ', 'WRITE', 'ADMIN');
CREATE TYPE "AnalysisStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "AnalysisSource" AS ENUM ('PUBLIC_URL', 'CONNECTED_REPOSITORY');

CREATE TABLE "users" (
  "id" TEXT NOT NULL,
  "name" TEXT,
  "email" TEXT,
  "emailVerified" TIMESTAMP(3),
  "image" TEXT,
  "github_user_id" TEXT,
  "github_login" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "accounts" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_account_id" TEXT NOT NULL,
  "refresh_token" TEXT,
  "access_token" TEXT,
  "expires_at" INTEGER,
  "refresh_token_expires_at" INTEGER,
  "token_type" TEXT,
  "scope" TEXT,
  "id_token" TEXT,
  "session_state" TEXT,
  CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sessions" (
  "id" TEXT NOT NULL,
  "session_token" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "expires" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "verification_tokens" (
  "identifier" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "expires" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "github_installations" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "installation_id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "account_login" TEXT NOT NULL,
  "account_type" TEXT NOT NULL,
  "repository_selection" TEXT NOT NULL,
  "permissions" JSONB NOT NULL,
  "suspended_at" TIMESTAMP(3),
  "last_synced_at" TIMESTAMP(3),
  "etag" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "github_installations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "repositories" (
  "id" TEXT NOT NULL,
  "github_repository_id" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "full_name" TEXT NOT NULL,
  "html_url" TEXT NOT NULL,
  "default_branch" TEXT NOT NULL,
  "visibility" "RepositoryVisibility" NOT NULL,
  "is_private" BOOLEAN NOT NULL,
  "is_archived" BOOLEAN NOT NULL DEFAULT false,
  "last_github_sync_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_repositories" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "repository_id" TEXT NOT NULL,
  "installation_id" TEXT NOT NULL,
  "permission" "RepositoryPermission" NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_accessed_at" TIMESTAMP(3),
  CONSTRAINT "user_repositories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "analysis_runs" (
  "id" TEXT NOT NULL,
  "repository_id" TEXT,
  "requested_by_user_id" TEXT,
  "repository_full_name" TEXT NOT NULL,
  "commit_sha" TEXT,
  "source" "AnalysisSource" NOT NULL,
  "status" "AnalysisStatus" NOT NULL,
  "stats" JSONB,
  "error_code" TEXT,
  "error_message" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "analysis_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_github_user_id_key" ON "users"("github_user_id");
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");
CREATE UNIQUE INDEX "accounts_provider_provider_account_id_key" ON "accounts"("provider", "provider_account_id");
CREATE UNIQUE INDEX "sessions_session_token_key" ON "sessions"("session_token");
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");
CREATE INDEX "github_installations_installation_id_idx" ON "github_installations"("installation_id");
CREATE UNIQUE INDEX "github_installations_user_id_installation_id_key" ON "github_installations"("user_id", "installation_id");
CREATE UNIQUE INDEX "repositories_github_repository_id_key" ON "repositories"("github_repository_id");
CREATE UNIQUE INDEX "repositories_full_name_key" ON "repositories"("full_name");
CREATE INDEX "repositories_owner_name_idx" ON "repositories"("owner", "name");
CREATE INDEX "user_repositories_user_id_active_idx" ON "user_repositories"("user_id", "active");
CREATE INDEX "user_repositories_installation_id_idx" ON "user_repositories"("installation_id");
CREATE UNIQUE INDEX "user_repositories_user_id_repository_id_key" ON "user_repositories"("user_id", "repository_id");
CREATE INDEX "analysis_runs_repository_id_commit_sha_idx" ON "analysis_runs"("repository_id", "commit_sha");
CREATE INDEX "analysis_runs_requested_by_user_id_started_at_idx" ON "analysis_runs"("requested_by_user_id", "started_at");

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_repositories" ADD CONSTRAINT "user_repositories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_repositories" ADD CONSTRAINT "user_repositories_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_repositories" ADD CONSTRAINT "user_repositories_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "github_installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
