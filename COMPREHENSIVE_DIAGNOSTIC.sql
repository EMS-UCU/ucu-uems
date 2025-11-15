-- COMPREHENSIVE DIAGNOSTIC: Find the exact issue
-- Run this ENTIRE script in Supabase SQL Editor
-- This will help us identify what's wrong

-- ============================================
-- PART 1: Verify Table Exists
-- ============================================
SELECT '=== PART 1: Table Existence ===' AS section;

SELECT 
  'Table exists in pg_tables' AS check_name,
  COUNT(*) as result
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'users';

-- ============================================
-- PART 2: Check Schema and Permissions
-- ============================================
SELECT '=== PART 2: Schema & Permissions ===' AS section;

-- Check schema usage
SELECT 
  'Schema usage granted' AS check_name,
  COUNT(*) as result
FROM information_schema.role_table_grants
WHERE table_schema = 'public' 
  AND table_name = 'users'
  AND grantee = 'anon'
  AND privilege_type = 'USAGE';

-- Check table permissions
SELECT 
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' 
  AND table_name = 'users'
  AND grantee IN ('anon', 'authenticated')
ORDER BY grantee, privilege_type;

-- ============================================
-- PART 3: Check RLS Status
-- ============================================
SELECT '=== PART 3: RLS Status ===' AS section;

SELECT 
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'users';

SELECT 
  policyname,
  cmd as operation,
  roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'users';

-- ============================================
-- PART 4: Test Queries (These should work)
-- ============================================
SELECT '=== PART 4: Test Queries ===' AS section;

-- Test 1: Simple count
SELECT 'Test 1: COUNT query' AS test_name;
SELECT COUNT(*) as user_count FROM public.users;

-- Test 2: Select all columns
SELECT 'Test 2: SELECT * query' AS test_name;
SELECT * FROM public.users LIMIT 1;

-- Test 3: Select specific columns (what app uses)
SELECT 'Test 3: SELECT specific columns' AS test_name;
SELECT 
  id,
  email,
  username,
  name,
  base_role,
  roles,
  password_hash,
  is_super_admin
FROM public.users
WHERE email = 'superadmin@ucu.ac.ug'
LIMIT 1;

-- ============================================
-- PART 5: Force Schema Refresh Attempts
-- ============================================
SELECT '=== PART 5: Schema Refresh Attempts ===' AS section;

-- Grant permissions again (ensures they're set)
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON TABLE public.users TO anon, authenticated;
GRANT ALL ON TABLE public.users TO anon, authenticated;

-- Query information_schema (forces PostgREST to see structure)
SELECT 
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'users'
ORDER BY ordinal_position;

-- Try NOTIFY
SELECT 'Attempting NOTIFY pgrst...' AS action;
NOTIFY pgrst, 'reload schema';

-- ============================================
-- PART 6: Final Verification
-- ============================================
SELECT '=== PART 6: Final Status ===' AS section;

SELECT 
  '✅ All checks complete!' AS status,
  'If queries above worked, table is accessible' AS note,
  'If app still fails, it may be a PostgREST cache delay' AS suggestion;




