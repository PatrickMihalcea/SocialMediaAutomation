ALTER TABLE "workflows" ADD COLUMN "retry_failed_runs" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "workflows" ADD COLUMN "retry_limit" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "workflow_runs" ADD COLUMN "retry_of_id" UUID;
ALTER TABLE "workflow_runs" ADD COLUMN "retry_number" INTEGER NOT NULL DEFAULT 0;
