-- Quick test to verify database connection and tables
-- Run this in Supabase SQL Editor

-- Test 1: Check if users table exists
SELECT 
  CASE 
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users')
    THEN '✅ users table EXISTS'
    ELSE '❌ users table DOES NOT EXIST'
  END AS table_status;

-- Test 2: Count users
SELECT 
  CASE 
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users')
    THEN (SELECT COUNT(*)::text || ' user(s) found' FROM users)
    ELSE 'Table does not exist'
  END AS user_count;

-- Test 3: List all tables
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- Test 4: Check super admin user
SELECT 
  CASE 
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users')
    THEN (
      SELECT 
        CASE 
          WHEN COUNT(*) > 0 THEN '✅ Super admin user EXISTS'
          ELSE '❌ No super admin user found'
        END
      FROM users 
      WHERE is_super_admin = true
    )
    ELSE 'Table does not exist'
  END AS super_admin_status;


