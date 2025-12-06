-- Initialize databases for MyloWare and Langfuse
-- This script runs on first PostgreSQL startup

CREATE DATABASE myloware;
CREATE DATABASE langfuse;

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE myloware TO postgres;
GRANT ALL PRIVILEGES ON DATABASE langfuse TO postgres;

