-- Verify complete user setup
-- Run this in Supabase SQL Editor

-- Check 1: User exists in auth.users
SELECT 'Check 1: Auth User' AS check_name;
SELECT 
  id,
  email,
  email_confirmed_at IS NOT NULL as email_confirmed,
  created_at
FROM auth.users
WHERE email = 'superadmin@ucu.ac.ug';

-- Check 2: Profile exists
SELECT 'Check 2: User Profile' AS check_name;
SELECT 
  id,
  username,
  email,
  name,
  base_role,
  roles,
  is_super_admin
FROM public.user_profiles
WHERE email = 'superadmin@ucu.ac.ug' 
   OR id IN (SELECT id FROM auth.users WHERE email = 'superadmin@ucu.ac.ug');

-- Check 3: If profile doesn't exist, create it
SELECT 'Check 3: Creating Profile if Missing' AS check_name;
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

-- Check 4: Verify profile was created
SELECT 'Check 4: Final Verification' AS check_name;
SELECT 
  '✅ User setup complete!' AS status,
  p.id,
  p.email,
  p.name,
  p.base_role,
  p.is_super_admin
FROM public.user_profiles p
WHERE p.email = 'superadmin@ucu.ac.ug';




