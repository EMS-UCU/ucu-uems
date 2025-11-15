-- QUICK TEST: Check if you can access users table
-- Run this in Supabase SQL Editor

-- Test 1: Can we see the table?
SELECT 'Test 1: Table exists' AS test;
SELECT COUNT(*) as user_count FROM public.users;

-- Test 2: Can we see a specific user?
SELECT 'Test 2: Find user by email' AS test;
SELECT 
  id,
  email,
  name,
  base_role
FROM public.users
WHERE email = 'superadmin@ucu.ac.ug'
LIMIT 1;

-- Test 3: Check RLS policies
SELECT 'Test 3: RLS Policies' AS test;
SELECT 
  policyname,
  cmd as operation,
  roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'users';

-- If Test 1 or Test 2 fail with "permission denied" or 404, 
-- you need to run fix_login_rls_permissions.sql




