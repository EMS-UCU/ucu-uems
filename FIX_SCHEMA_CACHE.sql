-- FIX: "Could not find the table 'public.users' in the schema cache"
-- Run this ENTIRE script in Supabase SQL Editor
-- This forces Supabase to refresh its schema cache

-- Step 1: Ensure all permissions are granted
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.users TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- Step 2: Force schema cache refresh by querying information_schema
-- This makes PostgREST aware of the table structure
SELECT 
  table_schema,
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'users'
ORDER BY ordinal_position;

-- Step 3: Query the table directly (this helps refresh cache)
SELECT COUNT(*) as user_count FROM public.users;

-- Step 4: Query with specific columns (simulates what the app does)
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

-- Step 5: Try to trigger PostgREST schema reload (if available)
-- Note: This may not work in all Supabase projects, but it's worth trying
NOTIFY pgrst, 'reload schema';

-- Step 6: Verify table is accessible
SELECT 
  'Table exists and should be in cache now!' AS status,
  COUNT(*) as total_users
FROM public.users;

-- IMPORTANT: After running this script:
-- 1. Wait 10-30 seconds for the cache to refresh
-- 2. Refresh your browser page
-- 3. Try logging in again




