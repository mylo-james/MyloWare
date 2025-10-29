CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'run_status') THEN
    CREATE TYPE run_status AS ENUM ('pending', 'idea_gen_pending', 'idea_gen_complete', 'ideas', 'scripts', 'videos', 'complete', 'failed');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'video_status') THEN
    CREATE TYPE video_status AS ENUM ('idea_gen', 'script_gen', 'video_gen', 'upload', 'complete', 'failed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
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
  project_id uuid NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_videos_run ON videos(run_id);
CREATE INDEX IF NOT EXISTS idx_videos_created ON videos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_project ON videos(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_project_idea ON videos(project_id, idea);
