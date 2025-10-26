-- Success rate by workflow
SELECT
  workflow_name,
  COUNT(*) FILTER (WHERE status = 'success') AS successes,
  COUNT(*) FILTER (WHERE status = 'error') AS errors,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'success') / NULLIF(COUNT(*),0), 2) AS success_rate
FROM workflow_logs
GROUP BY workflow_name
ORDER BY success_rate DESC NULLS LAST;

-- Recent errors
SELECT created_at, workflow_name, node_name, message, error_details
FROM workflow_logs
WHERE status = 'error'
ORDER BY created_at DESC
LIMIT 20;

-- Average duration by workflow
SELECT
  workflow_name,
  AVG(duration_ms) AS avg_duration_ms,
  MAX(duration_ms) AS max_duration_ms
FROM workflow_logs
WHERE duration_ms IS NOT NULL
GROUP BY workflow_name
ORDER BY avg_duration_ms NULLS LAST;

