-- Check Auth Settings and User Status
-- Run this in Supabase SQL Editor

-- Check 1: List all auth users and their confirmation status
SELECT 'Check 1: All Auth Users' AS check_name;
SELECT 
  id,
  email,
  email_confirmed_at IS NOT NULL as email_confirmed,
  created_at,
  last_sign_in_at,
  encrypted_password IS NOT NULL as has_password
FROM auth.users
ORDER BY created_at DESC;

-- Check 2: Check specific user details
SELECT 'Check 2: Test User Details' AS check_name;
SELECT 
  id,
  email,
  email_confirmed_at,
  created_at,
  last_sign_in_at,
  encrypted_password IS NOT NULL as has_password,
  CASE 
    WHEN email_confirmed_at IS NULL THEN '❌ Email NOT confirmed'
    ELSE '✅ Email confirmed'
  END as confirmation_status
FROM auth.users
WHERE email = 'superadmin@ucu.ac.ug';

-- Check 3: Verify user_profiles table exists and has data
SELECT 'Check 3: User Profiles' AS check_name;
SELECT 
  id,
  username,
  email,
  name,
  base_role,
  is_super_admin
FROM public.user_profiles
WHERE email = 'superadmin@ucu.ac.ug' 
   OR id IN (SELECT id FROM auth.users WHERE email = 'superadmin@ucu.ac.ug');


