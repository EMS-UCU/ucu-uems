# Verify Supabase Configuration

## Step 1: Check if .env file exists
Look in your project root folder for a file named `.env`

If it doesn't exist, create it with:
```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

## Step 2: Get your Supabase credentials
1. Go to https://app.supabase.com
2. Select your project
3. Go to **Settings** → **API**
4. Copy:
   - **Project URL** → Use for `VITE_SUPABASE_URL`
   - **anon public** key → Use for `VITE_SUPABASE_ANON_KEY`

## Step 3: Verify in browser console
1. Open your app in browser
2. Press F12 → Console tab
3. Look for:
   - ✅ `Supabase configured` (good)
   - ❌ `Supabase credentials not found!` (bad - need .env file)

## Step 4: Check if users exist
Run `check_users_and_config.sql` in Supabase SQL Editor and check:
- **Check 1**: Should show total_users > 0
- **Check 2**: Should list all users
- **Check 3**: Should show your test user

If Check 1 shows 0 users, you need to create a user!




