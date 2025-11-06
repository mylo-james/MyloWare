CREATE TABLE "workflow_registry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"memory_id" uuid NOT NULL,
	"n8n_workflow_id" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "memories_embedding_idx";--> statement-breakpoint
ALTER TABLE "workflow_registry" ADD CONSTRAINT "workflow_registry_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_registry_memory_id_idx" ON "workflow_registry" USING btree ("memory_id");--> statement-breakpoint
CREATE INDEX "workflow_registry_n8n_workflow_id_idx" ON "workflow_registry" USING btree ("n8n_workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_registry_active_idx" ON "workflow_registry" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "memories_embedding_idx" ON "memories" USING hnsw ("embedding" vector_cosine_ops);