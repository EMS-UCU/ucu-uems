-- Quick Test: Check Email Confirmation Status
-- Run this in Supabase SQL Editor

SELECT 
  email,
  email_confirmed_at,
  CASE 
    WHEN email_confirmed_at IS NULL THEN '❌ EMAIL NOT CONFIRMED - THIS BLOCKS LOGIN!'
    ELSE '✅ Email confirmed'
  END as status,
  created_at,
  last_sign_in_at
FROM auth.users
WHERE email = 'superadmin@ucu.ac.ug';

-- If email_confirmed_at is NULL, you MUST confirm it in Dashboard!


