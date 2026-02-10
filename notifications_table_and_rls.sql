-- Notifications table and RLS so Chief Examiner can notify vetters
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query) if:
--   - Vetters are not receiving "Vetting Session Started"
--   - The bell icon shows no badge / "No notifications yet"
-- Without the INSERT policy below, the Chief cannot create notifications for other users (RLS blocks it).
--
-- If you ALREADY ran an older version of this script and get "notifications_user_id_fkey" or "0 sent, 1 failed",
-- run fix_notifications_foreign_key.sql instead (see RUN_NOTIFICATIONS_SQL.md).

-- 1. Create notifications table if it doesn't exist
-- user_id references user_profiles(id) so any user in user_profiles can receive notifications
-- (avoids FK violation when ids come from user_profiles but user is not in auth.users)
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  title TEXT,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('info', 'warning', 'error', 'success', 'deadline')),
  is_read BOOLEAN DEFAULT FALSE,
  related_exam_paper_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);

-- 2. Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 3. Drop existing policies (if any) so we can replace them
DROP POLICY IF EXISTS "Users can read own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Allow insert for any recipient" ON public.notifications;
DROP POLICY IF EXISTS "Enable read for users own" ON public.notifications;
DROP POLICY IF EXISTS "Enable insert for authenticated" ON public.notifications;
DROP POLICY IF EXISTS "Enable update for users own" ON public.notifications;

-- 4. Allow any authenticated user to INSERT (so Chief Examiner can create a notification for a Vetter)
CREATE POLICY "Allow insert for any recipient"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (true);

-- 5. Users can only SELECT their own notifications (user_id = current user)
CREATE POLICY "Users can read own notifications"
ON public.notifications
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- 6. Users can only UPDATE their own notifications (e.g. mark as read)
CREATE POLICY "Users can update own notifications"
ON public.notifications
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 7. Grant permissions
GRANT ALL ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;

-- 8. Enable real-time (ignore error if table already in publication)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN OTHERS THEN NULL;
END $$;

SELECT '✅ Notifications table and RLS ready. Chief can notify vetters; bell will show notifications.' AS status;
