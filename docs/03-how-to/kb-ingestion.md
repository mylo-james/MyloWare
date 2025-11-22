# KB Ingestion (Manual MVP)

Brendan and the personas rely on the knowledge base stored in Postgres (`kb_documents` + `kb_embeddings`). Until we wire an automated pipeline, you must run ingestion manually whenever the docs under `data/kb/ingested` change.

## Prerequisites

- Postgres reachable via `DB_URL` (or `apps.api.config.Settings.db_url` if you use `.env`).
- `pgvector` extension installed (`mw-py db vector ensure-extension` can help).
- Optional: `OPENAI_API_KEY` for production-grade embeddings. Without it the ingester falls back to deterministic fake vectors so tests still pass.

## Steps

1. Ensure your `.env` or shell exports `DB_URL` and (optionally) `OPENAI_API_KEY`.
2. Run the CLI:

   ```bash
   mw-py kb ingest --dir data/kb/ingested
   ```

   - `--dir` defaults to `data/kb/ingested`; pass a different directory if you stage alternate corpora.
   - The command streams per-file progress from `core.knowledge.ingest_kb`, then prints a JSON summary with counts from `kb_documents` and `kb_embeddings`.
3. Inspect the summary for the number of documents ingested and confirm no files were skipped for size or errors. Re-run if you update any of the source files.
4. (Optional) Spot-check via SQL:

   ```sql
   SELECT COUNT(*) FROM kb_documents;
   SELECT COUNT(*) FROM kb_embeddings;
   ```

## Troubleshooting

- **`DB_URL is required`** – export `DB_URL` or create `.env` with the connection string.
- **`KB directory not found`** – ensure `data/kb/ingested` exists (see `data/kb/README.md` for structure).
- **OpenAI quota issues** – unset `OPENAI_API_KEY` to fall back to deterministic test embeddings, then rerun.

Re-run ingestion after any edits to persona/project docs so RAG results stay current.
