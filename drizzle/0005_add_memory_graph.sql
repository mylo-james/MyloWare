CREATE TABLE IF NOT EXISTS memory_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_chunk_id text NOT NULL REFERENCES prompt_embeddings(chunk_id) ON DELETE CASCADE,
    target_chunk_id text NOT NULL REFERENCES prompt_embeddings(chunk_id) ON DELETE CASCADE,
    link_type text NOT NULL CHECK (char_length(link_type) > 0),
    strength double precision NOT NULL CHECK (strength >= 0 AND strength <= 1),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT memory_links_source_target_type_unique UNIQUE (source_chunk_id, target_chunk_id, link_type)
);

CREATE INDEX IF NOT EXISTS idx_memory_links_source
    ON memory_links (source_chunk_id);

CREATE INDEX IF NOT EXISTS idx_memory_links_target
    ON memory_links (target_chunk_id);

CREATE INDEX IF NOT EXISTS idx_memory_links_type
    ON memory_links (link_type);
