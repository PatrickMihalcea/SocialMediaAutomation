-- Sampling temperature as a number the workspace sets, rather than one of three
-- names standing in for one.
--
-- Backfilled from the enum every row already has, so nothing changes value on
-- deploy. The enum column stays: a row written by an older deploy has no number
-- yet, and reading it is how that row still resolves to the temperature it was
-- already running at.
ALTER TABLE "workspace_preferences"
  ADD COLUMN "ai_temperature" DOUBLE PRECISION;

UPDATE "workspace_preferences"
   SET "ai_temperature" = CASE "ai_creativity"
         WHEN 'PRECISE'  THEN 0.25
         WHEN 'CREATIVE' THEN 1.0
         ELSE 0.7
       END
 WHERE "ai_temperature" IS NULL;
