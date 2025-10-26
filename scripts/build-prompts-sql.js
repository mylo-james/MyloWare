#!/usr/bin/env node

/**
 * Build SQL INSERT statements for prompts from markdown files
 *
 * Naming convention:
 * - persona-{name}.md → Persona-level prompt (applies everywhere)
 * - project-{name}.md → Project-level prompt (applies to all personas)
 * - {persona}-{project}.md → Persona+Project prompt (specific combination)
 * - bak.*.md → Ignored (backup files)
 * - README.md → Ignored
 */

const fs = require('fs');
const path = require('path');

const PROMPTS_DIR = path.join(__dirname, '../prompts');
const OUTPUT_FILE = path.join(__dirname, '../sql/prompts-inserts.sql');

// Known personas and projects (can be extended)
const PERSONAS = {
  chat: 'Chatbot',
  ideagenerator: 'Idea Generator',
  screenwriter: 'Screen Writer',
};

const PROJECTS = {
  aismr: 'AISMR',
};

/**
 * Parse filename to determine prompt type and entities
 * @param {string} filename - The markdown filename
 * @returns {Object|null} Parsed information or null if file should be skipped
 */
function parseFilename(filename) {
  // Skip backup files and README
  if (filename.startsWith('bak.') || filename === 'README.md') {
    return null;
  }

  // Remove .md extension
  const base = filename.replace('.md', '');
  const parts = base.split('-');

  if (parts[0] === 'persona' && parts.length === 2) {
    // persona-{name}.md
    const personaKey = parts[1].toLowerCase();
    return {
      type: 'persona',
      persona: PERSONAS[personaKey] || parts[1],
      personaKey,
      project: null,
      projectKey: null,
    };
  } else if (parts[0] === 'project' && parts.length === 2) {
    // project-{name}.md
    const projectKey = parts[1].toLowerCase();
    return {
      type: 'project',
      persona: null,
      personaKey: null,
      project: PROJECTS[projectKey] || parts[1],
      projectKey,
    };
  } else if (parts.length === 2) {
    // {persona}-{project}.md
    const personaKey = parts[0].toLowerCase();
    const projectKey = parts[1].toLowerCase();
    return {
      type: 'persona-project',
      persona: PERSONAS[personaKey] || parts[0],
      personaKey,
      project: PROJECTS[projectKey] || parts[1],
      projectKey,
    };
  }

  console.warn(`Warning: Could not parse filename pattern: ${filename}`);
  return null;
}

/**
 * Convert prompt markdown into a JSON-friendly single-line string
 * so it can be embedded safely inside a SQL literal without
 * introducing raw newlines (which appear as \n in Supabase JSON output).
 *
 * @param {string} text - Prompt markdown
 * @returns {string} Escaped single-line string with literal \n sequences
 */
function toJsonFriendlySqlString(text) {
  const trimmed = text.trim();
  // JSON.stringify gives us literal \n sequences; strip surrounding quotes
  const jsonEscaped = JSON.stringify(trimmed).slice(1, -1);
  // Escape single quotes for SQL
  return jsonEscaped.replace(/'/g, "''");
}

/**
 * Infer metadata from prompt info
 * @param {Object} info - Parsed filename info
 * @returns {Object} Metadata object
 */
function inferMetadata(info) {
  const metadata = {};

  if (info.type === 'persona') {
    metadata.model = 'gpt-4';
    metadata.temperature = info.personaKey === 'ideagenerator' ? 0.8 : 0.7;
  } else if (info.type === 'project') {
    metadata.project = info.project;
  } else if (info.type === 'persona-project') {
    metadata.project = info.project;
    metadata.persona = info.persona;
  }

  return metadata;
}

/**
 * Generate SQL INSERT statement for a prompt
 * @param {Object} info - Parsed filename info
 * @param {string} content - Prompt content
 * @returns {string} SQL INSERT statement
 */
function generateInsert(info, content) {
  const promptText = toJsonFriendlySqlString(content);
  const metadata = inferMetadata(info);
  const metadataJson = JSON.stringify(metadata).replace(/'/g, "''");

  let personaClause = 'NULL';
  let projectClause = 'NULL';

  if (info.persona) {
    personaClause = `(SELECT id FROM personas WHERE name = '${info.persona}')`;
  }
  if (info.project) {
    projectClause = `(SELECT id FROM projects WHERE name = '${info.project}')`;
  }

  return `-- ${info.type.toUpperCase()}: ${info.persona || ''} ${
    info.project || ''
  }
INSERT INTO prompts (persona_id, project_id, prompt_text, metadata) VALUES
(${personaClause}, ${projectClause},
 '${promptText}',
 '${metadataJson}');
`;
}

/**
 * Main function to build SQL from all markdown files
 */
function buildPromptsSql() {
  console.log('📖 Reading prompts from:', PROMPTS_DIR);

  const files = fs
    .readdirSync(PROMPTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();

  const prompts = {
    persona: [],
    project: [],
    personaProject: [],
  };

  // Parse all files
  for (const filename of files) {
    const info = parseFilename(filename);
    if (!info) {
      console.log(`⏭️  Skipping: ${filename}`);
      continue;
    }

    const filePath = path.join(PROMPTS_DIR, filename);
    const content = fs.readFileSync(filePath, 'utf8');

    const prompt = { info, content, filename };

    if (info.type === 'persona') {
      prompts.persona.push(prompt);
    } else if (info.type === 'project') {
      prompts.project.push(prompt);
    } else if (info.type === 'persona-project') {
      prompts.personaProject.push(prompt);
    }

    console.log(`✅ Parsed: ${filename} (${info.type})`);
  }

  // Generate SQL
  let sql = `-- ============================================================================
-- AUTO-GENERATED PROMPTS INSERTS
-- Generated from prompts/*.md files
-- DO NOT EDIT MANUALLY - Run: npm run build:prompts
-- ============================================================================

`;

  // Persona-level prompts
  if (prompts.persona.length > 0) {
    sql += `-- ============================================================================
-- PERSONA-LEVEL PROMPTS (persona_id set, project_id NULL)
-- These are base instructions that apply to the persona everywhere
-- ============================================================================

`;
    for (const prompt of prompts.persona) {
      sql += generateInsert(prompt.info, prompt.content);
      sql += '\n';
    }
  }

  // Project-level prompts
  if (prompts.project.length > 0) {
    sql += `-- ============================================================================
-- PROJECT-LEVEL PROMPTS (project_id set, persona_id NULL)
-- These apply to ALL personas working on this project
-- ============================================================================

`;
    for (const prompt of prompts.project) {
      sql += generateInsert(prompt.info, prompt.content);
      sql += '\n';
    }
  }

  // Persona-project prompts
  if (prompts.personaProject.length > 0) {
    sql += `-- ============================================================================
-- PERSONA-PROJECT PROMPTS (both persona_id and project_id set)
-- These are specific instructions for a persona working on a specific project
-- ============================================================================

`;
    for (const prompt of prompts.personaProject) {
      sql += generateInsert(prompt.info, prompt.content);
      sql += '\n';
    }
  }

  // Write output
  fs.writeFileSync(OUTPUT_FILE, sql, 'utf8');
  console.log('\n✨ Generated SQL file:', OUTPUT_FILE);
  console.log(`   📊 ${prompts.persona.length} persona prompts`);
  console.log(`   📊 ${prompts.project.length} project prompts`);
  console.log(`   📊 ${prompts.personaProject.length} persona-project prompts`);
  console.log(
    `   📊 ${
      prompts.persona.length +
      prompts.project.length +
      prompts.personaProject.length
    } total prompts`
  );
}

// Run the script
try {
  buildPromptsSql();
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
