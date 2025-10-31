ALTER TABLE prompt_embeddings
ADD COLUMN IF NOT EXISTS textsearch tsvector;

UPDATE prompt_embeddings
SET textsearch = to_tsvector(
  'pg_catalog.english',
  coalesce(chunk_text, '') || ' ' || coalesce(raw_markdown, '')
);

ALTER TABLE prompt_embeddings
ALTER COLUMN textsearch SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_textsearch
ON prompt_embeddings
USING gin (textsearch);

DROP TRIGGER IF EXISTS prompt_embeddings_tsvector_update ON prompt_embeddings;

CREATE TRIGGER prompt_embeddings_tsvector_update
BEFORE INSERT OR UPDATE ON prompt_embeddings
FOR EACH ROW
EXECUTE FUNCTION tsvector_update_trigger(
  textsearch,
  'pg_catalog.english',
  chunk_text,
  raw_markdown
);
