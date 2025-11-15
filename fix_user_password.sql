-- Fix user password and verify data
-- Run this in Supabase SQL Editor

-- First, check current user data
SELECT 
  id,
  username,
  email,
  name,
  base_role,
  roles,
  password_hash,
  is_super_admin,
  LENGTH(password_hash) as password_length
FROM users
WHERE email = 'superadmin@ucu.ac.ug';

-- Update password to 'admin123' (plain text for now)
UPDATE users
SET password_hash = 'admin123'
WHERE email = 'superadmin@ucu.ac.ug';

-- Verify the update
SELECT 
  id,
  username,
  email,
  name,
  password_hash,
  is_super_admin
FROM users
WHERE email = 'superadmin@ucu.ac.ug';

-- Check RLS policies are active
SELECT 
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE tablename = 'users';





