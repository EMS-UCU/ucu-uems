-- Fix RLS policies for vetting_sessions table
-- Run this in Supabase SQL Editor if recordings aren't syncing

-- Step 1: Check current RLS status
SELECT 
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename = 'vetting_sessions';

-- Step 2: Enable RLS if not already enabled
ALTER TABLE vetting_sessions ENABLE ROW LEVEL SECURITY;

-- Step 3: Drop existing policies (if any) to start fresh
DROP POLICY IF EXISTS "Enable read access for all authenticated users" ON vetting_sessions;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON vetting_sessions;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON vetting_sessions;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON vetting_sessions;
DROP POLICY IF EXISTS "Users can view their own sessions" ON vetting_sessions;
DROP POLICY IF EXISTS "Users can update their own sessions" ON vetting_sessions;
DROP POLICY IF EXISTS "Chief Examiners can view all sessions" ON vetting_sessions;

-- Step 4: Create comprehensive RLS policies

-- Allow all authenticated users to read vetting sessions
CREATE POLICY "Enable read access for all authenticated users"
ON vetting_sessions
FOR SELECT
TO authenticated
USING (true);

-- Allow authenticated users to insert vetting sessions
-- (This is needed when syncing recordings - creates session if none exists)
CREATE POLICY "Enable insert for authenticated users"
ON vetting_sessions
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Allow authenticated users to update vetting sessions
-- (This is needed to sync recording data to existing sessions)
CREATE POLICY "Enable update for authenticated users"
ON vetting_sessions
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Allow authenticated users to delete vetting sessions (if needed)
CREATE POLICY "Enable delete for authenticated users"
ON vetting_sessions
FOR DELETE
TO authenticated
USING (true);

-- Step 5: Verify policies were created
SELECT 
  policyname,
  cmd as command,
  roles
FROM pg_policies
WHERE schemaname = 'public' 
  AND tablename = 'vetting_sessions'
ORDER BY policyname;

SELECT '✅ RLS policies updated! All authenticated users can now read, insert, update, and delete vetting_sessions.' AS status;
