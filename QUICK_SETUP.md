# Quick Setup - Fix Login Issue

## The Problem
You're getting: "Could not find the table 'public.users' in the schema cache"

This means the database tables haven't been created yet in Supabase.

## Solution - Step by Step

### Step 1: Open Supabase Dashboard
1. Go to [https://app.supabase.com](https://app.supabase.com)
2. Select your project (or create one if you haven't)

### Step 2: Open SQL Editor
1. Click **"SQL Editor"** in the left sidebar
2. Click **"New query"** button

### Step 3: Run the SQL Script
1. Open the file `create_users_table.sql` in your project
2. **Copy the ENTIRE file** (all 263 lines)
3. **Paste it into the SQL Editor** in Supabase
4. Click **"Run"** button (or press Ctrl+Enter)
5. **Wait for it to complete** - you should see "Success" messages

### Step 4: Verify Tables Were Created
1. Click **"Table Editor"** in the left sidebar
2. You should see these tables:
   - ✅ `users`
   - ✅ `exam_papers`
   - ✅ `moderation_lists`
   - ✅ `vetting_sessions`
   - ✅ `vetting_assignments`
   - ✅ `vetting_comments`
   - ✅ `exam_versions`
   - ✅ `workflow_timeline`
   - ✅ `notifications`
   - ✅ `privilege_elevations`

### Step 5: Check for Errors
1. In SQL Editor, check the **"History"** tab
2. Look for any red error messages
3. If you see errors, share them and I'll help fix them

### Step 6: Verify Super Admin User
1. Go to **Table Editor** → **users** table
2. You should see a user with:
   - username: `superadmin`
   - email: `superadmin@ucu.ac.ug`
   - is_super_admin: `true`

### Step 7: Restart Your Dev Server
1. Stop your dev server (Ctrl+C)
2. Start it again: `npm run dev`
3. Try logging in again

## If It Still Doesn't Work

### Check Your .env File
Make sure you have:
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

### Verify Connection
1. Open browser console (F12)
2. Look for any Supabase connection errors
3. Check if the URL and key are being loaded

### Test the Connection
Run this in SQL Editor to test:
```sql
SELECT * FROM users LIMIT 1;
```

If this works, the table exists. If it fails, the table wasn't created.

## Common Issues

**Issue**: "relation 'users' does not exist"
- **Solution**: The SQL script didn't run successfully. Check for errors in SQL Editor history.

**Issue**: "permission denied"
- **Solution**: The RLS policies might be blocking. The script should have created policies, but if not, run:
```sql
CREATE POLICY "Allow all operations" ON users
  FOR ALL USING (true) WITH CHECK (true);
```

**Issue**: Still can't login after creating table
- **Solution**: 
  1. Hard refresh browser (Ctrl+Shift+R)
  2. Clear browser cache
  3. Check that your `.env` file has correct credentials
  4. Restart dev server

## Need Help?
Share:
1. Any error messages from SQL Editor
2. Screenshot of Table Editor showing what tables exist
3. Browser console errors (F12)


