DO $$ BEGIN
    CREATE TYPE "job_status" AS ENUM ('queued','running','succeeded','failed','canceled');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE "video_generation_jobs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "trace_id" uuid NOT NULL,
    "script_id" uuid,
    "provider" text NOT NULL,
    "task_id" text NOT NULL,
    "status" job_status NOT NULL DEFAULT 'queued',
    "asset_url" text,
    "error" text,
    "started_at" timestamp,
    "completed_at" timestamp,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "video_generation_jobs_provider_task_idx"
    ON "video_generation_jobs" ("provider", "task_id");
CREATE INDEX "video_generation_jobs_trace_idx"
    ON "video_generation_jobs" ("trace_id");
CREATE INDEX "video_generation_jobs_status_idx"
    ON "video_generation_jobs" ("status");

CREATE TABLE "edit_jobs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "trace_id" uuid NOT NULL,
    "provider" text NOT NULL,
    "task_id" text NOT NULL,
    "status" job_status NOT NULL DEFAULT 'queued',
    "final_url" text,
    "error" text,
    "started_at" timestamp,
    "completed_at" timestamp,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "edit_jobs_provider_task_idx" ON "edit_jobs" ("provider", "task_id");
CREATE INDEX "edit_jobs_trace_idx" ON "edit_jobs" ("trace_id");
