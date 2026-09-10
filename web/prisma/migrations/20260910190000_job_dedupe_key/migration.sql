-- Align the database-backed queue's deduplication contract with the Redis
-- driver. PostgreSQL permits multiple NULL values, so ordinary jobs remain
-- unrestricted while active deduplicated jobs are unique per queue.
ALTER TABLE "jobs" ADD COLUMN "dedupe_key" TEXT;

CREATE UNIQUE INDEX "jobs_queue_dedupe_key_key" ON "jobs"("queue", "dedupe_key");
