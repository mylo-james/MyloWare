DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'memory_type') THEN
        CREATE TYPE memory_type AS ENUM ('persona', 'project', 'semantic', 'episodic', 'procedural');
    END IF;
END
$$;

ALTER TABLE prompt_embeddings
    ADD COLUMN IF NOT EXISTS memory_type memory_type NOT NULL DEFAULT 'semantic';

CREATE INDEX IF NOT EXISTS idx_prompt_embeddings_persona_updated_at
    ON prompt_embeddings (updated_at)
    WHERE memory_type = 'persona';

CREATE INDEX IF NOT EXISTS idx_prompt_embeddings_project_updated_at
    ON prompt_embeddings (updated_at)
    WHERE memory_type = 'project';

CREATE INDEX IF NOT EXISTS idx_prompt_embeddings_semantic_updated_at
    ON prompt_embeddings (updated_at)
    WHERE memory_type = 'semantic';

CREATE INDEX IF NOT EXISTS idx_prompt_embeddings_episodic_updated_at
    ON prompt_embeddings (updated_at)
    WHERE memory_type = 'episodic';

CREATE INDEX IF NOT EXISTS idx_prompt_embeddings_procedural_updated_at
    ON prompt_embeddings (updated_at)
    WHERE memory_type = 'procedural';

CREATE INDEX IF NOT EXISTS idx_prompt_embeddings_persona_metadata
    ON prompt_embeddings USING gin (metadata)
    WHERE memory_type = 'persona';

CREATE INDEX IF NOT EXISTS idx_prompt_embeddings_project_metadata
    ON prompt_embeddings USING gin (metadata)
    WHERE memory_type = 'project';

CREATE INDEX IF NOT EXISTS idx_prompt_embeddings_semantic_metadata
    ON prompt_embeddings USING gin (metadata)
    WHERE memory_type = 'semantic';

CREATE INDEX IF NOT EXISTS idx_prompt_embeddings_episodic_metadata
    ON prompt_embeddings USING gin (metadata)
    WHERE memory_type = 'episodic';

CREATE INDEX IF NOT EXISTS idx_prompt_embeddings_procedural_metadata
    ON prompt_embeddings USING gin (metadata)
    WHERE memory_type = 'procedural';
