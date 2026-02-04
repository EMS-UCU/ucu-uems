-- Check RLS status and policies for exam_papers table
-- Run this in Supabase SQL Editor to diagnose RLS issues

-- 1. Check if RLS is enabled
SELECT 
  schemaname,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename = 'exam_papers';

-- 2. List all RLS policies on exam_papers
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd as command,
  qual as using_expression,
  with_check as with_check_expression
FROM pg_policies
WHERE schemaname = 'public' 
  AND tablename = 'exam_papers'
ORDER BY policyname;

-- 3. Check current papers and their statuses
SELECT 
  id,
  course_code,
  course_name,
  status,
  is_locked,
  printing_due_date,
  printing_due_time,
  created_at,
  updated_at
FROM exam_papers
ORDER BY created_at DESC
LIMIT 10;

-- 4. Count papers by status
SELECT 
  status,
  COUNT(*) as count,
  COUNT(*) FILTER (WHERE is_locked = true) as locked_count
FROM exam_papers
GROUP BY status
ORDER BY count DESC;

-- 5. Check for papers that should be approved but aren't
SELECT 
  id,
  course_code,
  course_name,
  status,
  is_locked,
  printing_due_date
FROM exam_papers
WHERE status LIKE '%approved%' 
   OR status LIKE '%print%'
   OR is_locked = true
ORDER BY created_at DESC;
