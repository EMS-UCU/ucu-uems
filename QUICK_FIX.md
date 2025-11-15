# Quick Fix: Create Database Tables

## The Error
"Could not find the table 'public.users' in the schema cache"

This means the database tables haven't been created yet in Supabase.

## Solution: Run the SQL Script

### Step 1: Open Supabase Dashboard
1. Go to [https://app.supabase.com](https://app.supabase.com)
2. Select your project

### Step 2: Open SQL Editor
1. Click **"SQL Editor"** in the left sidebar
2. Click **"New query"** button

### Step 3: Copy and Run the SQL
1. Open the file `create_users_table.sql` in your project
2. **Copy the ENTIRE contents** (all 263 lines)
3. Paste it into the SQL Editor
4. Click **"Run"** button (or press Ctrl+Enter)

### Step 4: Verify Tables Were Created
1. Go to **"Table Editor"** in the left sidebar
2. You should see these tables:
   - `users`
   - `exam_papers`
   - `moderation_lists`
   - `vetting_sessions`
   - `vetting_assignments`
   - `vetting_comments`
   - `exam_versions`
   - `workflow_timeline`
   - `notifications`
   - `privilege_elevations`

### Step 5: Verify Super Admin User
1. In Table Editor, click on `users` table
2. You should see a user with:
   - username: `superadmin`
   - email: `superadmin@ucu.ac.ug`
   - password_hash: `admin123`

### Step 6: Try Logging In Again
1. Go back to your app
2. Use these credentials:
   - Email: `superadmin@ucu.ac.ug`
   - Password: `admin123`

## If You Still Get Errors

### Check Your .env File
Make sure you have:
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

### Restart Your Dev Server
After creating tables:
1. Stop your dev server (Ctrl+C)
2. Run `npm run dev` again

### Check Browser Console
1. Press F12
2. Look for any error messages
3. Share the exact error if it persists





