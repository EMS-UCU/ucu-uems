# Quick Start - Fix Login Issue

## The Problem
You're getting: "Could not find the table 'public.users' in the schema cache"

This means the database tables haven't been created yet in Supabase.

## Solution: Create the Tables

### Step 1: Open Supabase Dashboard
1. Go to [https://app.supabase.com](https://app.supabase.com)
2. Select your project
3. Click **"SQL Editor"** in the left sidebar

### Step 2: Run the SQL Script
1. Click **"New query"** button
2. Open the file `create_users_table.sql` from your project
3. **Copy the ENTIRE file** (all 263 lines)
4. **Paste it** into the SQL Editor
5. Click **"Run"** button (or press Ctrl+Enter)

### Step 3: Verify Tables Were Created
1. Click **"Table Editor"** in the left sidebar
2. You should see these tables:
   - ✅ `users`
   - ✅ `exam_papers`
   - ✅ `vetting_sessions`
   - ✅ `notifications`
   - ✅ And others...

### Step 4: Check for Errors
- If you see any red error messages, read them carefully
- Common issues:
  - Missing permissions
  - Syntax errors
  - Table already exists (this is OK, the script handles it)

### Step 5: Verify Super Admin User
After running the script, check if the super admin was created:
1. Go to **Table Editor** → **users** table
2. You should see a user with:
   - username: `superadmin`
   - email: `superadmin@ucu.ac.ug`
   - is_super_admin: `true`

### Step 6: Try Login Again
1. Go back to your app
2. Login with:
   - Email: `superadmin@ucu.ac.ug`
   - Password: `admin123`

## Still Having Issues?

### Check Your .env File
Make sure you have:
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

### Restart Dev Server
After creating tables, restart your dev server:
```bash
# Stop the server (Ctrl+C)
# Then restart:
npm run dev
```

### Check Browser Console
1. Press F12 to open browser console
2. Look for any error messages
3. Share the exact error if it persists

## Alternative: Create Table Manually

If SQL script doesn't work, create the users table manually:

1. Go to **Table Editor** → **New Table**
2. Name: `users`
3. Add these columns:
   - `id` - UUID, Primary Key, Default: `gen_random_uuid()`
   - `username` - Text, Unique, Not Null
   - `email` - Text, Unique
   - `name` - Text, Not Null
   - `base_role` - Text, Not Null
   - `roles` - Text Array
   - `password_hash` - Text, Not Null
   - `is_super_admin` - Boolean, Default: false
   - `campus` - Text
   - `department` - Text
   - `created_at` - Timestamp, Default: now()
   - `updated_at` - Timestamp, Default: now()
4. Save the table
5. Then insert the super admin user manually

