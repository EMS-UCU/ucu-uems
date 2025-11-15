-- Verify Password Reset - Run this AFTER resetting password in Dashboard
-- This checks if password exists and user is ready to login

SELECT 
  u.id,
  u.email,
  u.email_confirmed_at IS NOT NULL as email_confirmed,
  u.encrypted_password IS NOT NULL as has_password,
  u.created_at,
  u.last_sign_in_at,
  p.username,
  p.base_role,
  p.is_super_admin,
  CASE 
    WHEN u.email_confirmed_at IS NULL THEN '❌ EMAIL NOT CONFIRMED'
    WHEN u.encrypted_password IS NULL THEN '❌ NO PASSWORD SET'
    WHEN p.id IS NULL THEN '❌ NO PROFILE'
    ELSE '✅ READY TO LOGIN'
  END as status
FROM auth.users u
LEFT JOIN public.user_profiles p ON u.id = p.id
WHERE u.email = 'superadmin@ucu.ac.ug';

-- Expected output:
-- email_confirmed: true
-- has_password: true
-- status: ✅ READY TO LOGIN


