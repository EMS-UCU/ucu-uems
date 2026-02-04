-- Fix RLS policies for exam_papers table
-- Run this in Supabase SQL Editor if RLS is blocking updates

-- Step 1: Check current RLS status
SELECT 
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename = 'exam_papers';

-- Step 2: Enable RLS if not already enabled
ALTER TABLE exam_papers ENABLE ROW LEVEL SECURITY;

-- Step 3: Drop existing policies (if any) to start fresh
DROP POLICY IF EXISTS "Enable read access for all authenticated users" ON exam_papers;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON exam_papers;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON exam_papers;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON exam_papers;
DROP POLICY IF EXISTS "Users can view their own papers" ON exam_papers;
DROP POLICY IF EXISTS "Users can update their own papers" ON exam_papers;
DROP POLICY IF EXISTS "Chief Examiners can update papers" ON exam_papers;
DROP POLICY IF EXISTS "Super Admins can view all papers" ON exam_papers;

-- Step 4: Create comprehensive RLS policies

-- Allow all authenticated users to read exam papers
CREATE POLICY "Enable read access for all authenticated users"
ON exam_papers
FOR SELECT
TO authenticated
USING (true);

-- Allow authenticated users to insert exam papers
CREATE POLICY "Enable insert for authenticated users"
ON exam_papers
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Allow authenticated users to update exam papers
-- (This is needed for Chief Examiners to approve papers)
CREATE POLICY "Enable update for authenticated users"
ON exam_papers
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Allow authenticated users to delete exam papers (if needed)
CREATE POLICY "Enable delete for authenticated users"
ON exam_papers
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
  AND tablename = 'exam_papers'
ORDER BY policyname;

SELECT '✅ RLS policies updated! All authenticated users can now read, insert, update, and delete exam papers.' AS status;
