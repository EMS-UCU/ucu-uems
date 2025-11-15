-- SIMPLE CHECK: Do users exist?
-- Run this in Supabase SQL Editor

-- Count users
SELECT COUNT(*) as total_users FROM public.users;

-- Show all users
SELECT 
  id,
  username,
  email,
  name,
  base_role,
  is_super_admin,
  created_at
FROM public.users
ORDER BY created_at DESC;




