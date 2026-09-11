-- CreateEnum
CREATE TYPE "ThemePreference" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');
CREATE TYPE "DefaultPostDestination" AS ENUM ('DRAFT', 'QUEUE', 'SCHEDULE');
CREATE TYPE "AiCreativity" AS ENUM ('PRECISE', 'BALANCED', 'CREATIVE');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'AI_GENERATION_COMPLETE';
ALTER TYPE "PostStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "approval_comments" ADD COLUMN "parent_id" UUID;
ALTER TABLE "posts" ADD COLUMN "archived_at" TIMESTAMP(3);
ALTER TABLE "queue_items"
  ADD COLUMN "skipped" BOOLEAN NOT NULL DEFAULT false,
  ALTER COLUMN "post_id" DROP NOT NULL;
ALTER TABLE "users"
  ADD COLUMN "notification_approvals_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notification_in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notification_publishing_failures_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notification_weekly_digest_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "theme_preference" "ThemePreference" NOT NULL DEFAULT 'SYSTEM';

-- CreateTable
CREATE TABLE "workspace_preferences" (
  "workspace_id" UUID NOT NULL,
  "default_post_destination" "DefaultPostDestination" NOT NULL DEFAULT 'DRAFT',
  "default_publish_hour" INTEGER NOT NULL DEFAULT 9,
  "default_publish_minute" INTEGER NOT NULL DEFAULT 0,
  "require_approval_by_default" BOOLEAN NOT NULL DEFAULT false,
  "default_hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "default_cta" TEXT NOT NULL DEFAULT '',
  "ai_creativity" "AiCreativity" NOT NULL DEFAULT 'BALANCED',
  "ai_use_brand_voice" BOOLEAN NOT NULL DEFAULT true,
  "ai_auto_adapt_platforms" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workspace_preferences_pkey" PRIMARY KEY ("workspace_id")
);

CREATE TABLE "saved_search_views" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "query" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "saved_search_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_search_views_workspace_id_idx" ON "saved_search_views"("workspace_id");
CREATE INDEX "saved_search_views_owner_id_idx" ON "saved_search_views"("owner_id");
CREATE UNIQUE INDEX "saved_search_views_workspace_id_name_key" ON "saved_search_views"("workspace_id", "name");
CREATE INDEX "ai_media_jobs_output_asset_id_idx" ON "ai_media_jobs"("output_asset_id");
CREATE INDEX "approval_comments_parent_id_idx" ON "approval_comments"("parent_id");
CREATE INDEX "media_assets_ai_generation_id_idx" ON "media_assets"("ai_generation_id");
CREATE INDEX "posts_workspace_id_archived_at_idx" ON "posts"("workspace_id", "archived_at");
CREATE UNIQUE INDEX "queue_items_workspace_id_slot_at_key" ON "queue_items"("workspace_id", "slot_at");

-- AddForeignKey. Existing valid loose identifiers become relations in place.
ALTER TABLE "workspace_preferences" ADD CONSTRAINT "workspace_preferences_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_ai_generation_id_fkey" FOREIGN KEY ("ai_generation_id") REFERENCES "ai_generations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "approval_comments" ADD CONSTRAINT "approval_comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "approval_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_media_jobs" ADD CONSTRAINT "ai_media_jobs_output_asset_id_fkey" FOREIGN KEY ("output_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "saved_search_views" ADD CONSTRAINT "saved_search_views_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saved_search_views" ADD CONSTRAINT "saved_search_views_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
