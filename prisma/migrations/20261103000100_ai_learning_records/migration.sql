CREATE TABLE "learning_records" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "selection_type" TEXT NOT NULL,
    "selection_id" TEXT NOT NULL,
    "selection_name" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "cache_key" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "total_tokens" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "learning_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "learning_records_user_id_cache_key_key" ON "learning_records"("user_id", "cache_key");
CREATE INDEX "learning_records_user_id_created_at_idx" ON "learning_records"("user_id", "created_at");
CREATE INDEX "learning_records_repository_id_commit_sha_idx" ON "learning_records"("repository_id", "commit_sha");

ALTER TABLE "learning_records" ADD CONSTRAINT "learning_records_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "learning_records" ADD CONSTRAINT "learning_records_repository_id_fkey"
  FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
