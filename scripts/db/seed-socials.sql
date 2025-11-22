-- Seed socials and project_socials mappings for test_video_gen
-- Run with: psql $DB_URL -f scripts/db/seed-socials.sql
-- Or: docker compose -f infra/docker-compose.yml exec postgres psql -U postgres -d myloware -f /path/to/seed-socials.sql

-- Insert or get the AISMR social account
-- First, try to find existing
DO $$
DECLARE
    social_uuid UUID;
BEGIN
    -- Check if exists
    SELECT id INTO social_uuid
    FROM socials
    WHERE provider = 'upload-post' AND account_id = 'AISMR'
    LIMIT 1;

    -- If not exists, insert
    IF social_uuid IS NULL THEN
        INSERT INTO socials (provider, account_id, credential_ref, default_caption, default_tags, privacy)
        VALUES ('upload-post', 'AISMR', NULL, NULL, NULL, NULL)
        RETURNING id INTO social_uuid;
    END IF;

    -- Link test_video_gen to AISMR
    INSERT INTO project_socials (project, social_id, is_primary)
    VALUES ('test_video_gen', social_uuid, true)
    ON CONFLICT DO NOTHING;

    -- Update if exists
    UPDATE project_socials
    SET is_primary = true
    WHERE project = 'test_video_gen' AND social_id = social_uuid;
END $$;

