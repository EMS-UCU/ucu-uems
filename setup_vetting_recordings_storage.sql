-- Enable upload and read access for vetting_recordings storage bucket
-- Run this in Supabase SQL Editor
-- Prerequisite: Create bucket "vetting_recordings" in Supabase Dashboard → Storage

-- Drop existing policies if re-running
DROP POLICY IF EXISTS "Allow authenticated upload vetting_recordings" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated read vetting_recordings" ON storage.objects;

-- Allow authenticated users to upload recordings
CREATE POLICY "Allow authenticated upload vetting_recordings"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'vetting_recordings');

-- Allow authenticated users to read (view/download) recordings
CREATE POLICY "Allow authenticated read vetting_recordings"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'vetting_recordings');

SELECT '✅ Storage policies created. Authenticated users can upload and read from vetting_recordings bucket.' AS status;
