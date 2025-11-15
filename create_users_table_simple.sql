-- SIMPLE VERSION - Create users table first
-- Run this in Supabase SQL Editor to fix login

-- Step 1: Create users table
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  name TEXT NOT NULL,
  base_role TEXT NOT NULL CHECK (base_role IN ('Admin', 'Lecturer')),
  roles TEXT[] DEFAULT ARRAY[]::TEXT[],
  password_hash TEXT NOT NULL,
  is_super_admin BOOLEAN DEFAULT FALSE,
  campus TEXT,
  department TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 2: Create indexes
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Step 3: Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Step 4: Create policy (allow all for now)
DROP POLICY IF EXISTS "Allow all operations" ON users;
CREATE POLICY "Allow all operations" ON users
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Step 5: Create function for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 6: Create trigger
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Step 7: Insert super admin user
INSERT INTO users (username, email, name, base_role, roles, password_hash, is_super_admin)
VALUES 
  ('superadmin', 'superadmin@ucu.ac.ug', 'Super Administrator', 'Admin', ARRAY['Admin'], 'admin123', TRUE)
ON CONFLICT (username) DO NOTHING;

-- Verify
SELECT 'Users table created! You can now login.' AS status;

