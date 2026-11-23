-- Additive migration: existing tables and rows are not rewritten or removed.
-- MANUAL-only provenance is intentional. Manual declarations must never become
-- server-verified evidence. Prisma cannot model this CHECK; preserve it when
-- generating future migrations. SERVER records need a separate reviewed design.
CREATE TABLE "security_test_records" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "analysis_run_id" TEXT NOT NULL,
    "repository_full_name" TEXT NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "record_key" TEXT NOT NULL,
    "target_identity" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL' CONSTRAINT "security_test_records_manual_source_check" CHECK ("source" = 'MANUAL'),
    "draft" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "security_test_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "security_test_records_user_id_updated_at_idx" ON "security_test_records"("user_id", "updated_at");
CREATE INDEX "security_test_records_user_id_repository_full_name_kind_sta_idx" ON "security_test_records"("user_id", "repository_full_name", "kind", "status");

ALTER TABLE "security_test_records" ADD CONSTRAINT "security_test_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "security_test_records" ADD CONSTRAINT "security_test_records_analysis_run_id_fkey" FOREIGN KEY ("analysis_run_id") REFERENCES "analysis_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
