-- Create a test user for login
-- Run this in Supabase SQL Editor

-- Option 1: Create superadmin user
INSERT INTO users (username, email, name, base_role, roles, password_hash, is_super_admin)
VALUES 
  ('superadmin', 'superadmin@ucu.ac.ug', 'Super Administrator', 'Admin', ARRAY['Admin'], 'admin123', TRUE)
ON CONFLICT (email) DO UPDATE
SET password_hash = 'admin123';

-- Option 2: Create marvin.zziwa user (if that's the email you're trying to use)
INSERT INTO users (username, email, name, base_role, roles, password_hash, is_super_admin)
VALUES 
  ('marvin.zziwa', 'marvin.zziwa@ucu.ac.ug', 'Marvin Zziwa', 'Lecturer', ARRAY['Lecturer'], 'user123', FALSE)
ON CONFLICT (email) DO UPDATE
SET password_hash = 'user123';

-- Verify the users were created
SELECT 
  id,
  username,
  email,
  name,
  base_role,
  CASE 
    WHEN password_hash IS NOT NULL AND password_hash != '' THEN 'Has password'
    ELSE 'No password'
  END as password_status
FROM users
WHERE email IN ('superadmin@ucu.ac.ug', 'marvin.zziwa@ucu.ac.ug');




