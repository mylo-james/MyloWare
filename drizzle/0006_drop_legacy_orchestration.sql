-- Remove legacy orchestration tables (replaced by execution traces)
DROP TABLE IF EXISTS "run_events" CASCADE;
DROP TABLE IF EXISTS "handoff_tasks" CASCADE;
DROP TABLE IF EXISTS "agent_runs" CASCADE;
