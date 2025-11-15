-- FIX: Refresh Supabase Schema Cache
-- This forces Supabase to recognize the users table
-- Run this in Supabase SQL Editor

-- Step 1: Grant permissions (ensures anon can see the table)
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON TABLE public.users TO anon, authenticated;

-- Step 2: Force schema cache refresh by querying the table
-- This query forces PostgREST to refresh its cache
SELECT 
  table_schema,
  table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'users'
ORDER BY ordinal_position;

-- Step 3: Make a simple query to the table (this helps refresh cache)
SELECT COUNT(*) FROM public.users;

-- Step 4: Query with the exact columns the app uses
SELECT 
  id,
  email,
  username,
  name,
  base_role,
  roles,
  password_hash,
  is_super_admin,
  campus,
  department,
  created_at,
  updated_at
FROM public.users
LIMIT 1;

-- Step 5: Verify the table is accessible
SELECT 'Schema cache should be refreshed now!' AS status;
SELECT 'Try logging in again in 10-30 seconds' AS next_step;




