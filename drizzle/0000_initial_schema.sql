-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Enums
CREATE TYPE "public"."memory_type" AS ENUM('episodic', 'semantic', 'procedural');
CREATE TYPE "public"."trace_status" AS ENUM('active', 'completed', 'failed');
CREATE TYPE "public"."persona_name" AS ENUM('casey', 'iggy', 'riley', 'veo', 'alex', 'quinn');
CREATE TYPE "public"."workflow_run_status" AS ENUM('running', 'completed', 'failed', 'canceled');
CREATE TYPE "public"."http_method" AS ENUM('GET', 'POST', 'PUT', 'DELETE', 'PATCH');
CREATE TYPE "public"."auth_type_enum" AS ENUM('none', 'header', 'basic', 'bearer');
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'canceled');

-- Tables (in dependency order)

-- Personas table
CREATE TABLE "personas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"capabilities" text[] NOT NULL,
	"tone" text NOT NULL,
	"default_project" text,
	"system_prompt" text,
	"allowed_tools" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "personas_name_unique" UNIQUE("name")
);

-- Projects table
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"workflow" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"optional_steps" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"guardrails" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "projects_name_unique" UNIQUE("name")
);

-- Agent webhooks table
CREATE TABLE "agent_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_name" text NOT NULL,
	"webhook_path" text NOT NULL,
	"method" "http_method" DEFAULT 'POST' NOT NULL,
	"auth_type" "auth_type_enum" DEFAULT 'none' NOT NULL,
	"auth_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"timeout_ms" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_webhooks_agent_name_unique" UNIQUE("agent_name")
);

-- Sessions table
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"persona" text NOT NULL,
	"project" text NOT NULL,
	"last_interaction_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Execution traces table
CREATE TABLE "execution_traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"session_id" text,
	"current_owner" text DEFAULT 'casey' NOT NULL,
	"previous_owner" text,
	"instructions" text DEFAULT '' NOT NULL,
	"workflow_step" integer DEFAULT 0 NOT NULL,
	"status" "trace_status" DEFAULT 'active' NOT NULL,
	"outputs" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "execution_traces_trace_id_unique" UNIQUE("trace_id"),
	CONSTRAINT "execution_traces_workflow_step_non_negative" CHECK ("workflow_step" >= 0)
);

-- Workflow runs table
CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text,
	"workflow_name" text NOT NULL,
	"status" "workflow_run_status" NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"error" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_runs_started_at_lte_completed_at" CHECK ("started_at" <= "completed_at" OR "completed_at" IS NULL)
);

-- Memories table
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content" text NOT NULL,
	"summary" text,
	"embedding" vector(1536) NOT NULL,
	"memory_type" "memory_type" NOT NULL,
	"persona" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"project" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"related_to" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"trace_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_accessed_at" timestamp,
	"access_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "content_no_newlines" CHECK (content !~ E'\n'),
	CONSTRAINT "summary_no_newlines" CHECK (summary IS NULL OR summary !~ E'\n')
);

-- Video generation jobs table
CREATE TABLE "video_generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" uuid NOT NULL,
	"script_id" uuid,
	"provider" text NOT NULL,
	"task_id" text NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"asset_url" text,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "video_generation_jobs_completed_at_required" CHECK (("status" NOT IN ('succeeded', 'failed')) OR "completed_at" IS NOT NULL),
	CONSTRAINT "video_generation_jobs_started_at_lte_completed_at" CHECK ("started_at" IS NULL OR "completed_at" IS NULL OR "started_at" <= "completed_at")
);

-- Edit jobs table
CREATE TABLE "edit_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"task_id" text NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"final_url" text,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "edit_jobs_completed_at_required" CHECK (("status" NOT IN ('succeeded', 'failed')) OR "completed_at" IS NOT NULL),
	CONSTRAINT "edit_jobs_started_at_lte_completed_at" CHECK ("started_at" IS NULL OR "completed_at" IS NULL OR "started_at" <= "completed_at")
);

-- Foreign Keys

-- Sessions foreign keys
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_persona_fk" FOREIGN KEY ("persona") REFERENCES "personas"("name") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_project_fk" FOREIGN KEY ("project") REFERENCES "projects"("name") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Execution traces foreign keys
ALTER TABLE "execution_traces" ADD CONSTRAINT "execution_traces_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "execution_traces" ADD CONSTRAINT "execution_traces_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "execution_traces" ADD CONSTRAINT "execution_traces_current_owner_fk" FOREIGN KEY ("current_owner") REFERENCES "personas"("name") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Workflow runs foreign keys
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Memories foreign keys
ALTER TABLE "memories" ADD CONSTRAINT "memories_trace_id_fk" FOREIGN KEY ("trace_id") REFERENCES "execution_traces"("trace_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- Job tables foreign keys
ALTER TABLE "video_generation_jobs" ADD CONSTRAINT "video_generation_jobs_trace_id_fk" FOREIGN KEY ("trace_id") REFERENCES "execution_traces"("trace_id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "edit_jobs" ADD CONSTRAINT "edit_jobs_trace_id_fk" FOREIGN KEY ("trace_id") REFERENCES "execution_traces"("trace_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Indexes

-- Personas indexes
CREATE INDEX "personas_name_idx" ON "personas" ("name");

-- Projects indexes
CREATE INDEX "projects_name_idx" ON "projects" ("name");

-- Sessions indexes
CREATE INDEX "sessions_user_idx" ON "sessions" ("user_id");
CREATE INDEX "sessions_expires_at_idx" ON "sessions" ("expires_at");

-- Execution traces indexes
CREATE INDEX "execution_traces_trace_id_idx" ON "execution_traces" ("trace_id");
CREATE INDEX "execution_traces_status_idx" ON "execution_traces" ("status");
CREATE INDEX "execution_traces_current_owner_idx" ON "execution_traces" ("current_owner");
CREATE INDEX "execution_traces_created_at_idx" ON "execution_traces" ("created_at");
CREATE INDEX "execution_traces_status_project_idx" ON "execution_traces" ("status", "project_id") WHERE "status" = 'active';

-- Workflow runs indexes
CREATE INDEX "workflow_runs_session_idx" ON "workflow_runs" ("session_id");

-- Memories indexes
CREATE INDEX "memories_embedding_idx" ON "memories" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX "memories_memory_type_idx" ON "memories" ("memory_type");
CREATE INDEX "memories_persona_idx" ON "memories" USING gin ("persona");
CREATE INDEX "memories_project_idx" ON "memories" USING gin ("project");
CREATE INDEX "memories_tags_idx" ON "memories" USING gin ("tags");
CREATE INDEX "memories_related_to_idx" ON "memories" USING gin ("related_to");
CREATE INDEX "memories_created_at_idx" ON "memories" ("created_at");
CREATE INDEX "memories_trace_id_idx" ON "memories" ("trace_id");

-- Video generation jobs indexes
CREATE INDEX "video_generation_jobs_trace_idx" ON "video_generation_jobs" ("trace_id");
CREATE INDEX "video_generation_jobs_status_idx" ON "video_generation_jobs" ("status");
CREATE INDEX "video_generation_jobs_trace_status_idx" ON "video_generation_jobs" ("trace_id", "status");
CREATE UNIQUE INDEX "video_generation_jobs_provider_task_idx" ON "video_generation_jobs" ("provider", "task_id");

-- Edit jobs indexes
CREATE INDEX "edit_jobs_trace_idx" ON "edit_jobs" ("trace_id");
CREATE INDEX "edit_jobs_trace_status_idx" ON "edit_jobs" ("trace_id", "status");
CREATE UNIQUE INDEX "edit_jobs_provider_task_idx" ON "edit_jobs" ("provider", "task_id");

-- Agent webhooks indexes
CREATE INDEX "agent_webhooks_agent_name_idx" ON "agent_webhooks" ("agent_name");
CREATE INDEX "agent_webhooks_is_active_idx" ON "agent_webhooks" ("is_active");

-- Trigger function for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at columns
CREATE TRIGGER update_personas_updated_at BEFORE UPDATE ON "personas" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON "projects" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON "sessions" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_execution_traces_updated_at BEFORE UPDATE ON "execution_traces" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_memories_updated_at BEFORE UPDATE ON "memories" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_agent_webhooks_updated_at BEFORE UPDATE ON "agent_webhooks" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_video_generation_jobs_updated_at BEFORE UPDATE ON "video_generation_jobs" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_edit_jobs_updated_at BEFORE UPDATE ON "edit_jobs" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

