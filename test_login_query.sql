-- TEST: Simulate the exact login query your app uses
-- This tests what happens when the app tries to login

-- Test 1: Check if password is set for superadmin
SELECT 
  username,
  email,
  name,
  base_role,
  CASE 
    WHEN password_hash IS NOT NULL AND password_hash != '' THEN 'Password is set'
    ELSE 'NO PASSWORD SET!'
  END as password_status,
  LENGTH(password_hash) as password_length,
  password_hash as password_value
FROM public.users
WHERE email = 'superadmin@ucu.ac.ug';

-- Test 2: Test the exact query your app uses (SELECT * WHERE email = ...)
SELECT *
FROM public.users
WHERE email = 'superadmin@ucu.ac.ug'
LIMIT 1;

-- Test 3: Test with lowercase email (app converts to lowercase)
SELECT *
FROM public.users
WHERE email = LOWER('superadmin@ucu.ac.ug')
LIMIT 1;




