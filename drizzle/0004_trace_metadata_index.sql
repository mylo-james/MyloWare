CREATE INDEX "memories_trace_id_idx" ON "memories" ((metadata ->> 'traceId'));
