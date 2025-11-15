-- Fix RLS policies and permissions for Supabase
-- Run this in Supabase SQL Editor

-- Step 1: Drop existing policies
DROP POLICY IF EXISTS "Allow all operations" ON public.users;
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON public.users;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.users;
DROP POLICY IF EXISTS "Enable insert for all users" ON public.users;
DROP POLICY IF EXISTS "Enable update for all users" ON public.users;
DROP POLICY IF EXISTS "Enable delete for all users" ON public.users;

-- Step 2: Grant permissions to anon and authenticated roles
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON TABLE public.users TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.users TO anon, authenticated;

-- Step 3: Create comprehensive RLS policies
-- Policy for SELECT (read)
CREATE POLICY "Enable read access for all users"
ON public.users
FOR SELECT
TO anon, authenticated
USING (true);

-- Policy for INSERT
CREATE POLICY "Enable insert for all users"
ON public.users
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- Policy for UPDATE
CREATE POLICY "Enable update for all users"
ON public.users
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- Policy for DELETE
CREATE POLICY "Enable delete for all users"
ON public.users
FOR DELETE
TO anon, authenticated
USING (true);

-- Step 4: Verify RLS is enabled
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Step 5: Test query
SELECT 
  id,
  email,
  name,
  base_role,
  is_super_admin
FROM public.users
LIMIT 5;





