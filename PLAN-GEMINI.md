# Plan: Gemini Prompt Vector Store

This document outlines the plan to build a server that stores prompts in a vector database and exposes them through an API for an AI to query. The server will be self-hosted and accessible via a `cloudflared` tunnel.

## 1. Project Overview

The goal is to create a service that can store a collection of prompts and allow for semantic searching over them. This will enable an AI agent to find relevant prompts for a given task.

The system will consist of:

- A **Node.js/TypeScript server** using Express.
- A **PostgreSQL database** for storing the prompts' text and metadata.
- The **`pgvector` extension** for PostgreSQL to handle vector storage and similarity search.
- A **sentence-transformer model** to generate vector embeddings for the prompts.
- **Drizzle ORM** for database interactions.
- **Docker and Docker Compose** to manage the services.
- **`cloudflared`** to create a public tunnel to the local server.

## 2. Technology Stack

| Component            | Technology                   | Rationale                                                                                              |
| -------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Server**           | Node.js, TypeScript, Express | A modern, performant, and type-safe stack for building APIs. Matches the existing project's patterns.  |
| **Database**         | PostgreSQL                   | A robust, open-source relational database.                                                             |
| **Vector Store**     | `pgvector`                   | An extension for PostgreSQL that allows for storing and querying vector embeddings directly in the DB. |
| **ORM**              | Drizzle ORM                  | A modern, type-safe SQL query builder for TypeScript.                                                  |
| **Vectorization**    | `@xenova/transformers`       | A JavaScript library for running transformer models, which can be used to generate embeddings.         |
| **Containerization** | Docker, Docker Compose       | To easily manage and run the PostgreSQL database and other services.                                   |
| **Tunneling**        | `cloudflared`                | To expose the local server to the internet for the AI to access.                                       |

## 3. Project Setup and Implementation Steps

### Step 1: Directory Structure

Create a new directory for the server, e.g., `prompt-server`, with a structure similar to the `mylo_mcp_reference`.

```
prompt-server/
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── src/
│   ├── server.ts
│   ├── db/
│   │   ├── schema.ts
│   │   └── migrate.ts
│   └── lib/
│       └── embeddings.ts
└── cloudflared/
    └── config.yml
```

### Step 2: `docker-compose.yml`

Set up a `docker-compose.yml` file to run PostgreSQL with the `pgvector` extension.

```yaml
version: '3.8'
services:
  db:
    image: pgvector/pgvector:pg16
    container_name: prompt-db
    ports:
      - '5432:5432'
    environment:
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=promptdb
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

### Step 3: `package.json`

Initialize a Node.js project and install the necessary dependencies.

```json
{
  "name": "prompt-server",
  "version": "1.0.0",
  "main": "src/server.ts",
  "scripts": {
    "start": "ts-node src/server.ts",
    "dev": "nodemon --watch src --exec ts-node src/server.ts",
    "db:migrate": "ts-node src/db/migrate.ts"
  },
  "dependencies": {
    "@xenova/transformers": "^2.14.1",
    "dotenv": "^16.3.1",
    "drizzle-orm": "^0.29.3",
    "express": "^4.18.2",
    "pg": "^8.11.3"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.11.5",
    "@types/pg": "^8.10.9",
    "drizzle-kit": "^0.20.13",
    "nodemon": "^3.0.3",
    "ts-node": "^10.9.2",
    "typescript": "^5.3.3"
  }
}
```

### Step 4: Database Schema (`src/db/schema.ts`)

Define the database schema using Drizzle ORM. We'll need a table to store the prompts and their embeddings.

```typescript
import { pgTable, serial, text, vector } from 'drizzle-orm/pg-core';

export const prompts = pgTable('prompts', {
  id: serial('id').primaryKey(),
  text: text('text').notNull(),
  embedding: vector('embedding', { dimensions: 384 }).notNull(),
});
```

_(Note: The embedding dimension, here 384, depends on the model used for vectorization.)_

### Step 5: Vectorization (`src/lib/embeddings.ts`)

Create a module to handle the generation of vector embeddings from text using a sentence-transformer model.

```typescript
import { pipeline } from '@xenova/transformers';

class EmbeddingPipeline {
  static instance = null;

  static async getInstance() {
    if (this.instance === null) {
      this.instance = await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2'
      );
    }
    return this.instance;
  }
}

export const generateEmbedding = async (text: string): Promise<number[]> => {
  const extractor = await EmbeddingPipeline.getInstance();
  const result = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(result.data);
};
```

### Step 6: Server Implementation (`src/server.ts`)

Create the Express server with API endpoints for adding and searching for prompts.

```typescript
import express from 'express';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import * as schema from './db/schema';
import { generateEmbedding } from './lib/embeddings';

const app = express();
app.use(express.json());

const pool = new Pool({
  connectionString: 'postgres://user:password@localhost:5432/promptdb',
});
const db = drizzle(pool, { schema });

// Endpoint to add a new prompt
app.post('/prompts', async (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).send({ error: 'Text is required' });
  }
  const embedding = await generateEmbedding(text);
  const [newPrompt] = await db
    .insert(schema.prompts)
    .values({ text, embedding })
    .returning();
  res.status(201).send(newPrompt);
});

// Endpoint to search for similar prompts
app.post('/prompts/search', async (req, res) => {
  const { text, count = 5 } = req.body;
  if (!text) {
    return res.status(400).send({ error: 'Text is required' });
  }
  const queryEmbedding = await generateEmbedding(text);
  const queryEmbeddingSql = `[${queryEmbedding.join(',')}]`;

  // Using cosine distance for similarity search
  const similarPrompts = await db
    .select()
    .from(schema.prompts)
    .orderBy(sql`embedding <=> ${queryEmbeddingSql}`)
    .limit(count);

  res.send(similarPrompts);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
```

### Step 7: Database Migration

Create a script to run Drizzle Kit migrations (`src/db/migrate.ts`).

```typescript
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function main() {
  console.log('Running migrations...');
  await migrate(db, { migrationsFolder: 'drizzle' });
  console.log('Migrations finished.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

You will also need a `drizzle.config.ts` file.

### Step 8: `cloudflared` Setup

Configure `cloudflared` to expose the local server.

1.  Install `cloudflared`.
2.  Authenticate with your Cloudflare account.
3.  Create a tunnel: `cloudflared tunnel create my-prompt-server`.
4.  Update `cloudflared/config.yml` with the tunnel details.
5.  Run the tunnel: `cloudflared tunnel run --config cloudflared/config.yml my-prompt-server`.

## 4. AI Tool Integration

Once the server is running and exposed via `cloudflared`, you can create tools for your AI agent to interact with the API. The agent can use the `/prompts/search` endpoint to find relevant prompts by providing a search query.

Example tool definition (conceptual):

```json
{
  "name": "find_similar_prompts",
  "description": "Searches for prompts that are semantically similar to the given text.",
  "input_schema": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string",
        "description": "The text to search for."
      },
      "count": {
        "type": "number",
        "description": "The number of similar prompts to return."
      }
    },
    "required": ["text"]
  },
  "url": "https://<your-tunnel-url>.trycloudflare.com/prompts/search",
  "method": "POST"
}
```

## 5. Next Steps

- **Authentication:** Add authentication to the API endpoints to secure them.
- **Batch Ingestion:** Create a script to ingest all existing prompts from the `prompts/` directory.
- **CRUD Operations:** Implement full CRUD (Create, Read, Update, Delete) operations for prompts.
- **Metadata:** Add a `metadata` JSONB column to the `prompts` table to store additional information.
- **Testing:** Write unit and integration tests for the server.
- **CI/CD:** Set up a CI/CD pipeline to automate testing and deployment.
