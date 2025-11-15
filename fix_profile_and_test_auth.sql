-- Fix Profile and Test Authentication Setup
-- Run this in Supabase SQL Editor

-- Step 1: Fix the user profile (update to Admin and super admin)
UPDATE public.user_profiles
SET 
  name = 'Super Administrator',
  base_role = 'Admin',
  roles = ARRAY['Admin'],
  is_super_admin = TRUE
WHERE email = 'superadmin@ucu.ac.ug'
   OR id IN (SELECT id FROM auth.users WHERE email = 'superadmin@ucu.ac.ug');

-- Step 2: Verify the update
SELECT 'Step 2: Verify Profile Updated' AS step;
SELECT 
  id,
  username,
  email,
  name,
  base_role,
  roles,
  is_super_admin
FROM public.user_profiles
WHERE email = 'superadmin@ucu.ac.ug';

-- Step 3: Check auth user confirmation status
SELECT 'Step 3: Check Auth User Status' AS step;
SELECT 
  email,
  email_confirmed_at IS NOT NULL as email_confirmed,
  created_at,
  last_sign_in_at
FROM auth.users
WHERE email = 'superadmin@ucu.ac.ug';

-- Step 4: If email not confirmed, we need to confirm it manually
-- (This SQL can't confirm emails, but shows the status)

SELECT '✅ Profile updated! If email_confirmed is false, confirm it in Dashboard.' AS status;


