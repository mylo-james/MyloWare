CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'run_status') THEN
    CREATE TYPE run_status AS ENUM (
      'pending',
      'idea_gen_pending',
      'idea_gen_complete',
      'ideas',
      'scripts',
      'videos',
      'complete',
      'failed'
    );
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumtypid = 'run_status'::regtype AND enumlabel = 'pending'
    ) THEN
      ALTER TYPE run_status ADD VALUE 'pending';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumtypid = 'run_status'::regtype AND enumlabel = 'idea_gen_pending'
    ) THEN
      ALTER TYPE run_status ADD VALUE 'idea_gen_pending';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumtypid = 'run_status'::regtype AND enumlabel = 'idea_gen_complete'
    ) THEN
      ALTER TYPE run_status ADD VALUE 'idea_gen_complete';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumtypid = 'run_status'::regtype AND enumlabel = 'ideas'
    ) THEN
      ALTER TYPE run_status ADD VALUE 'ideas';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumtypid = 'run_status'::regtype AND enumlabel = 'scripts'
    ) THEN
      ALTER TYPE run_status ADD VALUE 'scripts';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumtypid = 'run_status'::regtype AND enumlabel = 'videos'
    ) THEN
      ALTER TYPE run_status ADD VALUE 'videos';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumtypid = 'run_status'::regtype AND enumlabel = 'complete'
    ) THEN
      ALTER TYPE run_status ADD VALUE 'complete';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumtypid = 'run_status'::regtype AND enumlabel = 'failed'
    ) THEN
      ALTER TYPE run_status ADD VALUE 'failed';
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'video_status') THEN
    CREATE TYPE video_status AS ENUM ('idea_gen', 'script_gen', 'video_gen', 'upload', 'complete', 'failed');
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumtypid = 'video_status'::regtype AND enumlabel = 'idea_gen'
    ) THEN
      ALTER TYPE video_status ADD VALUE 'idea_gen';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumtypid = 'video_status'::regtype AND enumlabel = 'script_gen'
    ) THEN
      ALTER TYPE video_status ADD VALUE 'script_gen';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumtypid = 'video_status'::regtype AND enumlabel = 'video_gen'
    ) THEN
      ALTER TYPE video_status ADD VALUE 'video_gen';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumtypid = 'video_status'::regtype AND enumlabel = 'upload'
    ) THEN
      ALTER TYPE video_status ADD VALUE 'upload';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumtypid = 'video_status'::regtype AND enumlabel = 'complete'
    ) THEN
      ALTER TYPE video_status ADD VALUE 'complete';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumtypid = 'video_status'::regtype AND enumlabel = 'failed'
    ) THEN
      ALTER TYPE video_status ADD VALUE 'failed';
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_run_status') THEN
    CREATE TYPE workflow_run_status AS ENUM ('running', 'completed', 'failed', 'needs_revision');
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumtypid = 'workflow_run_status'::regtype AND enumlabel = 'running'
    ) THEN
      ALTER TYPE workflow_run_status ADD VALUE 'running';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumtypid = 'workflow_run_status'::regtype AND enumlabel = 'completed'
    ) THEN
      ALTER TYPE workflow_run_status ADD VALUE 'completed';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumtypid = 'workflow_run_status'::regtype AND enumlabel = 'failed'
    ) THEN
      ALTER TYPE workflow_run_status ADD VALUE 'failed';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumtypid = 'workflow_run_status'::regtype AND enumlabel = 'needs_revision'
    ) THEN
      ALTER TYPE workflow_run_status ADD VALUE 'needs_revision';
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_stage') THEN
    CREATE TYPE workflow_stage AS ENUM ('idea_generation', 'screenplay', 'video_generation', 'publishing');
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumtypid = 'workflow_stage'::regtype AND enumlabel = 'idea_generation'
    ) THEN
      ALTER TYPE workflow_stage ADD VALUE 'idea_generation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumtypid = 'workflow_stage'::regtype AND enumlabel = 'screenplay'
    ) THEN
      ALTER TYPE workflow_stage ADD VALUE 'screenplay';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumtypid = 'workflow_stage'::regtype AND enumlabel = 'video_generation'
    ) THEN
      ALTER TYPE workflow_stage ADD VALUE 'video_generation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum WHERE enumtypid = 'workflow_stage'::regtype AND enumlabel = 'publishing'
    ) THEN
      ALTER TYPE workflow_stage ADD VALUE 'publishing';
    END IF;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id text NOT NULL,
  persona_id uuid,
  chat_id text,
  status run_status NOT NULL DEFAULT 'pending',
  result text,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  idea text NOT NULL,
  user_idea text,
  vibe text,
  prompt text,
  video_link text,
  status video_status NOT NULL DEFAULT 'idea_gen',
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id text NOT NULL,
  session_id uuid NOT NULL,
  current_stage workflow_stage NOT NULL,
  status workflow_run_status NOT NULL DEFAULT 'running',
  stages jsonb NOT NULL DEFAULT
    '{"idea_generation":{"status":"pending"},"screenplay":{"status":"pending"},"video_generation":{"status":"pending"},"publishing":{"status":"pending"}}'::jsonb,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  workflow_definition_chunk_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_videos_run ON videos(run_id);
CREATE INDEX IF NOT EXISTS idx_videos_created ON videos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_project ON videos(project_id);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_current_stage ON workflow_runs(current_stage);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_project ON workflow_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_session ON workflow_runs(session_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_created ON workflow_runs(created_at DESC);
