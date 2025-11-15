-- Migration: Add lecturer_category field to user_profiles table
-- Run this in Supabase SQL Editor

-- Add lecturer_category column to user_profiles table
-- Only applicable for lecturers (base_role = 'Lecturer')
ALTER TABLE public.user_profiles 
ADD COLUMN IF NOT EXISTS lecturer_category TEXT CHECK (
  lecturer_category IS NULL 
  OR lecturer_category IN ('Undergraduate', 'Postgraduate')
  OR base_role != 'Lecturer'
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_user_profiles_lecturer_category 
ON public.user_profiles(lecturer_category) 
WHERE base_role = 'Lecturer';

-- Update the handle_new_user function to include lecturer_category
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, username, email, name, base_role, roles, lecturer_category)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'base_role', 'Lecturer'),
    COALESCE((NEW.raw_user_meta_data->>'roles')::text[], ARRAY[]::text[]),
    CASE 
      WHEN COALESCE(NEW.raw_user_meta_data->>'base_role', 'Lecturer') = 'Lecturer' 
      THEN COALESCE(NEW.raw_user_meta_data->>'lecturer_category', NULL)
      ELSE NULL
    END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

SELECT '✅ Migration complete! lecturer_category field added to user_profiles.' AS status;


