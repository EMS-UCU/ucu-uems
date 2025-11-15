-- DIAGNOSTIC SCRIPT: Check users table and RLS policies
-- Run this in Supabase SQL Editor to diagnose the login issue

-- Step 1: Check if table exists and show structure
SELECT 'Step 1: Table Structure' AS step;
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'users'
ORDER BY ordinal_position;

-- Step 2: Check if RLS is enabled
SELECT 'Step 2: RLS Status' AS step;
SELECT 
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'users';

-- Step 3: Show all RLS policies
SELECT 'Step 3: Current RLS Policies' AS step;
SELECT 
  policyname,
  permissive,
  roles,
  cmd as operation,
  qual as using_expression,
  with_check as with_check_expression
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'users';

-- Step 4: Check permissions
SELECT 'Step 4: Table Permissions' AS step;
SELECT 
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'users';

-- Step 5: Count users in table
SELECT 'Step 5: User Count' AS step;
SELECT COUNT(*) as total_users FROM public.users;

-- Step 6: Show all users (without passwords for security)
SELECT 'Step 6: Users in Table' AS step;
SELECT 
  id,
  username,
  email,
  name,
  base_role,
  roles,
  is_super_admin,
  campus,
  department,
  created_at
FROM public.users
ORDER BY created_at DESC;

-- Step 7: Test query as anon role (simulates what the app does)
SELECT 'Step 7: Test Query (as app would do)' AS step;
-- This simulates what your app does when trying to login
SET ROLE anon;
SELECT 
  id,
  email,
  name,
  base_role,
  password_hash IS NOT NULL as has_password
FROM public.users
WHERE email = 'superadmin@ucu.ac.ug'
LIMIT 1;
RESET ROLE;

-- Step 8: Check if there are any users with the test email
SELECT 'Step 8: Check for test user' AS step;
SELECT 
  id,
  username,
  email,
  name,
  base_role,
  CASE 
    WHEN password_hash IS NOT NULL THEN 'Has password'
    ELSE 'No password'
  END as password_status
FROM public.users
WHERE email = 'superadmin@ucu.ac.ug' OR email = 'marvin.zziwa@ucu.ac.ug';




