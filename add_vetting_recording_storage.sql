-- Migration: Add video recording storage for vetting sessions
-- Run this in Supabase SQL Editor

-- Step 1: Add recording_url column to vetting_sessions table
ALTER TABLE public.vetting_sessions 
ADD COLUMN IF NOT EXISTS recording_url TEXT,
ADD COLUMN IF NOT EXISTS recording_file_path TEXT,
ADD COLUMN IF NOT EXISTS recording_file_size BIGINT,
ADD COLUMN IF NOT EXISTS recording_duration_seconds INTEGER,
ADD COLUMN IF NOT EXISTS recording_started_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS recording_completed_at TIMESTAMP WITH TIME ZONE;

-- Step 2: Create index for faster queries by recording status
CREATE INDEX IF NOT EXISTS idx_vetting_sessions_recording_url 
ON public.vetting_sessions(recording_url) 
WHERE recording_url IS NOT NULL;

-- Step 3: Add comment for documentation
COMMENT ON COLUMN public.vetting_sessions.recording_url IS 'URL to the video recording stored in Supabase Storage for audit purposes';
COMMENT ON COLUMN public.vetting_sessions.recording_file_path IS 'Storage path to the video recording file';
COMMENT ON COLUMN public.vetting_sessions.recording_file_size IS 'Size of the recording file in bytes';
COMMENT ON COLUMN public.vetting_sessions.recording_duration_seconds IS 'Duration of the recording in seconds';
COMMENT ON COLUMN public.vetting_sessions.recording_started_at IS 'Timestamp when recording started';
COMMENT ON COLUMN public.vetting_sessions.recording_completed_at IS 'Timestamp when recording completed';

-- Step 4: Create a storage bucket for vetting recordings (if not exists)
-- Note: This requires running in Supabase Dashboard → Storage → Create bucket
-- Bucket name: 'vetting-recordings'
-- Public: false (private bucket for audit purposes)
-- File size limit: 500MB (adjust as needed)

-- Step 5: Create RLS policies for storage bucket (run after creating bucket in Dashboard)
-- These policies ensure only authenticated users with Chief Examiner role can access recordings
-- The policies will be created via Supabase Dashboard → Storage → Policies

SELECT '✅ Migration complete! Video recording storage fields added to vetting_sessions table.' AS status;
SELECT '⚠️  IMPORTANT: Please create the storage bucket "vetting-recordings" in Supabase Dashboard → Storage' AS reminder;

