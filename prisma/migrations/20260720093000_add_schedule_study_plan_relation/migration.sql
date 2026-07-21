-- AlterTable
ALTER TABLE "schedules" ADD COLUMN "study_plan_id" UUID;

-- Backfill schedules created by study plans before this relation existed.
UPDATE "schedules" AS s
SET "study_plan_id" = sp."id"
FROM "study_plans" AS sp
WHERE s."study_plan_id" IS NULL
  AND s."user_id" = sp."user_id"
  AND s."summary" = sp."title"
  AND s."description" = sp."goal"
  AND s."location" = 'ONLINE'
  AND (s."start_date_time" AT TIME ZONE 'UTC')::date BETWEEN sp."start_date" AND sp."end_date"
  AND to_char(s."start_date_time" AT TIME ZONE 'UTC', 'HH24:MI') = sp."start_time"
  AND to_char(s."end_date_time" AT TIME ZONE 'UTC', 'HH24:MI') = sp."end_time";

-- CreateIndex
CREATE INDEX "idx_schedules_study_plan_id" ON "schedules"("study_plan_id");

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_study_plan_id_fkey" FOREIGN KEY ("study_plan_id") REFERENCES "study_plans"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
