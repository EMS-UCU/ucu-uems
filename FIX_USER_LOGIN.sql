-- Fix User Login - Complete Setup
-- Run this ENTIRE script in Supabase SQL Editor

-- Step 1: Verify user exists in auth.users
SELECT 'Step 1: Checking auth user...' AS step;
SELECT 
  id,
  email,
  email_confirmed_at IS NOT NULL as is_confirmed,
  created_at
FROM auth.users
WHERE email = 'superadmin@ucu.ac.ug';

-- Step 2: Create or update user profile
SELECT 'Step 2: Creating/updating profile...' AS step;
INSERT INTO public.user_profiles (id, username, email, name, base_role, roles, is_super_admin)
SELECT 
  id,
  'superadmin',
  email,
  'Super Administrator',
  'Admin',
  ARRAY['Admin'],
  TRUE
FROM auth.users
WHERE email = 'superadmin@ucu.ac.ug'
ON CONFLICT (id) DO UPDATE
SET 
  username = EXCLUDED.username,
  email = EXCLUDED.email,
  name = EXCLUDED.name,
  base_role = EXCLUDED.base_role,
  roles = EXCLUDED.roles,
  is_super_admin = EXCLUDED.is_super_admin;

-- Step 3: Verify profile exists
SELECT 'Step 3: Verifying profile...' AS step;
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

-- Step 4: Final status
SELECT '✅ User setup complete!' AS status;
SELECT 'Now try logging in with the password you set when creating the user.' AS next_step;




