-- Setup for using Supabase Auth (auth.users)
-- Run this in Supabase SQL Editor

-- Step 1: Create user_profiles table to store additional user data
-- This links to auth.users via user_id
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT, -- Store email for easier access
  name TEXT NOT NULL,
  base_role TEXT NOT NULL CHECK (base_role IN ('Admin', 'Lecturer')),
  roles TEXT[] DEFAULT ARRAY[]::TEXT[],
  is_super_admin BOOLEAN DEFAULT FALSE,
  campus TEXT,
  department TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 2: Create indexes
CREATE INDEX IF NOT EXISTS idx_user_profiles_username ON public.user_profiles(username);
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON public.user_profiles(id);

-- Step 3: Enable RLS
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Step 4: Create RLS policies
DROP POLICY IF EXISTS "Users can view their own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.user_profiles;
DROP POLICY IF EXISTS "Enable insert for all users" ON public.user_profiles;
DROP POLICY IF EXISTS "Enable update for all users" ON public.user_profiles;
DROP POLICY IF EXISTS "Enable delete for all users" ON public.user_profiles;

-- Allow all operations for now (adjust for production)
CREATE POLICY "Enable read access for all users"
ON public.user_profiles
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "Enable insert for all users"
ON public.user_profiles
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "Enable update for all users"
ON public.user_profiles
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Enable delete for all users"
ON public.user_profiles
FOR DELETE
TO anon, authenticated
USING (true);

-- Step 5: Grant permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON TABLE public.user_profiles TO anon, authenticated;

-- Step 6: Create function to automatically create profile when user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, username, email, name, base_role, roles)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'base_role', 'Lecturer'),
    COALESCE((NEW.raw_user_meta_data->>'roles')::text[], ARRAY[]::text[])
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 7: Create trigger to auto-create profile
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Step 8: Migrate existing user from public.users to auth.users (if needed)
-- First, create the user in auth.users via Supabase Dashboard → Authentication → Users
-- Then run this to create their profile:
-- INSERT INTO public.user_profiles (id, username, email, name, base_role, roles, is_super_admin)
-- SELECT id, username, email, name, base_role, roles, is_super_admin
-- FROM public.users
-- WHERE id NOT IN (SELECT id FROM public.user_profiles)
-- ON CONFLICT (id) DO NOTHING;

SELECT '✅ Setup complete! Now create users via Supabase Auth.' AS status;

