-- AlterEnum
ALTER TYPE "MediaType" ADD VALUE 'AUDIO';

-- AlterEnum
ALTER TYPE "AiOperation" ADD VALUE 'IMAGE_EDIT';
ALTER TYPE "AiOperation" ADD VALUE 'VIDEO';
ALTER TYPE "AiOperation" ADD VALUE 'AUDIO';

-- CreateEnum
CREATE TYPE "AiMediaJobKind" AS ENUM ('IMAGE_GENERATE', 'IMAGE_EDIT', 'IMAGE_VARIATION', 'VIDEO_GENERATE', 'VIDEO_ANIMATE', 'AUDIO_TTS', 'AUDIO_TRANSCRIBE', 'AUDIO_TRANSLATE');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "notification_email_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ai_media_jobs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID,
    "kind" "AiMediaJobKind" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "input_asset_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "output_asset_id" UUID,
    "error" TEXT,
    "duration_ms" INTEGER,
    "estimated_cost" DECIMAL(12,6),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_media_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_media_jobs_workspace_id_idx" ON "ai_media_jobs"("workspace_id");
CREATE INDEX "ai_media_jobs_workspace_id_status_idx" ON "ai_media_jobs"("workspace_id", "status");
CREATE INDEX "ai_media_jobs_created_at_idx" ON "ai_media_jobs"("created_at");

-- AddForeignKey
ALTER TABLE "ai_media_jobs" ADD CONSTRAINT "ai_media_jobs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
