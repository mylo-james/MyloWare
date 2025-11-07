CREATE TABLE "agent_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_name" text NOT NULL,
	"webhook_path" text NOT NULL,
	"method" text DEFAULT 'POST' NOT NULL,
	"auth_type" text DEFAULT 'none' NOT NULL,
	"auth_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"timeout_ms" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_webhooks_agent_name_unique" UNIQUE("agent_name")
);
--> statement-breakpoint
CREATE TABLE "execution_traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" uuid NOT NULL,
	"project_id" text NOT NULL,
	"session_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"outputs" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "execution_traces_trace_id_unique" UNIQUE("trace_id")
);
--> statement-breakpoint
CREATE INDEX "agent_webhooks_agent_name_idx" ON "agent_webhooks" USING btree ("agent_name");--> statement-breakpoint
CREATE INDEX "agent_webhooks_is_active_idx" ON "agent_webhooks" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "execution_traces_trace_id_idx" ON "execution_traces" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "execution_traces_status_idx" ON "execution_traces" USING btree ("status");--> statement-breakpoint
CREATE INDEX "execution_traces_created_at_idx" ON "execution_traces" USING btree ("created_at");