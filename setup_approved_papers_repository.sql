-- Migration: Approved Papers Repository & Password Unlock System
-- Run this in Supabase SQL Editor

-- Step 1: Add columns to exam_papers table for printing date and lock mechanism
ALTER TABLE exam_papers
ADD COLUMN IF NOT EXISTS printing_due_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS printing_due_time TIME, -- Time component (e.g., '09:00:00')
ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS unlock_password_hash TEXT,
ADD COLUMN IF NOT EXISTS password_generated_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS unlocked_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS unlocked_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS unlock_expires_at TIMESTAMP WITH TIME ZONE; -- For temporary unlock

-- Step 2: Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_exam_papers_printing_due_date 
ON exam_papers(printing_due_date, printing_due_time) 
WHERE status = 'approved_for_printing' AND is_locked = TRUE AND unlock_password_hash IS NULL;

CREATE INDEX IF NOT EXISTS idx_exam_papers_approved_locked 
ON exam_papers(status, is_locked) 
WHERE status = 'approved_for_printing';

CREATE INDEX IF NOT EXISTS idx_exam_papers_unlock_expires 
ON exam_papers(unlock_expires_at) 
WHERE is_locked = FALSE AND unlock_expires_at IS NOT NULL;

-- Step 3: Create password generation log table for audit trail
CREATE TABLE IF NOT EXISTS paper_unlock_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_paper_id UUID REFERENCES exam_papers(id) ON DELETE CASCADE,
  password_generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  password_hash TEXT NOT NULL,
  generated_by TEXT DEFAULT 'system', -- 'system' for auto-generated, user_id for manual
  unlocked_at TIMESTAMP WITH TIME ZONE,
  unlocked_by UUID REFERENCES auth.users(id),
  unlock_expires_at TIMESTAMP WITH TIME ZONE,
  re_locked_at TIMESTAMP WITH TIME ZONE,
  re_locked_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_unlock_logs_exam_paper 
ON paper_unlock_logs(exam_paper_id);

CREATE INDEX IF NOT EXISTS idx_unlock_logs_unlocked_by 
ON paper_unlock_logs(unlocked_by);

-- Step 4: Create function to combine date and time into timestamp
CREATE OR REPLACE FUNCTION combine_date_time(
  date_part TIMESTAMP WITH TIME ZONE,
  time_part TIME
) RETURNS TIMESTAMP WITH TIME ZONE AS $$
BEGIN
  RETURN (date_part::date + time_part)::TIMESTAMP WITH TIME ZONE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Step 5: Create function to check and generate passwords for due papers
-- This will be called by the scheduled job
CREATE OR REPLACE FUNCTION check_and_generate_passwords()
RETURNS TABLE(
  exam_paper_id UUID,
  course_code TEXT,
  course_name TEXT,
  printing_due_timestamp TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
  now_time TIMESTAMP WITH TIME ZONE;
BEGIN
  now_time := NOW();
  
  RETURN QUERY
  SELECT 
    ep.id,
    ep.course_code,
    ep.course_name,
    combine_date_time(ep.printing_due_date, ep.printing_due_time) as printing_due_timestamp
  FROM exam_papers ep
  WHERE ep.status = 'approved_for_printing'
    AND ep.is_locked = TRUE
    AND ep.unlock_password_hash IS NULL
    AND ep.printing_due_date IS NOT NULL
    AND ep.printing_due_time IS NOT NULL
    AND combine_date_time(ep.printing_due_date, ep.printing_due_time) <= now_time;
END;
$$ LANGUAGE plpgsql;

-- Step 6: Create function to re-lock expired temporary unlocks
CREATE OR REPLACE FUNCTION re_lock_expired_papers()
RETURNS INTEGER AS $$
DECLARE
  locked_count INTEGER;
BEGIN
  UPDATE exam_papers
  SET 
    is_locked = TRUE,
    unlock_expires_at = NULL,
    unlocked_at = NULL,
    unlocked_by = NULL
  WHERE is_locked = FALSE
    AND unlock_expires_at IS NOT NULL
    AND unlock_expires_at <= NOW();
  
  GET DIAGNOSTICS locked_count = ROW_COUNT;
  RETURN locked_count;
END;
$$ LANGUAGE plpgsql;

-- Step 7: Add comments for documentation
COMMENT ON COLUMN exam_papers.printing_due_date IS 'Date when paper is due for printing (set by Chief Examiner)';
COMMENT ON COLUMN exam_papers.printing_due_time IS 'Time of day when password should be generated (set by Chief Examiner)';
COMMENT ON COLUMN exam_papers.is_locked IS 'Whether the paper is currently locked in the repository';
COMMENT ON COLUMN exam_papers.unlock_password_hash IS 'Hashed password for unlocking the paper (generated on printing due date)';
COMMENT ON COLUMN exam_papers.password_generated_at IS 'Timestamp when password was generated';
COMMENT ON COLUMN exam_papers.unlocked_at IS 'Timestamp when paper was unlocked';
COMMENT ON COLUMN exam_papers.unlocked_by IS 'User ID who unlocked the paper';
COMMENT ON COLUMN exam_papers.unlock_expires_at IS 'Timestamp when temporary unlock expires (for re-locking)';

SELECT '✅ Migration complete! Approved Papers Repository schema created.' AS status;
