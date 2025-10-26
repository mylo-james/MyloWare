-- Average generation time by month
SELECT
  month,
  AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) AS avg_seconds
FROM videos
WHERE started_at IS NOT NULL AND completed_at IS NOT NULL
GROUP BY month
ORDER BY month;

