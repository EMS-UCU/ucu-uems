-- Check Supabase Auth Settings That Might Block Login
-- Run this in Supabase SQL Editor

-- 1. Check if user exists and status
SELECT 
  id,
  email,
  email_confirmed_at IS NOT NULL as email_confirmed,
  encrypted_password IS NOT NULL as has_password,
  phone_confirmed_at IS NOT NULL as phone_confirmed,
  confirmed_at IS NOT NULL as confirmed,
  banned_until,
  deleted_at,
  created_at,
  updated_at,
  last_sign_in_at
FROM auth.users
WHERE email = 'superadmin@ucu.ac.ug';

-- 2. Check for any auth configuration issues
-- Note: Most auth settings are in Dashboard, not SQL

-- 3. Check if there are any triggers that might modify passwords
SELECT 
  trigger_name,
  event_manipulation,
  event_object_table,
  action_timing,
  action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'auth'
  AND event_object_table = 'users';

-- 4. Check for any functions that might modify auth data
SELECT 
  routine_name,
  routine_type,
  routine_definition
FROM information_schema.routines
WHERE routine_schema = 'auth'
  AND (routine_name LIKE '%password%' OR routine_name LIKE '%user%');

-- 5. Check user metadata for any clues
SELECT 
  email,
  raw_user_meta_data,
  user_metadata,
  app_metadata
FROM auth.users
WHERE email = 'superadmin@ucu.ac.ug';


