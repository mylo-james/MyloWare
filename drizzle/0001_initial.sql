CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS prompt_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id text NOT NULL UNIQUE,
  file_path text NOT NULL,
  chunk_text text NOT NULL,
  raw_markdown text NOT NULL,
  granularity varchar(20) NOT NULL,
  embedding vector(1536) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  checksum text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_embeddings_file_path ON prompt_embeddings (file_path);
CREATE INDEX IF NOT EXISTS idx_embeddings_metadata ON prompt_embeddings USING gin (metadata);

CREATE INDEX IF NOT EXISTS idx_embeddings_vector
  ON prompt_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
