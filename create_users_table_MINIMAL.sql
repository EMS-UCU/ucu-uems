-- MINIMAL VERSION - Just create users table to fix login
-- Run this FIRST in Supabase SQL Editor if the full script fails

-- Make sure we're in the public schema
SET search_path TO public;

-- Create users table (minimal version)
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

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Create policy (allow all for now)
DROP POLICY IF EXISTS "Allow all operations" ON users;
CREATE POLICY "Allow all operations" ON users
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create update trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Insert super admin user
INSERT INTO users (username, email, name, base_role, roles, password_hash, is_super_admin)
VALUES 
  ('superadmin', 'superadmin@ucu.ac.ug', 'Super Administrator', 'Admin', ARRAY['Admin'], 'admin123', TRUE)
ON CONFLICT (username) DO UPDATE SET
  email = EXCLUDED.email,
  name = EXCLUDED.name,
  base_role = EXCLUDED.base_role,
  roles = EXCLUDED.roles,
  password_hash = EXCLUDED.password_hash,
  is_super_admin = EXCLUDED.is_super_admin;

-- Verify
SELECT 'Users table created! You can now login with:' AS message;
SELECT 'Email: superadmin@ucu.ac.ug' AS email;
SELECT 'Password: admin123' AS password;


