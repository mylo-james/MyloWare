-- Initialize MCP database with required extensions and schema
-- This runs automatically when the postgres container first starts

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create operations schema for workflow/video data
CREATE SCHEMA IF NOT EXISTS operations;

-- Grant permissions
GRANT ALL ON SCHEMA operations TO postgres;
GRANT ALL ON SCHEMA public TO postgres;

-- Enable extensions in operations schema too
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA operations;

