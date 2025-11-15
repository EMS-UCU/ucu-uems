-- Refresh Supabase schema cache and verify table exists
-- Run this in Supabase SQL Editor

-- First, verify the table exists
SELECT 
  schemaname,
  tablename,
  tableowner
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'users';

-- Check table structure
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'users'
ORDER BY ordinal_position;

-- Verify RLS is enabled and policies exist
SELECT 
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'users';

SELECT 
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'users';

-- Grant necessary permissions (important for PostgREST)
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON TABLE public.users TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- Refresh the schema cache by querying the table
SELECT COUNT(*) FROM public.users;

-- Verify user data
SELECT 
  id,
  username,
  email,
  name,
  base_role,
  password_hash,
  is_super_admin
FROM public.users
WHERE email = 'superadmin@ucu.ac.ug';





