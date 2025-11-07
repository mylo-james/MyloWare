-- Drop workflow_registry table now that workflow metadata lives directly on memories
DROP TABLE IF EXISTS "workflow_registry" CASCADE;
