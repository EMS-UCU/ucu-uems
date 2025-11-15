-- Check what password is actually stored in Supabase Auth
-- Note: We can't see the actual password (it's encrypted), but we can check if one exists

SELECT 
  id,
  email,
  email_confirmed_at IS NOT NULL as email_confirmed,
  encrypted_password IS NOT NULL as has_password,
  -- Check if password was set recently
  updated_at,
  created_at,
  -- Check metadata for any password hints
  raw_user_meta_data,
  user_metadata
FROM auth.users
WHERE email = 'superadmin@ucu.ac.ug';

-- Also check if there are any triggers or functions that modify passwords
SELECT 
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE event_object_table = 'users'
  AND trigger_schema = 'auth';

-- Check for any password-related functions
SELECT 
  routine_name,
  routine_type,
  routine_definition
FROM information_schema.routines
WHERE routine_schema = 'auth'
  AND routine_name LIKE '%password%';


