ALTER TABLE IF EXISTS "study_plans" RENAME TO "life_plans";

ALTER INDEX IF EXISTS "idx_study_plans_user_id" RENAME TO "idx_life_plans_user_id";
ALTER INDEX IF EXISTS "idx_schedules_study_plan_id" RENAME TO "idx_schedules_life_plan_id";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'schedules' AND column_name = 'study_plan_id'
  ) THEN
    ALTER TABLE "schedules" RENAME COLUMN "study_plan_id" TO "life_plan_id";
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'schedules_study_plan_id_fkey'
  ) THEN
    ALTER TABLE "schedules"
      RENAME CONSTRAINT "schedules_study_plan_id_fkey" TO "schedules_life_plan_id_fkey";
  END IF;
END $$;
