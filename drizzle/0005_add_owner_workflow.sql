-- Execution traces: add ownership and workflow coordination fields
ALTER TABLE "execution_traces"
  ADD COLUMN IF NOT EXISTS "current_owner" text NOT NULL DEFAULT 'casey',
  ADD COLUMN IF NOT EXISTS "previous_owner" text,
  ADD COLUMN IF NOT EXISTS "instructions" text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "workflow_step" integer NOT NULL DEFAULT 0;

-- Index to support lookups by current owner
CREATE INDEX IF NOT EXISTS "execution_traces_current_owner_idx"
  ON "execution_traces" USING btree ("current_owner");

