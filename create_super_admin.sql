-- Create Super Admin Account
-- Run this in Supabase SQL Editor
--
-- IMPORTANT: First create the user in Supabase Dashboard → Authentication → Users
-- Then run this query to set them as Super Admin

-- ============================================
-- STEP 1: Create User in Supabase Dashboard
-- ============================================
-- 1. Go to Supabase Dashboard → Authentication → Users
-- 2. Click "Add user" → "Create new user"
-- 3. Enter:
--    - Email: ojoseph@ucu.ac.ug
--    - Password: (your desired password)
--    - ✅ Check "Auto Confirm User"
-- 4. Click "Create user"
-- 5. Copy the User ID (you'll need it, or use the email below)

-- ============================================
-- STEP 2: Update Profile to Super Admin
-- ============================================

-- Option A: Update by Email (Recommended)
-- Configured for: ojoseph@ucu.ac.ug
DO $$
DECLARE
  user_id UUID;
  user_email TEXT := 'ojoseph@ucu.ac.ug';
  user_username TEXT := 'JosephOKOLIMO';
  user_name TEXT := 'Joseph OKOLIMO';
BEGIN
  -- Get user ID from auth.users
  SELECT id INTO user_id
  FROM auth.users
  WHERE email = user_email;
  
  IF user_id IS NULL THEN
    RAISE EXCEPTION 'User with email % not found in auth.users. Please create the user in Supabase Dashboard → Authentication → Users first.', user_email;
  END IF;
  
  -- Insert or update profile as Super Admin
  INSERT INTO public.user_profiles (
    id,
    username,
    email,
    name,
    base_role,
    roles,
    is_super_admin
  )
  VALUES (
    user_id,
    user_username,
    user_email,
    user_name,
    'Admin',
    ARRAY['Admin'],
    TRUE
  )
  ON CONFLICT (id) 
  DO UPDATE SET
    username = EXCLUDED.username,
    email = EXCLUDED.email,
    name = EXCLUDED.name,
    base_role = 'Admin',
    roles = ARRAY['Admin'],
    is_super_admin = TRUE,
    updated_at = NOW();
  
  RAISE NOTICE '✅ Super Admin profile created/updated for % (ID: %)', user_email, user_id;
END $$;

-- ============================================
-- STEP 3: Verify Super Admin Account
-- ============================================
SELECT 
  u.id,
  u.email,
  u.email_confirmed_at IS NOT NULL as email_confirmed,
  p.username,
  p.name,
  p.base_role,
  p.roles,
  p.is_super_admin,
  CASE 
    WHEN p.is_super_admin = TRUE AND p.base_role = 'Admin' THEN '✅ SUPER ADMIN'
    WHEN p.base_role = 'Admin' THEN '⚠️ Admin (not super admin)'
    ELSE '❌ Not Admin'
  END as status
FROM auth.users u
LEFT JOIN public.user_profiles p ON u.id = p.id
WHERE u.email = 'ojoseph@ucu.ac.ug';

-- ============================================
-- ALTERNATIVE: Update by User ID
-- ============================================
-- If you know the User ID from auth.users, use this instead:
/*
DO $$
DECLARE
  user_id UUID := 'YOUR_USER_ID_HERE'; -- Replace with actual UUID
BEGIN
  UPDATE public.user_profiles
  SET
    base_role = 'Admin',
    roles = ARRAY['Admin'],
    is_super_admin = TRUE,
    updated_at = NOW()
  WHERE id = user_id;
  
  IF NOT FOUND THEN
    -- If profile doesn't exist, create it
    INSERT INTO public.user_profiles (
      id, username, email, name, base_role, roles, is_super_admin
    )
    SELECT 
      id,
      split_part(email, '@', 1) as username,
      email,
      COALESCE(raw_user_meta_data->>'name', email) as name,
      'Admin',
      ARRAY['Admin'],
      TRUE
    FROM auth.users
    WHERE id = user_id;
  END IF;
  
  RAISE NOTICE '✅ Super Admin profile updated for user ID: %', user_id;
END $$;
*/

-- ============================================
-- BONUS: Convert Existing Lecturer to Super Admin
-- ============================================
-- If you already have a user that's a Lecturer, convert them to Super Admin:
/*
UPDATE public.user_profiles
SET
  base_role = 'Admin',
  roles = ARRAY['Admin'],
  is_super_admin = TRUE,
  updated_at = NOW()
WHERE email = 'ojoseph@ucu.ac.ug';
*/

