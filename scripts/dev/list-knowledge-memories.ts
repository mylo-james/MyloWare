import { fileURLToPath } from 'url';
import path from 'path';
import { db } from '../../src/db/client.js';
import { memories } from '../../src/db/schema.js';
import { desc, sql } from 'drizzle-orm';

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  console.log(`Listing recent knowledge memories (script location: ${__dirname})`);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(memories)
    .where(sql`${memories.metadata} ->> 'sourceType' = 'ingest'`);

  console.log(`Total memories with sourceType=\"ingest\": ${count}`);

  if (count === 0) {
    console.log('No knowledge memories found.');
    return;
  }

  const rows = await db
    .select({
      id: memories.id,
      content: memories.content,
      persona: memories.persona,
      project: memories.project,
      tags: memories.tags,
      traceId: memories.traceId,
      updatedAt: memories.updatedAt,
      metadata: memories.metadata,
    })
    .from(memories)
    .where(sql`${memories.metadata} ->> 'sourceType' = 'ingest'`)
    .orderBy(desc(memories.updatedAt))
    .limit(5);

  console.log('\nMost recent entries:');
  for (const row of rows) {
    console.log('---');
    console.log(`id: ${row.id}`);
    console.log(`updatedAt: ${row.updatedAt?.toISOString?.() ?? row.updatedAt}`);
    console.log(`traceId: ${row.traceId ?? 'NULL'}`);
    console.log(`persona: ${row.persona.join(', ') || '[]'}`);
    console.log(`project: ${row.project.join(', ') || '[]'}`);
    console.log(`tags: ${row.tags.join(', ')}`);
    console.log(`content preview: ${row.content.slice(0, 140)}${
      row.content.length > 140 ? '…' : ''
    }`);
    if (row.metadata?.sourceUrl) {
      console.log(`sourceUrl: ${row.metadata.sourceUrl}`);
    }
  }
}

main()
  .catch((err) => {
    console.error('Error listing knowledge memories:', err);
    process.exit(1);
  })
  .finally(() => {
    process.exit();
  });
