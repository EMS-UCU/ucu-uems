-- AGGRESSIVE FIX: Force PostgREST to recognize the users table
-- Run this ENTIRE script in Supabase SQL Editor
-- This uses multiple techniques to force schema cache refresh

-- Step 1: Ensure table is in public schema and accessible
SET search_path TO public;

-- Step 2: Grant ALL permissions explicitly
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON TABLE public.users TO anon;
GRANT ALL ON TABLE public.users TO authenticated;
GRANT ALL ON TABLE public.users TO service_role;

-- Step 3: Explicitly grant SELECT permission (most important for queries)
GRANT SELECT ON TABLE public.users TO anon;
GRANT SELECT ON TABLE public.users TO authenticated;

-- Step 4: Make sure the table is visible in pg_catalog
SELECT 
  schemaname,
  tablename,
  tableowner
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'users';

-- Step 5: Query information_schema to force PostgREST to see the table
SELECT 
  table_catalog,
  table_schema,
  table_name,
  table_type
FROM information_schema.tables
WHERE table_schema = 'public' 
  AND table_name = 'users';

-- Step 6: Query all columns (forces PostgREST to cache the structure)
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'users'
ORDER BY ordinal_position;

-- Step 7: Perform actual SELECT query (this is what triggers cache refresh)
SELECT * FROM public.users LIMIT 1;

-- Step 8: Try NOTIFY command to reload schema
NOTIFY pgrst, 'reload schema';

-- Step 9: Alternative - try to trigger via a function call
DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
END $$;

-- Step 10: Final verification query
SELECT 
  'Schema refresh attempted!' AS status,
  COUNT(*) as user_count,
  'Wait 30-60 seconds, then refresh your browser' AS next_step
FROM public.users;




