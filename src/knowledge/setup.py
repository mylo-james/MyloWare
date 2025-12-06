"""Knowledge base setup and management.

## RAG Flow (Llama Stack 0.3.x)

1. **Create Vector Store**: Call `setup_project_knowledge()` to create a vector store
2. **Upload Documents**: Files are uploaded and added to the vector store
3. **Agent Config**: Use `file_search` tool type with `vector_store_ids` in agent tools
4. **Retrieval**: During agent turns, the LLM can call file_search to query the vector store
5. **Response**: Agent incorporates retrieved context into its response

## Example

```python
# Setup
vector_store_id = setup_project_knowledge(client, "my_project", documents)

# Create agent with file_search tool
agent = Agent(
    client,
    model=model_id,
    tools=[{
        "type": "file_search",
        "vector_store_ids": [vector_store_id],
    }]
)
```
"""

from __future__ import annotations

import logging
import os
import uuid

from langfuse import observe
from llama_stack_client import LlamaStackClient

logger = logging.getLogger(__name__)

__all__ = [
    "register_knowledge_base",
    "ingest_documents",
    "setup_project_knowledge",
    "get_existing_vector_store",
    "DEFAULT_CHUNK_SIZE",
]

# Default chunk configuration
DEFAULT_CHUNK_SIZE = 512

# Environment variable to force re-ingestion
FORCE_REINGEST = os.getenv("FORCE_KNOWLEDGE_REINGEST", "false").lower() == "true"


def get_existing_vector_store(client: LlamaStackClient, name: str) -> str | None:
    """Get existing vector store ID by name.
    
    Returns the vector store ID if found, None otherwise.
    """
    try:
        vector_stores = client.vector_stores.list()
        for store in vector_stores:
            store_name = getattr(store, "name", None)
            store_id = getattr(store, "id", None)
            if store_name == name:
                logger.info("Found existing vector store: name=%s, id=%s", store_name, store_id)
                return store_id
        return None
    except Exception as exc:
        logger.warning("Error listing vector stores: %s", exc)
        return None


@observe(name="register_knowledge_base")
def register_knowledge_base(
    client: LlamaStackClient,
    project_id: str,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
) -> str:
    """Register a vector store for project knowledge.
    
    Reuses existing vector store if one with the same name exists.
    Uses OpenAI-compatible vector_stores API (Llama Stack 0.3.x).
    """
    store_name = f"project_kb_{project_id}"
    
    # Check for existing store FIRST
    existing_id = get_existing_vector_store(client, store_name)
    if existing_id:
        logger.info("Reusing existing vector store: %s", existing_id)
        return existing_id

    logger.info(
        "Creating vector store: name=%s, chunk_size=%s",
        store_name,
        chunk_size,
    )

    try:
        # Create vector store using OpenAI-compatible API
        store = client.vector_stores.create(
            name=store_name,
            chunking_strategy={
                "type": "static",
                "static": {
                    "max_chunk_size_tokens": chunk_size,
                    "chunk_overlap_tokens": 50,
                }
            },
        )
        vector_store_id = store.id
        logger.info("Vector store created: name=%s, id=%s", store_name, vector_store_id)
        return vector_store_id

    except Exception as exc:
        error_str = str(exc).lower()
        if "already exists" in error_str:
            # Try to find it again
            existing_id = get_existing_vector_store(client, store_name)
            if existing_id:
                return existing_id
            logger.warning("Vector store exists but couldn't find it; using name as ID")
            return store_name
        else:
            logger.error("Failed to create vector store: %s", exc)
            raise


def vector_store_has_files(client: LlamaStackClient, vector_store_id: str) -> bool:
    """Check if a vector store already has files."""
    try:
        files = client.vector_stores.files.list(vector_store_id=vector_store_id)
        file_count = len(list(files))
        logger.info("Vector store %s has %d files", vector_store_id, file_count)
        return file_count > 0
    except Exception as exc:
        logger.warning("Error checking vector store files: %s", exc)
        return False


@observe(name="ingest_documents")
def ingest_documents(
    client: LlamaStackClient,
    vector_store_id: str,
    documents: list[dict],
    chunk_size: int = DEFAULT_CHUNK_SIZE,
) -> int:
    """Ingest documents into vector store.
    
    Uses OpenAI-compatible files and vector_stores API (Llama Stack 0.3.x).
    """

    logger.info(
        "Ingesting %s documents into %s",
        len(documents),
        vector_store_id,
    )

    file_ids = []
    for doc in documents:
        doc_id = doc.get("id") or str(uuid.uuid4())
        
        if "content" in doc:
            # Upload content as a file
            content = doc["content"]
            filename = doc.get("metadata", {}).get("filename", f"{doc_id}.txt")
            
            try:
                file_response = client.files.create(
                    file=(filename, content.encode("utf-8"), "text/plain"),
                    purpose="assistants",
                )
                file_ids.append(file_response.id)
                logger.debug("Uploaded file: %s -> %s", filename, file_response.id)
            except Exception as exc:
                logger.warning("Failed to upload document %s: %s", doc_id, exc)
                continue
                
        elif "url" in doc:
            # For URLs, the content should be pre-fetched
            logger.warning("URL documents not supported in new API; skipping %s", doc_id)
            continue
        else:
            raise ValueError(f"Document {doc_id} must have either 'content' or 'url'")

    # Add files to vector store
    if file_ids:
        try:
            # Use file batch API if multiple files, otherwise individual
            if len(file_ids) > 1:
                client.vector_stores.file_batches.create(
                    vector_store_id=vector_store_id,
                    file_ids=file_ids,
                )
            else:
                for file_id in file_ids:
                    client.vector_stores.files.create(
                        vector_store_id=vector_store_id,
                        file_id=file_id,
                    )
            logger.info("Added %s files to vector store %s", len(file_ids), vector_store_id)
        except Exception as exc:
            logger.error("Failed to add files to vector store: %s", exc)
            raise

    return len(file_ids)


def setup_project_knowledge(
    client: LlamaStackClient,
    project_id: str,
    documents: list[dict] | None = None,
    force_reingest: bool = False,
) -> str:
    """Set up a complete project knowledge base.
    
    - Reuses existing vector store if one exists with the same name
    - Skips document ingestion if store already has files
    - Use force_reingest=True or FORCE_KNOWLEDGE_REINGEST env var to re-ingest
    
    Returns the vector_store_id to use with file_search tool.
    """
    should_force = force_reingest or FORCE_REINGEST
    
    # Get or create vector store
    vector_store_id = register_knowledge_base(client, project_id)
    
    # Check if we need to ingest documents
    if documents:
        if should_force:
            logger.info("Force re-ingesting documents into %s", vector_store_id)
            ingest_documents(client, vector_store_id, documents)
        elif not vector_store_has_files(client, vector_store_id):
            logger.info("Vector store empty, ingesting documents")
            ingest_documents(client, vector_store_id, documents)
        else:
            logger.info("Vector store already has files, skipping ingestion")

    return vector_store_id
