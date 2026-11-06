-- A queue only the operator's own machine consumes, for ComfyUI generation,
-- and the heartbeat that says whether that machine is on.
ALTER TYPE "QueueName" ADD VALUE 'LOCAL_GENERATION';

CREATE TABLE "worker_heartbeats" (
    "id" TEXT NOT NULL,
    "seen_at" TIMESTAMP(3) NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("id")
);
