-- Verify the users table exists
-- Run this to check if the table was created

SELECT 
  table_name,
  table_schema
FROM information_schema.tables
WHERE table_schema = 'public' 
  AND table_name = 'users';

-- If the above returns a row, the table exists
-- If it returns nothing, the table doesn't exist



