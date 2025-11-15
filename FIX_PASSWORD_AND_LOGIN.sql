-- Complete Fix: Reset Password and Verify User Setup
-- Run this in Supabase SQL Editor

-- Step 1: Check current user status
SELECT 
  id,
  email,
  email_confirmed_at IS NOT NULL as email_confirmed,
  encrypted_password IS NOT NULL as has_password,
  created_at,
  last_sign_in_at,
  raw_user_meta_data
FROM auth.users
WHERE email = 'superadmin@ucu.ac.ug';

-- Step 2: Check profile
SELECT * FROM public.user_profiles
WHERE email = 'superadmin@ucu.ac.ug';

-- Step 3: If password needs reset, you MUST do it in Dashboard:
-- Go to Authentication → Users → Click user → Update password → Set to: admin123

-- Step 4: Verify profile is correct (run this after password reset)
DO $$
DECLARE
  user_id UUID;
BEGIN
  -- Get user ID
  SELECT id INTO user_id
  FROM auth.users
  WHERE email = 'superadmin@ucu.ac.ug';
  
  IF user_id IS NULL THEN
    RAISE EXCEPTION 'User not found in auth.users';
  END IF;
  
  -- Upsert profile
  INSERT INTO public.user_profiles (id, username, email, name, base_role, roles, is_super_admin)
  VALUES (
    user_id,
    'superadmin',
    'superadmin@ucu.ac.ug',
    'Super Administrator',
    'Admin',
    ARRAY['Admin'],
    TRUE
  )
  ON CONFLICT (id) 
  DO UPDATE SET
    username = EXCLUDED.username,
    email = EXCLUDED.email,
    name = EXCLUDED.name,
    base_role = EXCLUDED.base_role,
    roles = EXCLUDED.roles,
    is_super_admin = EXCLUDED.is_super_admin,
    updated_at = NOW();
  
  RAISE NOTICE 'Profile updated for superadmin@ucu.ac.ug';
END $$;

-- Step 5: Final verification
SELECT 
  u.email,
  u.email_confirmed_at IS NOT NULL as email_confirmed,
  u.encrypted_password IS NOT NULL as has_password,
  p.base_role,
  p.is_super_admin,
  p.username
FROM auth.users u
LEFT JOIN public.user_profiles p ON u.id = p.id
WHERE u.email = 'superadmin@ucu.ac.ug';


