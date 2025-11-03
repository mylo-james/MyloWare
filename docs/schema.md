# Database Schema Documentation

## Overview

The AISMR database uses a flexible three-tier prompt system that allows prompts to be defined at the persona level, project level, or persona-project combination level.

## Tables

### `projects`

Stores project definitions and configurations.

```sql
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  table_name TEXT NOT NULL,
  prompt_text TEXT,
  config JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

| Column        | Type        | Description                                     |
| ------------- | ----------- | ----------------------------------------------- |
| `id`          | UUID        | Primary key                                     |
| `name`        | TEXT        | Unique project name (e.g., "AISMR")             |
| `table_name`  | TEXT        | Database table name for project data            |
| `prompt_text` | TEXT        | Optional legacy project description             |
| `config`      | JSONB       | Project configuration (model, resolution, etc.) |
| `is_active`   | BOOLEAN     | Whether the project is active                   |
| `created_at`  | TIMESTAMPTZ | Creation timestamp                              |
| `updated_at`  | TIMESTAMPTZ | Last update timestamp                           |

**Example:**

```json
{
  "name": "AISMR",
  "table_name": "videos",
  "config": {
    "provider": "openai",
    "model": "sora-2",
    "resolution": "720x1280",
    "duration": 4,
    "drive_folder": "12iZhxhVe2cyuos9Wzl7Y_7iy0yZRdfgf"
  }
}
```

---

### `personas`

Stores AI persona definitions.

```sql
CREATE TABLE personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  prompt_text TEXT,
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

| Column        | Type        | Description                                             |
| ------------- | ----------- | ------------------------------------------------------- |
| `id`          | UUID        | Primary key                                             |
| `name`        | TEXT        | Unique persona name (e.g., "Chatbot", "Idea Generator") |
| `prompt_text` | TEXT        | Optional legacy persona description                     |
| `metadata`    | JSONB       | Persona metadata (model settings, etc.)                 |
| `is_active`   | BOOLEAN     | Whether the persona is active                           |
| `created_at`  | TIMESTAMPTZ | Creation timestamp                                      |
| `updated_at`  | TIMESTAMPTZ | Last update timestamp                                   |

**Current Personas:**

- **Chatbot** - Telegram personal AI assistant
- **Idea Generator** - Generates monthly creative video concepts
- **Screen Writer** - Writes cinematic Sora video prompts

---

### `prompts`

Stores AI prompts at three different levels using a flexible foreign key system.

```sql
CREATE TABLE prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id UUID REFERENCES personas(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  prompt_text TEXT NOT NULL,
  level INTEGER GENERATED ALWAYS AS (
    CASE
      WHEN persona_id IS NOT NULL AND project_id IS NULL THEN 1
      WHEN persona_id IS NULL AND project_id IS NOT NULL THEN 2
      WHEN persona_id IS NOT NULL AND project_id IS NOT NULL THEN 3
    END
  ) STORED,
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (persona_id IS NOT NULL OR project_id IS NOT NULL)
);
```

| Column        | Type        | Description                                            |
| ------------- | ----------- | ------------------------------------------------------ |
| `id`          | UUID        | Primary key                                            |
| `persona_id`  | UUID        | Foreign key to personas (nullable)                     |
| `project_id`  | UUID        | Foreign key to projects (nullable)                     |
| `prompt_text` | TEXT        | The actual prompt content (markdown)                   |
| `level`       | INTEGER     | Auto-computed: 1=persona, 2=project, 3=persona-project |
| `is_active`   | BOOLEAN     | Whether the prompt is active                           |
| `metadata`    | JSONB       | Prompt metadata (model settings, temperature, etc.)    |
| `created_at`  | TIMESTAMPTZ | Creation timestamp                                     |
| `updated_at`  | TIMESTAMPTZ | Last update timestamp                                  |

**Indexes:**

```sql
CREATE INDEX idx_prompts_persona ON prompts(persona_id) WHERE level = 1;
CREATE INDEX idx_prompts_project ON prompts(project_id) WHERE level = 2;
CREATE INDEX idx_prompts_persona_project ON prompts(persona_id, project_id) WHERE level = 3;
```

---

## Prompt Level System

The `level` field is a **generated column** that automatically categorizes prompts based on which foreign keys are set:

### Level 1: Persona Prompts

**Relationship:** `persona_id` SET, `project_id` NULL

**Purpose:** Base prompts that define the persona's core behavior and apply everywhere.

**Example:**

- Chatbot's system prompt defining communication style
- Idea Generator's creativity methodology
- Screen Writer's cinematography expertise

**Query:**

```sql
SELECT * FROM prompts
WHERE persona_id = '<persona_uuid>'
  AND project_id IS NULL;
-- Returns all level 1 prompts for the persona
```

---

### Level 2: Project Prompts

**Relationship:** `persona_id` NULL, `project_id` SET

**Purpose:** Project context that applies to ALL personas working on that project.

**Example:**

- AISMR project overview
- Video format specifications
- Quality dimensions and evaluation criteria

**Query:**

```sql
SELECT * FROM prompts
WHERE persona_id IS NULL
  AND project_id = '<project_uuid>';
-- Returns all level 2 prompts for the project
```

---

### Level 3: Persona-Project Prompts

**Relationship:** Both `persona_id` AND `project_id` SET

**Purpose:** Specific instructions for a persona working on a specific project.

**Example:**

- Idea Generator's AISMR-specific requirements (two-word format, descriptors)
- Screen Writer's AISMR-specific Sora 2 prompt structure
- Chatbot's AISMR video generation triggers

**Query:**

```sql
SELECT * FROM prompts
WHERE persona_id = '<persona_uuid>'
  AND project_id = '<project_uuid>';
-- Returns all level 3 prompts for the combination
```

---

## Loading Prompts for a Persona-Project Combination

To load all relevant prompts for a persona working on a project, query all three levels and order by level:

```sql
-- Get all prompts for "Idea Generator" working on "AISMR"
SELECT p.*,
       per.name as persona_name,
       proj.name as project_name
FROM prompts p
LEFT JOIN personas per ON p.persona_id = per.id
LEFT JOIN projects proj ON p.project_id = proj.id
WHERE
  -- Level 1: Persona prompts
  (p.persona_id = (SELECT id FROM personas WHERE name = 'Idea Generator')
   AND p.project_id IS NULL)
  OR
  -- Level 2: Project prompts
  (p.persona_id IS NULL
   AND p.project_id = (SELECT id FROM projects WHERE name = 'AISMR'))
  OR
  -- Level 3: Persona-Project prompts
  (p.persona_id = (SELECT id FROM personas WHERE name = 'Idea Generator')
   AND p.project_id = (SELECT id FROM projects WHERE name = 'AISMR'))
ORDER BY p.level ASC, p.created_at ASC;
```

**Result order:**

1. All persona base prompts (level 1)
2. All project context prompts (level 2)
3. All persona-project specific prompts (level 3)

---

### `runs`

Tracks orchestration state for long-running workflows.

```sql
CREATE TYPE run_status AS ENUM ('pending', 'idea_gen_pending', 'idea_gen_complete', 'ideas', 'scripts', 'videos', 'complete', 'failed');

CREATE TABLE runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  persona_id UUID,
  chat_id TEXT,
  status run_status NOT NULL DEFAULT 'pending',
  result TEXT,
  input JSONB NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_runs_project ON runs(project_id);
CREATE INDEX idx_runs_status ON runs(status);
CREATE INDEX idx_runs_created ON runs(created_at DESC);
```

| Column         | Type        | Description                                                                                                              |
| -------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| `id`           | UUID        | Primary key                                                                                                              |
| `project_id`   | TEXT        | Owning project slug (e.g., `aismr`)                                                                                      |
| `persona_id`   | UUID        | Optional persona driving the run                                                                                         |
| `chat_id`      | TEXT        | Conversation/thread identifier                                                                                           |
| `status`       | run_status  | Lifecycle stage (`pending`, `idea_gen_pending`, `idea_gen_complete`, `ideas`, `scripts`, `videos`, `complete`, `failed`) |
| `result`       | TEXT        | Outcome summary or terminal payload (e.g., video URL, error code)                                                        |
| `input`        | JSONB       | Structured input payload captured at kickoff                                                                             |
| `metadata`     | JSONB       | Additional context (provider choices, retries, etc.)                                                                     |
| `started_at`   | TIMESTAMPTZ | When the run began processing                                                                                            |
| `completed_at` | TIMESTAMPTZ | When the run finished (success or failure)                                                                               |
| `created_at`   | TIMESTAMPTZ | Creation timestamp                                                                                                       |
| `updated_at`   | TIMESTAMPTZ | Last mutation timestamp                                                                                                  |

### `videos`

Generic table storing video generation data for all projects.

```sql
CREATE TABLE videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  idea TEXT NOT NULL,
  user_idea TEXT,
  vibe TEXT,
  prompt TEXT,
  video_link TEXT,
  status video_status DEFAULT 'idea_gen',
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_videos_project_idea ON videos(project_id, idea);
```

| Column          | Type         | Description                                                                              |
| --------------- | ------------ | ---------------------------------------------------------------------------------------- |
| `id`            | UUID         | Primary key                                                                              |
| `run_id`        | UUID         | Owning automation run (links back to `runs.id`)                                          |
| `project_id`    | TEXT         | Project slug tying videos back to the owning project                                    |
| `idea`          | TEXT         | The two-word video idea                                                                  |
| `user_idea`     | TEXT         | Normalized object extracted from the request                                             |
| `vibe`          | TEXT         | Emotional descriptor for the idea (serene, tense, etc.)                                  |
| `prompt`        | TEXT         | Generated Sora 2 video prompt                                                            |
| `video_link`    | TEXT         | Link to generated video                                                                  |
| `status`        | video_status | Lifecycle status (`idea_gen`, `script_gen`, `video_gen`, `upload`, `complete`, `failed`) |
| `error_message` | TEXT         | Error details if generation failed                                                       |
| `started_at`    | TIMESTAMPTZ  | When video generation started                                                            |
| `completed_at`  | TIMESTAMPTZ  | When video generation completed                                                          |
| `created_at`    | TIMESTAMPTZ  | Creation timestamp                                                                       |
| `updated_at`    | TIMESTAMPTZ  | Last update timestamp                                                                    |

**Indexes:**

```sql
CREATE INDEX idx_videos_status ON videos(status);
CREATE INDEX idx_videos_run ON videos(run_id);
CREATE INDEX idx_videos_created ON videos(created_at DESC);
CREATE INDEX idx_videos_project ON videos(project_id);
CREATE UNIQUE INDEX idx_videos_project_idea ON videos(project_id, idea);
```

## Metadata Structure

The `metadata` JSONB field stores configuration and settings:

### Persona-Level Prompts (Level 1)

```json
{
  "model": "gpt-4",
  "temperature": 0.7
}
```

### Project-Level Prompts (Level 2)

```json
{
  "project": "AISMR"
}
```

### Persona-Project Prompts (Level 3)

```json
{
  "project": "AISMR",
  "persona": "Idea Generator"
}
```

---

## Common Queries

### Get all active personas

```sql
SELECT * FROM personas WHERE is_active = true;
```

### Get all active projects

```sql
SELECT * FROM projects WHERE is_active = true;
```

### Count prompts by level

```sql
SELECT
  level,
  CASE
    WHEN level = 1 THEN 'PERSONA'
    WHEN level = 2 THEN 'PROJECT'
    WHEN level = 3 THEN 'PERSONA+PROJECT'
  END as level_name,
  COUNT(*) as prompt_count
FROM prompts
WHERE is_active = true
GROUP BY level
ORDER BY level;
```

### Get prompt structure overview

```sql
SELECT
  CASE
    WHEN level = 1 THEN 'PERSONA'
    WHEN level = 2 THEN 'PROJECT'
    WHEN level = 3 THEN 'PERSONA+PROJECT'
  END as prompt_level,
  per.name as persona_name,
  proj.name as project_name,
  p.level,
  LEFT(p.prompt_text, 60) || '...' as prompt_preview
FROM prompts p
LEFT JOIN personas per ON p.persona_id = per.id
LEFT JOIN projects proj ON p.project_id = proj.id
WHERE p.is_active = true
ORDER BY level, persona_name, project_name;
```

### Get all AISMR ideas by status

```sql
SELECT status, COUNT(*) AS count
FROM videos
WHERE project_id = (SELECT id FROM projects WHERE name = 'AISMR')
GROUP BY status
ORDER BY status;
```

### Get pending AISMR videos

```sql
SELECT
  date_trunc('month', created_at) AS month,
  idea,
  vibe,
  created_at
FROM videos
WHERE project_id = (SELECT id FROM projects WHERE name = 'AISMR')
  AND status IN ('video_gen', 'upload')
ORDER BY created_at ASC;
```

---

## Design Decisions

### Why Generated Columns for `level`?

- **Automatic** - No manual categorization needed
- **Accurate** - Always reflects the actual foreign key relationships
- **Indexed** - Can efficiently query by level
- **Immutable** - Can't be set incorrectly

### Why Nullable Foreign Keys?

- **Flexibility** - Allows three distinct prompt types with a single table
- **Simplicity** - No junction tables needed
- **Clear semantics** - NULL clearly indicates "applies everywhere"
- **Efficient** - Single table, fewer joins

### Why JSONB for metadata?

- **Flexibility** - Different prompt types need different metadata
- **Extensibility** - Easy to add new fields without schema changes
- **Queryable** - PostgreSQL JSONB supports efficient querying and indexing

### Why TEXT for prompts?

- **Markdown support** - Prompts are written in markdown
- **Size** - No artificial length limits
- **Readability** - Can view prompts directly in database tools

---

## Schema Evolution

### Version History

**v1.0** (October 2025)

- Initial three-tier prompt system
- Generated `level` column
- Removed `display_order` for simplicity
- Removed `prompt_type` in favor of `level`

---

## Related Documentation

- **Prompt Management**: `/scripts/README.md` - How to manage prompts from markdown files
- **Quick Reference**: `/PROMPTS.md` - Naming conventions and workflow
- **Changelog**: `/CHANGELOG-LEVEL.md` - Recent schema changes

---

**Last Updated**: October 16, 2025
**Schema Version**: 1.0
**Database**: PostgreSQL (Supabase)

```

```
