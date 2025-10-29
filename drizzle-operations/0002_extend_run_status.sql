DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'idea_gen_pending' AND enumtypid = 'run_status'::regtype
  ) THEN
    ALTER TYPE run_status ADD VALUE 'idea_gen_pending';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'idea_gen_complete' AND enumtypid = 'run_status'::regtype
  ) THEN
    ALTER TYPE run_status ADD VALUE 'idea_gen_complete';
  END IF;
END $$;
