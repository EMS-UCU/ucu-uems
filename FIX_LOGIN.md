# 🔧 Fix Login Issue - Step by Step

## The Problem
Error: "Could not find the table 'public.users' in the schema cache"

**This means the database table doesn't exist yet.**

## ✅ Solution (5 Minutes)

### Step 1: Open Supabase
1. Go to: https://app.supabase.com
2. Login and select your project

### Step 2: Open SQL Editor
1. Click **"SQL Editor"** in the left sidebar (it has a database icon)
2. Click the **"New query"** button

### Step 3: Run the Simple SQL Script
1. Open the file `create_users_table_simple.sql` in your project
2. **Copy ALL the text** from that file
3. **Paste it** into the Supabase SQL Editor
4. Click the **"Run"** button (or press Ctrl+Enter / Cmd+Enter)

### Step 4: Check for Success
You should see:
- ✅ Green checkmark or "Success" message
- ✅ A result showing "Users table created! You can now login."

### Step 5: Verify Table Exists
1. Click **"Table Editor"** in the left sidebar
2. You should see a table called **"users"**
3. Click on it - you should see the super admin user

### Step 6: Check Your .env File
Make sure you have a `.env` file in your project root with:
```env
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Important:** 
- Get these values from Supabase Dashboard → Settings → API
- Restart your dev server after creating/updating `.env`

### Step 7: Try Login Again
1. Go to your app (localhost:5173)
2. Email: `superadmin@ucu.ac.ug`
3. Password: `admin123`
4. Click "NEXT"

## Still Not Working?

### Check Browser Console (F12)
Look for any error messages and share them.

### Verify Table in Supabase
1. Go to Table Editor
2. If you DON'T see the `users` table, the SQL didn't run successfully
3. Check the SQL Editor for error messages (red text)

### Common Issues:

**Issue:** "permission denied"
- **Fix:** Make sure you're the project owner or have admin access

**Issue:** "relation already exists"
- **Fix:** This is OK! The table exists. Try logging in.

**Issue:** "syntax error"
- **Fix:** Make sure you copied the ENTIRE SQL script, including all lines

**Issue:** Still can't login after creating table
- **Fix:** 
  1. Wait 10-20 seconds (Supabase needs to refresh)
  2. Hard refresh browser (Ctrl+Shift+R)
  3. Restart dev server
  4. Check `.env` file has correct values

## Need Help?
Share:
1. What you see in Supabase Table Editor (screenshot or description)
2. Any error messages from SQL Editor
3. Browser console errors (F12)

