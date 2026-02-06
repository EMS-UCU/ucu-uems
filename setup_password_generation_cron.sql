-- Setup Password Generation Cron Job
-- Run this in Supabase SQL Editor
-- This sets up automatic password generation for approved papers on their printing due date

-- Step 1: Enable pg_cron extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Step 2: Create a function that calls the Edge Function
-- Note: Replace YOUR_PROJECT_REF with your actual Supabase project reference
-- You can find this in Supabase Dashboard → Settings → API → Project URL (the part after https://)
CREATE OR REPLACE FUNCTION trigger_password_generation()
RETURNS void AS $$
DECLARE
  project_ref TEXT := 'YOUR_PROJECT_REF'; -- TODO: Replace with your project ref
  edge_function_url TEXT;
  response_status INT;
BEGIN
  -- Construct Edge Function URL
  edge_function_url := 'https://' || project_ref || '.supabase.co/functions/v1/generate-printing-passwords';
  
  -- Call the Edge Function via HTTP
  -- Note: This requires the http extension and proper configuration
  -- Alternative: Use Supabase Dashboard → Database → Cron Jobs instead
  
  RAISE NOTICE 'Password generation should be triggered via Supabase Cron Jobs or pg_cron';
END;
$$ LANGUAGE plpgsql;

-- Step 3: Schedule cron job (runs daily at midnight UTC)
-- Note: pg_cron requires superuser access. If you don't have it, use Supabase Dashboard instead.
-- SELECT cron.schedule(
--   'generate-printing-passwords-daily',
--   '0 0 * * *', -- Daily at midnight UTC
--   $$SELECT trigger_password_generation()$$
-- );

-- Alternative: Use Supabase Dashboard → Database → Cron Jobs
-- 1. Go to Supabase Dashboard → Database → Cron Jobs
-- 2. Click "Create a new cron job"
-- 3. Name: "Generate Printing Passwords"
-- 4. Schedule: 0 0 * * * (daily at midnight UTC)
-- 5. SQL Command:
--    SELECT net.http_post(
--      url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/generate-printing-passwords',
--      headers := jsonb_build_object(
--        'Content-Type', 'application/json',
--        'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
--      )
--    ) AS request_id;

-- Step 4: Manual trigger function for testing
CREATE OR REPLACE FUNCTION manually_generate_passwords()
RETURNS TABLE(
  paper_id UUID,
  course_code TEXT,
  course_name TEXT,
  password_generated BOOLEAN,
  error_message TEXT
) AS $$
DECLARE
  paper_record RECORD;
  generated_password TEXT;
  password_hash TEXT;
  salt TEXT;
BEGIN
  -- Get papers that need password generation
  FOR paper_record IN 
    SELECT * FROM check_and_generate_passwords()
  LOOP
    BEGIN
      -- Generate password (16 characters)
      generated_password := '';
      FOR i IN 1..16 LOOP
        generated_password := generated_password || chr(65 + floor(random() * 26)::int);
      END LOOP;
      
      -- Simple hash (for production, use bcrypt)
      salt := gen_random_uuid()::text;
      password_hash := encode(digest(salt || generated_password, 'sha256'), 'hex');
      password_hash := salt || ':' || password_hash;
      
      -- Update paper
      UPDATE exam_papers
      SET 
        unlock_password_hash = password_hash,
        password_generated_at = NOW()
      WHERE id = paper_record.exam_paper_id;
      
      -- Log to paper_unlock_logs
      INSERT INTO paper_unlock_logs (exam_paper_id, password_hash, generated_by)
      VALUES (paper_record.exam_paper_id, password_hash, 'manual_trigger');
      
      -- Notify Super Admins
      INSERT INTO notifications (user_id, title, message, type, related_exam_paper_id)
      SELECT 
        id,
        'Paper Unlock Password Generated',
        'Password generated for ' || paper_record.course_code || ' - ' || paper_record.course_name || 
        '. Printing due: ' || paper_record.printing_due_timestamp::text || 
        '. Password: ' || generated_password,
        'info',
        paper_record.exam_paper_id
      FROM user_profiles
      WHERE is_super_admin = true;
      
      RETURN QUERY SELECT 
        paper_record.exam_paper_id,
        paper_record.course_code,
        paper_record.course_name,
        true,
        NULL::TEXT;
        
    EXCEPTION WHEN OTHERS THEN
      RETURN QUERY SELECT 
        paper_record.exam_paper_id,
        paper_record.course_code,
        paper_record.course_name,
        false,
        SQLERRM;
    END;
  END LOOP;
  
  -- If no papers need passwords, return empty
  IF NOT FOUND THEN
    RETURN;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Step 5: Instructions
SELECT '✅ Functions created! 
  
To manually generate passwords for due papers, run:
  SELECT * FROM manually_generate_passwords();

To set up automatic daily generation:
  1. Go to Supabase Dashboard → Database → Cron Jobs
  2. Create new cron job
  3. Schedule: 0 0 * * * (daily at midnight UTC)
  4. SQL: SELECT manually_generate_passwords();
  
Or use the Edge Function via HTTP POST to:
  https://YOUR_PROJECT_REF.supabase.co/functions/v1/generate-printing-passwords
' AS instructions;
