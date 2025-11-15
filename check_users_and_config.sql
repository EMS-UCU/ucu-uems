-- Check if users exist and verify table structure
-- Run this in Supabase SQL Editor

-- Check 1: Count total users
SELECT 'Check 1: Total Users' AS check_name;
SELECT COUNT(*) as total_users FROM public.users;

-- Check 2: List all users (without passwords)
SELECT 'Check 2: All Users' AS check_name;
SELECT 
  id,
  username,
  email,
  name,
  base_role,
  roles,
  is_super_admin,
  CASE 
    WHEN password_hash IS NOT NULL AND password_hash != '' THEN 'Has password'
    ELSE 'No password set'
  END as password_status,
  created_at
FROM public.users
ORDER BY created_at DESC;

-- Check 3: Verify specific test user exists
SELECT 'Check 3: Test User Check' AS check_name;
SELECT 
  id,
  username,
  email,
  name,
  base_role,
  password_hash IS NOT NULL AND password_hash != '' as has_password,
  LENGTH(password_hash) as password_length
FROM public.users
WHERE email IN ('superadmin@ucu.ac.ug', 'marvin.zziwa@ucu.ac.ug')
ORDER BY email;

-- Check 4: Verify table permissions for anon role
SELECT 'Check 4: Permissions Check' AS check_name;
SELECT 
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' 
  AND table_name = 'users'
  AND grantee IN ('anon', 'authenticated', 'public');




