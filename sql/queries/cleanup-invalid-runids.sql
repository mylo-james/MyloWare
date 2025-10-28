-- ============================================================================
-- CLEANUP: Delete videos with invalid run_id or incomplete status
-- ============================================================================
-- This script removes videos that have:
--   1. NULL run_id values
--   2. run_id values that don't exist in the runs table (orphaned records)
--   3. status != 'complete' (failed/incomplete runs before error handling implemented)
-- ============================================================================

-- Preview what will be deleted (run this first to verify)
SELECT 
  v.id,
  v.idea,
  v.run_id,
  v.status,
  v.created_at,
  CASE 
    WHEN v.run_id IS NULL THEN 'NULL run_id'
    WHEN r.id IS NULL THEN 'Orphaned (run does not exist)'
    WHEN v.status IS NULL OR v.status != 'complete' THEN 'Incomplete/Failed (status: ' || COALESCE(v.status::text, 'NULL') || ')'
  END as reason
FROM videos v
LEFT JOIN runs r ON v.run_id = r.id
WHERE v.run_id IS NULL 
   OR r.id IS NULL
   OR v.status IS NULL
   OR v.status != 'complete';

-- Show count before deletion
SELECT 
  COUNT(*) as total_videos,
  COUNT(CASE WHEN run_id IS NULL THEN 1 END) as null_run_ids,
  COUNT(CASE WHEN run_id IS NOT NULL THEN 1 END) as with_run_ids,
  COUNT(CASE WHEN status = 'complete' THEN 1 END) as complete_videos,
  COUNT(CASE WHEN status IS NULL OR status != 'complete' THEN 1 END) as incomplete_videos
FROM videos;

-- ============================================================================
-- EXECUTE DELETION (uncomment when ready)
-- ============================================================================

-- Delete videos with NULL run_id
DELETE FROM videos 
WHERE run_id IS NULL;

-- Delete videos with run_id that doesn't exist in runs table (orphaned)
DELETE FROM videos 
WHERE run_id IS NOT NULL 
  AND NOT EXISTS (
    SELECT 1 FROM runs WHERE runs.id = videos.run_id
  );

-- Delete videos with status != 'complete' (failed/incomplete runs)
DELETE FROM videos
WHERE status IS NULL 
   OR status != 'complete';

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Show count after deletion
SELECT 
  COUNT(*) as remaining_videos,
  COUNT(DISTINCT run_id) as unique_runs_referenced,
  COUNT(CASE WHEN status = 'complete' THEN 1 END) as all_complete
FROM videos;

-- Verify all remaining videos have valid run_id AND complete status
SELECT 
  'All videos have valid run_id and complete status' as status,
  COUNT(*) as valid_videos
FROM videos v
INNER JOIN runs r ON v.run_id = r.id
WHERE v.status = 'complete';

SELECT '✅ Cleanup complete!' as result;
