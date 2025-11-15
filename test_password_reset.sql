-- Test: Check if we can see password status
-- Note: We can't see the actual password, but we can check if it exists

SELECT 
  email,
  email_confirmed_at IS NOT NULL as email_confirmed,
  encrypted_password IS NOT NULL as has_password,
  created_at,
  last_sign_in_at
FROM auth.users
WHERE email = 'superadmin@ucu.ac.ug';

-- If has_password is false, the password wasn't set!
-- If last_sign_in_at is NULL, the user has never successfully logged in


