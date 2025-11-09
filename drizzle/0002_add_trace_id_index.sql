-- Add indexes to optimize traceId filtering on memories
CREATE INDEX IF NOT EXISTS idx_memories_trace_id
ON memories (trace_id)
WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_memories_trace_id_created_at
ON memories (trace_id, created_at DESC)
WHERE trace_id IS NOT NULL;

