-- Add allowed_tools array field to personas table
ALTER TABLE "personas"
  ADD COLUMN IF NOT EXISTS "allowed_tools" text[] NOT NULL DEFAULT ARRAY[]::text[];

