DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'conversation_role') THEN
        CREATE TYPE conversation_role AS ENUM ('user', 'assistant', 'system', 'tool');
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS conversation_turns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL,
    user_id text,
    role conversation_role NOT NULL,
    turn_index integer NOT NULL,
    content text NOT NULL,
    summary jsonb,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT conversation_turns_session_turn_unique UNIQUE (session_id, turn_index)
);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_conversation_turns_updated_at
    BEFORE UPDATE ON conversation_turns
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_conversation_turns_session_created_at
    ON conversation_turns (session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_conversation_turns_user_created_at
    ON conversation_turns (user_id, created_at DESC)
    WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_turns_metadata
    ON conversation_turns USING gin (metadata);

CREATE INDEX IF NOT EXISTS idx_conversation_turns_created_at
    ON conversation_turns (created_at);

CREATE INDEX IF NOT EXISTS idx_prompt_embeddings_episodic_vector
    ON prompt_embeddings USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100)
    WHERE memory_type = 'episodic';
