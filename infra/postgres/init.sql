DO $$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_database WHERE datname = 'myloware') THEN
      CREATE DATABASE myloware OWNER postgres;
   END IF;
END$$;

\connect myloware

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;
