-- COMPLETE FIX: Authentication Setup
-- Run this ENTIRE script in Supabase SQL Editor

-- Step 1: Fix user profile (update to correct values)
UPDATE public.user_profiles
SET 
  name = 'Super Administrator',
  base_role = 'Admin',
  roles = ARRAY['Admin'],
  is_super_admin = TRUE
WHERE email = 'superadmin@ucu.ac.ug'
   OR id IN (SELECT id FROM auth.users WHERE email = 'superadmin@ucu.ac.ug');

-- Step 2: Verify profile is fixed
SELECT 'Step 2: Verify Profile' AS step;
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

-- Step 3: Check if email is confirmed (CRITICAL!)
SELECT 'Step 3: Check Email Confirmation (CRITICAL!)' AS step;
SELECT 
  email,
  email_confirmed_at,
  CASE 
    WHEN email_confirmed_at IS NULL THEN '❌ EMAIL NOT CONFIRMED - THIS IS THE PROBLEM!'
    ELSE '✅ Email confirmed'
  END as status,
  created_at
FROM auth.users
WHERE email = 'superadmin@ucu.ac.ug';

-- Step 4: If email is not confirmed, you need to confirm it manually
-- Go to: Authentication → Users → Click user → "Confirm email" button

SELECT '✅ Profile fixed! Check Step 3 - if email is NOT confirmed, confirm it in Dashboard.' AS final_status;


