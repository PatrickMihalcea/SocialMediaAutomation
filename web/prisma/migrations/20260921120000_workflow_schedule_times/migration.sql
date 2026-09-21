-- Several times of day per workflow, as minutes past midnight.
--
-- Backfilled from the single hour and minute every row already has, so an
-- existing schedule keeps firing at exactly the time it fired before. The old
-- columns stay and are kept in step with the earliest time: a deploy that lands
-- either side of this migration still reads a schedule that means something.
ALTER TABLE "workflows"
  ADD COLUMN "schedule_times" INTEGER[] NOT NULL DEFAULT '{}';

UPDATE "workflows"
   SET "schedule_times" = ARRAY["schedule_hour" * 60 + "schedule_minute"]
 WHERE "schedule_times" = '{}';
