-- Enhanced Database Migration for VC Sync Tool
-- This migration adds new tables and features for improved monitoring, alerts, and performance tracking

-- Create alerts table for system monitoring
CREATE TABLE IF NOT EXISTS alerts (
  id SERIAL PRIMARY KEY,
  alert_id VARCHAR(255) UNIQUE NOT NULL,
  type VARCHAR(50) NOT NULL CHECK (type IN ('error', 'warning', 'info')),
  message TEXT NOT NULL,
  sync_pair_id INTEGER REFERENCES sync_pairs(id) ON DELETE CASCADE,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Create performance metrics table
CREATE TABLE IF NOT EXISTS performance_metrics (
  id SERIAL PRIMARY KEY,
  operation_id VARCHAR(255) NOT NULL,
  duration INTEGER NOT NULL, -- milliseconds
  timestamp BIGINT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create data quality reports table
CREATE TABLE IF NOT EXISTS data_quality_reports (
  id SERIAL PRIMARY KEY,
  sync_pair_id INTEGER NOT NULL REFERENCES sync_pairs(id) ON DELETE CASCADE,
  overall_score DECIMAL(3,2) NOT NULL CHECK (overall_score >= 0 AND overall_score <= 1),
  field_analysis JSONB NOT NULL DEFAULT '{}'::jsonb,
  recommendations TEXT[],
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create webhook logs table
CREATE TABLE IF NOT EXISTS webhook_logs (
  id SERIAL PRIMARY KEY,
  source VARCHAR(50) NOT NULL CHECK (source IN ('affinity', 'notion')),
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  sync_pairs_triggered INTEGER[] DEFAULT ARRAY[]::INTEGER[],
  created_at TIMESTAMP DEFAULT NOW(),
  processed_at TIMESTAMP
);

-- Add new columns to existing sync_pairs table
ALTER TABLE sync_pairs 
ADD COLUMN IF NOT EXISTS webhook_enabled BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS auto_resolve_conflicts BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS data_quality_threshold DECIMAL(3,2) DEFAULT 0.8 CHECK (data_quality_threshold >= 0 AND data_quality_threshold <= 1),
ADD COLUMN IF NOT EXISTS max_sync_duration INTEGER DEFAULT 300000, -- 5 minutes in milliseconds
ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 1 CHECK (priority >= 1 AND priority <= 5);

-- Add new columns to sync_history table for enhanced tracking
ALTER TABLE sync_history 
ADD COLUMN IF NOT EXISTS api_calls_made INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS rate_limit_hits INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS data_quality_score DECIMAL(3,2),
ADD COLUMN IF NOT EXISTS performance_metrics JSONB DEFAULT '{}'::jsonb;

-- Add new columns to conflicts table
ALTER TABLE conflicts
ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 1 CHECK (priority >= 1 AND priority <= 5),
ADD COLUMN IF NOT EXISTS auto_resolution_attempted BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS conflict_type VARCHAR(50) DEFAULT 'field_mismatch',
ADD COLUMN IF NOT EXISTS resolution_confidence DECIMAL(3,2) CHECK (resolution_confidence >= 0 AND resolution_confidence <= 1);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_alerts_type_resolved ON alerts(type, resolved);
CREATE INDEX IF NOT EXISTS idx_alerts_sync_pair_id ON alerts(sync_pair_id);
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at);

CREATE INDEX IF NOT EXISTS idx_performance_metrics_operation_id ON performance_metrics(operation_id);
CREATE INDEX IF NOT EXISTS idx_performance_metrics_timestamp ON performance_metrics(timestamp);

CREATE INDEX IF NOT EXISTS idx_data_quality_reports_sync_pair_id ON data_quality_reports(sync_pair_id);
CREATE INDEX IF NOT EXISTS idx_data_quality_reports_created_at ON data_quality_reports(created_at);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_source_processed ON webhook_logs(source, processed);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_created_at ON webhook_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_sync_history_performance ON sync_history(sync_pair_id, created_at, status);
CREATE INDEX IF NOT EXISTS idx_conflicts_priority_status ON conflicts(priority DESC, status);

-- Create materialized view for sync pair health summary
CREATE MATERIALIZED VIEW IF NOT EXISTS sync_pair_health_summary AS
SELECT 
  sp.id,
  sp.name,
  sp.is_active,
  sp.priority,
  
  -- Recent sync stats (last 24 hours)
  COUNT(sh.id) FILTER (WHERE sh.created_at > NOW() - INTERVAL '24 hours') as syncs_last_24h,
  COUNT(sh.id) FILTER (WHERE sh.created_at > NOW() - INTERVAL '24 hours' AND sh.status = 'success') as successful_syncs_24h,
  COUNT(sh.id) FILTER (WHERE sh.created_at > NOW() - INTERVAL '24 hours' AND sh.status = 'error') as failed_syncs_24h,
  
  -- Average performance
  AVG(sh.duration) FILTER (WHERE sh.created_at > NOW() - INTERVAL '7 days') as avg_duration_7d,
  
  -- Conflict stats
  COUNT(c.id) FILTER (WHERE c.status = 'pending') as pending_conflicts,
  COUNT(c.id) FILTER (WHERE c.status = 'pending' AND c.priority >= 4) as high_priority_conflicts,
  
  -- Alert stats
  COUNT(a.id) FILTER (WHERE a.resolved = FALSE) as active_alerts,
  COUNT(a.id) FILTER (WHERE a.resolved = FALSE AND a.type = 'error') as active_error_alerts,
  
  -- Data quality
  (SELECT dqr.overall_score 
   FROM data_quality_reports dqr 
   WHERE dqr.sync_pair_id = sp.id 
   ORDER BY dqr.created_at DESC 
   LIMIT 1) as latest_quality_score,
   
  -- Health score calculation (0-100)
  CASE 
    WHEN sp.is_active = FALSE THEN 0
    ELSE (
      COALESCE(
        -- Base score from success rate
        (COUNT(sh.id) FILTER (WHERE sh.created_at > NOW() - INTERVAL '24 hours' AND sh.status = 'success')::FLOAT / 
         NULLIF(COUNT(sh.id) FILTER (WHERE sh.created_at > NOW() - INTERVAL '24 hours'), 0)) * 40, 0
      ) +
      COALESCE(
        -- Performance score (fast syncs get higher score)
        GREATEST(0, 30 - (AVG(sh.duration) FILTER (WHERE sh.created_at > NOW() - INTERVAL '7 days') / 10000)::INTEGER), 0
      ) +
      COALESCE(
        -- Data quality score
        (SELECT dqr.overall_score FROM data_quality_reports dqr WHERE dqr.sync_pair_id = sp.id ORDER BY dqr.created_at DESC LIMIT 1) * 20, 0
      ) -
      -- Penalties
      (COUNT(c.id) FILTER (WHERE c.status = 'pending' AND c.priority >= 4) * 5) - -- High priority conflicts
      (COUNT(a.id) FILTER (WHERE a.resolved = FALSE AND a.type = 'error') * 10) -- Active error alerts
    )
  END::INTEGER as health_score,
  
  NOW() as last_updated
  
FROM sync_pairs sp
LEFT JOIN sync_history sh ON sp.id = sh.sync_pair_id
LEFT JOIN conflicts c ON sp.id = c.sync_pair_id
LEFT JOIN alerts a ON sp.id = a.sync_pair_id
GROUP BY sp.id, sp.name, sp.is_active, sp.priority;

-- Create unique index on materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_pair_health_summary_id ON sync_pair_health_summary(id);

-- Create function to refresh materialized view
CREATE OR REPLACE FUNCTION refresh_sync_pair_health_summary()
RETURNS VOID AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY sync_pair_health_summary;
END;
$$ LANGUAGE plpgsql;

-- Create trigger function for automatic cleanup of old data
CREATE OR REPLACE FUNCTION cleanup_old_data()
RETURNS VOID AS $$
BEGIN
  -- Clean up performance metrics older than 7 days
  DELETE FROM performance_metrics 
  WHERE created_at < NOW() - INTERVAL '7 days';
  
  -- Clean up resolved alerts older than 30 days
  DELETE FROM alerts 
  WHERE resolved = TRUE AND resolved_at < NOW() - INTERVAL '30 days';
  
  -- Clean up webhook logs older than 7 days
  DELETE FROM webhook_logs 
  WHERE created_at < NOW() - INTERVAL '7 days';
  
  -- Clean up old data quality reports (keep only last 30 per sync pair)
  DELETE FROM data_quality_reports
  WHERE id NOT IN (
    SELECT id FROM (
      SELECT id, 
             ROW_NUMBER() OVER (PARTITION BY sync_pair_id ORDER BY created_at DESC) as rn
      FROM data_quality_reports
    ) ranked
    WHERE rn <= 30
  );
  
  -- Update table statistics
  ANALYZE alerts;
  ANALYZE performance_metrics;
  ANALYZE webhook_logs;
  ANALYZE data_quality_reports;
  
  -- Refresh health summary
  PERFORM refresh_sync_pair_health_summary();
END;
$$ LANGUAGE plpgsql;

-- Create stored procedure for conflict auto-resolution
CREATE OR REPLACE FUNCTION attempt_auto_resolve_conflicts()
RETURNS TABLE(resolved_count INTEGER, failed_count INTEGER) AS $$
DECLARE
  resolved_count INTEGER := 0;
  failed_count INTEGER := 0;
  conflict_record RECORD;
BEGIN
  -- Only attempt auto-resolution for conflicts where sync pair has auto_resolve enabled
  FOR conflict_record IN 
    SELECT c.*, sp.auto_resolve_conflicts, sp.sync_direction
    FROM conflicts c
    JOIN sync_pairs sp ON c.sync_pair_id = sp.id
    WHERE c.status = 'pending' 
      AND c.auto_resolution_attempted = FALSE
      AND sp.auto_resolve_conflicts = TRUE
      AND c.created_at > NOW() - INTERVAL '1 hour' -- Only try recent conflicts
  LOOP
    BEGIN
      -- Apply auto-resolution logic based on sync direction and timestamps
      IF conflict_record.sync_direction = 'affinity-to-notion' THEN
        -- Affinity wins
        UPDATE conflicts 
        SET status = 'resolved', 
            resolution = 'affinity',
            resolved_at = NOW(),
            resolution_confidence = 0.8
        WHERE id = conflict_record.id;
        resolved_count := resolved_count + 1;
        
      ELSIF conflict_record.sync_direction = 'notion-to-affinity' THEN
        -- Notion wins
        UPDATE conflicts 
        SET status = 'resolved', 
            resolution = 'notion',
            resolved_at = NOW(),
            resolution_confidence = 0.8
        WHERE id = conflict_record.id;
        resolved_count := resolved_count + 1;
        
      ELSE
        -- Bidirectional: use most recent timestamp
        IF conflict_record.affinity_last_modified > conflict_record.notion_last_modified THEN
          UPDATE conflicts 
          SET status = 'resolved', 
              resolution = 'affinity',
              resolved_at = NOW(),
              resolution_confidence = 0.9
          WHERE id = conflict_record.id;
          resolved_count := resolved_count + 1;
        ELSE
          UPDATE conflicts 
          SET status = 'resolved', 
              resolution = 'notion',
              resolved_at = NOW(),
              resolution_confidence = 0.9
          WHERE id = conflict_record.id;
          resolved_count := resolved_count + 1;
        END IF;
      END IF;
      
      -- Mark as attempted regardless of outcome
      UPDATE conflicts 
      SET auto_resolution_attempted = TRUE 
      WHERE id = conflict_record.id;
      
    EXCEPTION WHEN OTHERS THEN
      -- Mark as attempted but failed
      UPDATE conflicts 
      SET auto_resolution_attempted = TRUE 
      WHERE id = conflict_record.id;
      failed_count := failed_count + 1;
    END;
  END LOOP;
  
  RETURN QUERY SELECT resolved_count, failed_count;
END;
$$ LANGUAGE plpgsql;

-- Create function to calculate sync pair priority score
CREATE OR REPLACE FUNCTION calculate_sync_priority(sync_pair_id INTEGER)
RETURNS INTEGER AS $$
DECLARE
  base_priority INTEGER;
  failure_penalty INTEGER := 0;
  conflict_penalty INTEGER := 0;
  performance_bonus INTEGER := 0;
  calculated_priority INTEGER;
BEGIN
  -- Get base priority from sync_pairs table
  SELECT priority INTO base_priority
  FROM sync_pairs 
  WHERE id = sync_pair_id;
  
  -- Calculate failure penalty (recent failures reduce priority)
  SELECT COUNT(*) * 2 INTO failure_penalty
  FROM sync_history 
  WHERE sync_pair_id = sync_pair_id 
    AND status = 'error' 
    AND created_at > NOW() - INTERVAL '24 hours';
  
  -- Calculate conflict penalty
  SELECT COUNT(*) INTO conflict_penalty
  FROM conflicts 
  WHERE sync_pair_id = sync_pair_id 
    AND status = 'pending';
  
  -- Calculate performance bonus (fast, reliable syncs get higher priority)
  SELECT CASE 
    WHEN AVG(duration) < 10000 AND COUNT(*) > 0 THEN 1 -- Under 10 seconds gets bonus
    ELSE 0 
  END INTO performance_bonus
  FROM sync_history 
  WHERE sync_pair_id = sync_pair_id 
    AND status = 'success'
    AND created_at > NOW() - INTERVAL '7 days';
  
  -- Calculate final priority (1-10 scale)
  calculated_priority := GREATEST(1, 
    LEAST(10, 
      base_priority + performance_bonus - LEAST(3, failure_penalty) - LEAST(2, conflict_penalty)
    )
  );
  
  RETURN calculated_priority;
END;
$$ LANGUAGE plpgsql;

-- Insert default configuration values
INSERT INTO sync_pairs (id, name, affinity_list_id, affinity_list_name, notion_database_id, notion_database_name)
SELECT 0, 'System Configuration', '0', 'System', '0', 'System'
WHERE NOT EXISTS (SELECT 1 FROM sync_pairs WHERE id = 0);

-- Create default admin user if none exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users LIMIT 1) THEN
    INSERT INTO users (username, password) 
    VALUES ('admin', '$2b$10$rQj9fHJ7QXjj8b9Xq1yE7eK7ZFHc9G5Hx3Nq8Wp4L5M6R7S8T9U0V1'); -- Default: 'admin123'
  END IF;
END $$;

-- Grant appropriate permissions (adjust based on your user roles)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO PUBLIC;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO PUBLIC;

-- Create helpful views for monitoring
CREATE OR REPLACE VIEW sync_health_dashboard AS
SELECT 
  sp.name as sync_pair_name,
  sp.is_active,
  sp.sync_direction,
  sp.sync_frequency,
  shs.health_score,
  shs.syncs_last_24h,
  shs.successful_syncs_24h,
  shs.failed_syncs_24h,
  shs.pending_conflicts,
  shs.active_error_alerts,
  shs.latest_quality_score,
  CASE 
    WHEN shs.health_score >= 80 THEN 'Healthy'
    WHEN shs.health_score >= 60 THEN 'Warning' 
    ELSE 'Critical'
  END as status,
  sp.last_sync,
  shs.last_updated
FROM sync_pairs sp
LEFT JOIN sync_pair_health_summary shs ON sp.id = shs.id
WHERE sp.id != 0 -- Exclude system configuration
ORDER BY shs.health_score DESC NULLS LAST, sp.priority DESC;

-- Create view for recent activity summary
CREATE OR REPLACE VIEW recent_activity_summary AS
SELECT 
  'sync' as activity_type,
  sp.name as sync_pair_name,
  sh.status,
  sh.records_updated,
  sh.records_created,
  sh.conflicts_found,
  sh.duration,
  sh.created_at as timestamp
FROM sync_history sh
JOIN sync_pairs sp ON sh.sync_pair_id = sp.id
WHERE sh.created_at > NOW() - INTERVAL '24 hours'

UNION ALL

SELECT 
  'alert' as activity_type,
  COALESCE(sp.name, 'System') as sync_pair_name,
  a.type as status,
  0 as records_updated,
  0 as records_created,
  0 as conflicts_found,
  0 as duration,
  a.created_at as timestamp
FROM alerts a
LEFT JOIN sync_pairs sp ON a.sync_pair_id = sp.id
WHERE a.created_at > NOW() - INTERVAL '24 hours'

ORDER BY timestamp DESC;

-- Final optimizations
VACUUM ANALYZE;

-- Success message
DO $$
BEGIN
  RAISE NOTICE '✅ Enhanced database migration completed successfully!';
  RAISE NOTICE 'New features added:';
  RAISE NOTICE '  - System monitoring with alerts';
  RAISE NOTICE '  - Performance metrics tracking';  
  RAISE NOTICE '  - Data quality reports';
  RAISE NOTICE '  - Webhook logging';
  RAISE NOTICE '  - Auto-conflict resolution';
  RAISE NOTICE '  - Health scoring system';
  RAISE NOTICE '  - Automated cleanup procedures';
END $$;