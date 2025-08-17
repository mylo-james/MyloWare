-- Initialize MyloWare database with required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Create initial schema
CREATE SCHEMA IF NOT EXISTS public;

-- Set default privileges
GRANT ALL ON SCHEMA public TO myloware;
GRANT ALL ON ALL TABLES IN SCHEMA public TO myloware;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO myloware;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO myloware;