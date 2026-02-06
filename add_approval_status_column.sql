-- Migration: Add approval_status column to exam_papers table
-- Run this in Supabase SQL Editor
-- This separates approval status from workflow/vetting status

-- Step 1: Add approval_status column
ALTER TABLE exam_papers
ADD COLUMN IF NOT EXISTS approval_status TEXT;

-- Step 2: Migrate existing data (if any papers have status='approved_for_printing')
UPDATE exam_papers
SET approval_status = 'approved_for_printing'
WHERE status = 'approved_for_printing'
  AND approval_status IS NULL;

-- Step 3: Create index for efficient queries
CREATE INDEX IF NOT EXISTS idx_exam_papers_approval_status 
ON exam_papers(approval_status) 
WHERE approval_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_exam_papers_approval_locked 
ON exam_papers(approval_status, is_locked) 
WHERE approval_status = 'approved_for_printing';

-- Step 4: Update the password generation function to use approval_status
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
  WHERE ep.approval_status = 'approved_for_printing'
    AND ep.is_locked = TRUE
    AND ep.unlock_password_hash IS NULL
    AND ep.printing_due_date IS NOT NULL
    AND ep.printing_due_time IS NOT NULL
    AND combine_date_time(ep.printing_due_date, ep.printing_due_time) <= now_time;
END;
$$ LANGUAGE plpgsql;

-- Step 5: Update index for password generation query
DROP INDEX IF EXISTS idx_exam_papers_printing_due_date;
CREATE INDEX IF NOT EXISTS idx_exam_papers_printing_due_date 
ON exam_papers(printing_due_date, printing_due_time) 
WHERE approval_status = 'approved_for_printing' AND is_locked = TRUE AND unlock_password_hash IS NULL;

DROP INDEX IF EXISTS idx_exam_papers_approved_locked;
CREATE INDEX IF NOT EXISTS idx_exam_papers_approved_locked 
ON exam_papers(approval_status, is_locked) 
WHERE approval_status = 'approved_for_printing';

-- Step 6: Add comment for documentation
COMMENT ON COLUMN exam_papers.approval_status IS 'Approval status of the paper (e.g., approved_for_printing). Separate from workflow/vetting status.';

SELECT '✅ Migration complete! approval_status column added and existing data migrated.' AS status;
