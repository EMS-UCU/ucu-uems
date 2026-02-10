-- Enable real-time for notifications table
-- Run this in Supabase SQL Editor to enable real-time subscriptions

-- Enable real-time replication for notifications table
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- Verify real-time is enabled
SELECT 
  schemaname,
  tablename,
  CASE 
    WHEN EXISTS (
      SELECT 1 
      FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'notifications'
    ) THEN '✅ Enabled'
    ELSE '❌ Not Enabled'
  END as realtime_status
FROM pg_tables
WHERE schemaname = 'public' 
AND tablename = 'notifications';

-- Note: If the above doesn't work, you may need to:
-- 1. Go to Supabase Dashboard → Database → Replication
-- 2. Find the 'notifications' table
-- 3. Toggle on "Enable Realtime" for the table

