-- Check if user exists in auth.users
-- Run this in Supabase SQL Editor

-- Check 1: List all users in auth.users
SELECT 
  id,
  email,
  created_at,
  email_confirmed_at,
  last_sign_in_at
FROM auth.users
ORDER BY created_at DESC;

-- Check 2: Check specific user
SELECT 
  id,
  email,
  created_at,
  email_confirmed_at,
  last_sign_in_at,
  encrypted_password IS NOT NULL as has_password
FROM auth.users
WHERE email = 'superadmin@ucu.ac.ug';

-- Check 3: Check if profile exists
SELECT 
  id,
  username,
  email,
  name,
  base_role,
  roles,
  is_super_admin
FROM public.user_profiles
WHERE email = 'superadmin@ucu.ac.ug' OR id IN (
  SELECT id FROM auth.users WHERE email = 'superadmin@ucu.ac.ug'
);




