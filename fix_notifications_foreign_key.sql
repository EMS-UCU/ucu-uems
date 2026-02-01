-- FIX: Notifications foreign key violation
-- Run this in Supabase SQL Editor if you see:
--   "insert or update on table notifications violates foreign key constraint notifications_user_id_fkey"
--   or "Failed to notify vetter: ... 0 sent, 1 failed"
--
-- Cause: notifications.user_id referenced auth.users(id), but vetter/chief ids
-- come from user_profiles. If a user exists in user_profiles but not in auth.users,
-- inserts fail.
--
-- This migration changes the FK to reference public.user_profiles(id) so any
-- user in user_profiles can receive notifications.

-- 1. Drop the existing foreign key to auth.users
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_user_id_fkey;

-- 2. Add foreign key to user_profiles (same ids; allows all app users to receive notifications)
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.user_profiles(id) ON DELETE CASCADE;

SELECT '✅ Notifications FK updated: user_id now references user_profiles(id). Notifications should work.' AS status;
