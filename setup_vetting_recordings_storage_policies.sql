-- Storage Policies for vetting_recordings bucket
-- Run this in Supabase SQL Editor AFTER creating the bucket
-- Bucket name should be: vetting_recordings (with underscore)

-- Step 1: Drop existing policies (if any)
DROP POLICY IF EXISTS "Allow authenticated upload vetting_recordings" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated read vetting_recordings" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated delete vetting_recordings" ON storage.objects;
DROP POLICY IF EXISTS "Allow vetting recording uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow Chief Examiner to view recordings" ON storage.objects;

-- Step 2: Create INSERT policy (allow authenticated users to upload recordings)
CREATE POLICY "Allow authenticated upload vetting_recordings"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'vetting_recordings'
);

-- Step 3: Create SELECT policy (allow authenticated users to read recordings)
CREATE POLICY "Allow authenticated read vetting_recordings"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'vetting_recordings'
);

-- Step 4: Create DELETE policy (allow authenticated users to delete recordings if needed)
CREATE POLICY "Allow authenticated delete vetting_recordings"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'vetting_recordings'
);

-- Step 5: Verify policies were created
SELECT 
  policyname,
  cmd as command,
  roles
FROM pg_policies
WHERE schemaname = 'storage' 
  AND tablename = 'objects'
  AND policyname LIKE '%vetting_recordings%'
ORDER BY policyname;

SELECT '✅ Storage policies created! Authenticated users can now upload, read, and delete recordings from vetting_recordings bucket.' AS status;
