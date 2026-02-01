-- Fix privilege_elevations elevated_by foreign key constraint
-- Run this in Supabase SQL Editor
--
-- The error "privilege_elevations_elevated_by_fkey" occurs when elevated_by
-- references auth.users or user_profiles but the elevating user's ID isn't
-- found (e.g. sync issues between auth schema and public schema).
--
-- This migration: drops the strict FK and makes elevated_by nullable.
-- The elevated_by column remains for audit trail; we just remove the FK
-- to avoid constraint violations. Values are still stored when valid.

-- Step 1: Drop the existing foreign key constraint (if it exists)
ALTER TABLE public.privilege_elevations 
DROP CONSTRAINT IF EXISTS privilege_elevations_elevated_by_fkey;

-- Step 2: Make elevated_by nullable so inserts succeed even when referent is missing
ALTER TABLE public.privilege_elevations 
ALTER COLUMN elevated_by DROP NOT NULL;

SELECT '✅ Migration complete! privilege_elevations.elevated_by FK removed. Inserts will succeed.' AS status;
