# Supabase Setup Guide

This guide will help you set up Supabase for the UCU E-Exam Manager application.

## Step 1: Create a Supabase Project

1. Go to [https://supabase.com](https://supabase.com)
2. Sign up or log in to your account
3. Click "New Project"
4. Fill in your project details:
   - Name: `ucu-e-exam-manager` (or your preferred name)
   - Database Password: Choose a strong password (save this!)
   - Region: Choose the closest region to you
5. Click "Create new project"

## Step 2: Get Your Supabase Credentials

1. In your Supabase project dashboard, go to **Settings** → **API**
2. Copy the following:
   - **Project URL** (under "Project URL")
   - **anon/public key** (under "Project API keys")

## Step 3: Create Environment Variables

1. Create a `.env` file in the root of your project (if it doesn't exist)
2. Add the following:

```env
VITE_SUPABASE_URL=your_project_url_here
VITE_SUPABASE_ANON_KEY=your_anon_key_here
```

Replace `your_project_url_here` and `your_anon_key_here` with the values you copied from Step 2.

## Step 4: Create the Database Table

1. In your Supabase dashboard, go to **SQL Editor**
2. Click "New query"
3. Paste the following SQL and run it:

```sql
-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  name TEXT NOT NULL,
  base_role TEXT NOT NULL CHECK (base_role IN ('Admin', 'Lecturer')),
  roles TEXT[] DEFAULT ARRAY[]::TEXT[],
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Enable Row Level Security (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all operations (adjust based on your security needs)
-- For production, you should create more restrictive policies
-- First, drop any existing policy with this name
DROP POLICY IF EXISTS "Allow all operations" ON users;
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON users;

-- Create a new policy that allows all operations
CREATE POLICY "Allow all operations" ON users
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create a function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

## Step 5: Delete Test Users (if any exist)

If you've inserted test users, delete them first:

```sql
-- Delete any existing test users
DELETE FROM users WHERE username IN ('admin', 'lecturer1');
```

## Step 6: Insert Users with Email

Users will login using their email and password. Insert users like this:

```sql
-- Insert users with email addresses
-- Replace email addresses and passwords with actual values
INSERT INTO users (username, email, name, base_role, roles, password_hash)
VALUES 
  ('marvin.zziwa', 'marvin.zziwa@ucu.ac.ug', 'Mr. Marvin Zziwa', 'Admin', ARRAY['Admin'], 'your_password_here'),
  ('achieng.odhiambo', 'achieng.odhiambo@ucu.ac.ug', 'Dr. Achieng Odhiambo', 'Lecturer', ARRAY['Lecturer'], 'user123');

-- You can add more users as needed
-- Note: username is still required but users will login with email
```

**Important Security Note:** The current implementation stores passwords as plain text. For production, you should:
1. Use Supabase Auth for proper password hashing
2. Or implement bcrypt hashing in a database function
3. Or use a backend service to handle authentication

## Step 7: Test the Connection

1. Restart your development server:
   ```bash
   npm run dev
   ```
2. Try logging in with the credentials you created
3. Check the browser console for any errors

## Troubleshooting

### Error: "Database error. Please try again."
This is a generic error. Check the browser console (F12) for more details. Common causes:

1. **Supabase credentials not found**
   - Make sure your `.env` file is in the root directory
   - Make sure the variable names start with `VITE_`
   - Restart your dev server after creating/updating `.env`
   - Check that values don't have extra spaces or quotes

2. **Database table not found**
   - Make sure you ran the SQL script to create the table
   - Check that you're connected to the correct Supabase project
   - Go to Supabase Dashboard → Table Editor and verify the `users` table exists

3. **Row Level Security (RLS) blocking queries**
   - The table has RLS enabled by default
   - You need to create a policy to allow SELECT operations
   - Run this SQL to allow all operations (for development):
   ```sql
   -- Allow all operations for now (adjust for production)
   DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON users;
   CREATE POLICY "Allow all operations" ON users
     FOR ALL
     USING (true)
     WITH CHECK (true);
   ```

4. **Invalid credentials**
   - Verify the email and password in your database
   - Check that the password_hash matches what you're entering
   - For now, passwords are stored as plain text, so enter exactly what you inserted
   - Make sure email is stored in lowercase in the database

5. **Connection issues**
   - Check your internet connection
   - Verify your Supabase project is active
   - Check Supabase dashboard for any service issues

## Next Steps

1. **Implement proper password hashing** - Use bcrypt or Supabase Auth
2. **Add email verification** - Use Supabase Auth features
3. **Implement session management** - Use Supabase Auth sessions
4. **Add more security policies** - Restrict RLS policies based on user roles
5. **Add user management UI** - Allow admins to create/manage users through the interface

