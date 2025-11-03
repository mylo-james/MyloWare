ALTER TABLE runs
  ALTER COLUMN project_id TYPE text USING project_id::text;

ALTER TABLE videos
  ALTER COLUMN project_id TYPE text USING project_id::text;
