DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'videos'
      AND column_name = 'user_idea'
      AND data_type <> 'text'
  ) THEN
    ALTER TABLE videos
      ALTER COLUMN user_idea TYPE text USING user_idea::text;
  END IF;
END $$;
