CREATE TABLE "post_analytics_days" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "post_platform_id" UUID NOT NULL,
    "social_account_id" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "captured_on" DATE NOT NULL,
    "views" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "saves" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "post_analytics_days_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "post_analytics_days_post_platform_id_captured_on_key" ON "post_analytics_days"("post_platform_id", "captured_on");
CREATE INDEX "post_analytics_days_workspace_id_captured_on_idx" ON "post_analytics_days"("workspace_id", "captured_on");
CREATE INDEX "post_analytics_days_social_account_id_captured_on_idx" ON "post_analytics_days"("social_account_id", "captured_on");

ALTER TABLE "post_analytics_days" ADD CONSTRAINT "post_analytics_days_post_platform_id_fkey" FOREIGN KEY ("post_platform_id") REFERENCES "post_platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
