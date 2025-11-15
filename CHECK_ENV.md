# Check Your Environment Variables

## The Problem
The error "Could not find the table 'public.users' in the schema cache" can happen if:
1. Your `.env` file is missing or has wrong values
2. Your dev server wasn't restarted after creating `.env`
3. The Supabase URL or key are incorrect

## Step 1: Create/Check Your .env File

1. In your project root (same folder as `package.json`), create a file named `.env`
2. Add these two lines (replace with YOUR actual values):

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

## Step 2: Get Your Supabase Credentials

1. Go to [https://app.supabase.com](https://app.supabase.com)
2. Select your project **"ucu-uems"**
3. Click **Settings** (gear icon) in the left sidebar
4. Click **API** in the settings menu
5. Copy these values:
   - **Project URL** → Use for `VITE_SUPABASE_URL`
   - **anon public** key → Use for `VITE_SUPABASE_ANON_KEY`

## Step 3: Update Your .env File

Your `.env` file should look like this (with YOUR actual values):

```env
VITE_SUPABASE_URL=https://ntleujqnruwjkcmzifuy.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bGV1anFucnV3amtjbXppZnV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTY5MjE2MDAsImV4cCI6MjAzMjQ5NzYwMH0.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Important Notes:**
- The URL should start with `https://` and end with `.supabase.co`
- The anon key is a long JWT token (usually 200+ characters)
- No quotes around the values
- No spaces around the `=` sign

## Step 4: Restart Your Dev Server

**CRITICAL:** After creating or updating `.env`, you MUST restart your dev server:

1. Stop the server: Press `Ctrl+C` in the terminal
2. Start it again: `npm run dev`
3. Check the console - you should see:
   ```
   ✅ Supabase configured
   URL: https://...
   ```

## Step 5: Verify in Browser Console

1. Open your app in the browser
2. Press `F12` to open Developer Tools
3. Go to the Console tab
4. Look for:
   - ✅ `✅ Supabase configured` (good!)
   - ❌ `❌ Supabase credentials not found!` (bad - check `.env` file)

## Step 6: Run the SQL Fix

Even with correct env vars, you still need to:
1. Run `COMPLETE_FIX.sql` in Supabase SQL Editor
2. Wait 10-30 seconds
3. Try logging in

## Troubleshooting

### "Supabase credentials not found" in console
- Check that `.env` file exists in project root
- Check that variable names are exactly: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- Restart your dev server

### Wrong URL format
- Should be: `https://xxxxx.supabase.co`
- NOT: `https://app.supabase.com/project/xxxxx`
- NOT: `https://xxxxx.supabase.io`

### Still getting schema cache error
- Make sure you ran `COMPLETE_FIX.sql` in Supabase
- Wait 30 seconds after running the SQL
- Check that the `users` table exists in Supabase Table Editor





