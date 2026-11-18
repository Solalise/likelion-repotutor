ALTER TABLE "user_repositories"
  ADD COLUMN "vercel_account_id" TEXT,
  ADD COLUMN "vercel_team_id" TEXT,
  ADD COLUMN "vercel_project_id" TEXT;

ALTER TABLE "user_repositories" ADD CONSTRAINT "user_repositories_vercel_account_id_fkey"
  FOREIGN KEY ("vercel_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
