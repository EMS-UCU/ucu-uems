-- Test query to verify user exists and check data
-- Run this in Supabase SQL Editor

-- Check if user exists
SELECT 
  id,
  username,
  email,
  name,
  base_role,
  roles,
  password_hash,
  is_super_admin,
  campus,
  department
FROM users
WHERE email = 'superadmin@ucu.ac.ug';

-- Check RLS policies
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'users';

-- Verify RLS is enabled
SELECT 
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'users';





