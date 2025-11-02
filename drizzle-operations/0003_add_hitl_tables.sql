-- Create enums for workflow run status and stages
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_run_status') THEN
    CREATE TYPE workflow_run_status AS ENUM ('running', 'waiting_for_hitl', 'completed', 'failed', 'needs_revision');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_stage') THEN
    CREATE TYPE workflow_stage AS ENUM ('idea_generation', 'screenplay', 'video_generation', 'publishing');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'hitl_approval_status') THEN
    CREATE TYPE hitl_approval_status AS ENUM ('pending', 'approved', 'rejected');
  END IF;
END $$;

-- Create workflow_runs table
CREATE TABLE IF NOT EXISTS workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id text NOT NULL,
  session_id uuid NOT NULL,
  current_stage workflow_stage NOT NULL,
  status workflow_run_status NOT NULL DEFAULT 'running',
  
  -- Stage status tracking as JSONB
  stages jsonb NOT NULL DEFAULT '{
    "idea_generation": {"status": "pending"},
    "screenplay": {"status": "pending"},
    "video_generation": {"status": "pending"},
    "publishing": {"status": "pending"}
  }'::jsonb,
  
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  workflow_definition_chunk_id text REFERENCES prompt_embeddings(chunk_id),
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create hitl_approvals table
CREATE TABLE IF NOT EXISTS hitl_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  stage workflow_stage NOT NULL,
  content jsonb NOT NULL,
  
  status hitl_approval_status NOT NULL DEFAULT 'pending',
  reviewed_by text,
  reviewed_at timestamptz,
  feedback text,
  
  created_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_current_stage ON workflow_runs(current_stage);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_project ON workflow_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_session ON workflow_runs(session_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_created ON workflow_runs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hitl_approvals_status ON hitl_approvals(status);
CREATE INDEX IF NOT EXISTS idx_hitl_approvals_workflow_run ON hitl_approvals(workflow_run_id);
CREATE INDEX IF NOT EXISTS idx_hitl_approvals_stage ON hitl_approvals(stage);
CREATE INDEX IF NOT EXISTS idx_hitl_approvals_created ON hitl_approvals(created_at DESC);

