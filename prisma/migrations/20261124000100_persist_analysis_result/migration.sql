-- Additive only: existing analysis histories and user records remain intact.
ALTER TABLE "analysis_runs" ADD COLUMN "analysis_result" JSONB,
                            ADD COLUMN "review_guide" JSONB;
