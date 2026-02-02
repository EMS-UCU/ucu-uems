-- Enable read access for role_conscents storage bucket
-- Run this in Supabase SQL Editor
-- Prerequisite: Create bucket "role_conscents" in Supabase Dashboard → Storage

-- Allow authenticated users to read (view/download) consent documents from the bucket
CREATE POLICY "Allow authenticated read role_conscents"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'role_conscents');

SELECT '✅ Storage policy created. Authenticated users can now read from role_conscents bucket.' AS status;
