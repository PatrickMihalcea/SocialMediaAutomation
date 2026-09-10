ALTER TABLE "workspaces"
ADD COLUMN "onboarding_step" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "logo_storage_key" TEXT;

UPDATE "workspaces"
SET "onboarding_step" = 4
WHERE "onboarded_at" IS NOT NULL;
