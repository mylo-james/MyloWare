-- Change workflows (plural) to workflow (singular) and add optional_steps
-- Step 1: Add new columns
ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "workflow" text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS "optional_steps" text[] NOT NULL DEFAULT ARRAY[]::text[];

-- Step 2: Migrate data from workflows to workflow
UPDATE "projects"
SET "workflow" = "workflows"
WHERE "workflows" IS NOT NULL;

-- Step 3: Drop old workflows column
ALTER TABLE "projects"
  DROP COLUMN IF EXISTS "workflows";

