-- Migration: Add metadata column to privilege_elevations table
-- Run this in Supabase SQL Editor if the metadata column doesn't exist

-- Add metadata column to store Chief Examiner assignment details
ALTER TABLE public.privilege_elevations 
ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Create index for faster queries on metadata
CREATE INDEX IF NOT EXISTS idx_privilege_elevations_metadata 
ON public.privilege_elevations 
USING GIN (metadata);

SELECT '✅ Migration complete! metadata field added to privilege_elevations.' AS status;

