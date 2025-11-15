# 🔑 Fix "Invalid API key" Error

## The Problem
Error: `Invalid API key` (401) - This means Supabase is rejecting your API key, not your password!

## Solution: Fix Your API Key

### Step 1: Get Your Correct API Key

1. **Go to Supabase Dashboard**
   - https://supabase.com/dashboard
   - Select your project

2. **Go to Settings → API**
   - Click **"Settings"** in left sidebar
   - Click **"API"** tab

3. **Copy the "anon public" key**
   - Look for **"Project API keys"** section
   - Find **"anon public"** key (NOT "service_role" key!)
   - Click **"Copy"** button
   - It should start with: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

### Step 2: Update Your .env File

1. **Open `.env` file** in your project root
2. **Check the format** - it should look like this:

```env
VITE_SUPABASE_URL=https://ntleujqnruwjkcmzifuy.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bGV1anFucnV3amtjbXppZnV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzE2ODk2MDAsImV4cCI6MjA0NzI2NTYwMH0.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Important:**
- ✅ No quotes around the values
- ✅ No spaces before/after the `=` sign
- ✅ Use `VITE_SUPABASE_ANON_KEY` (not `SUPABASE_ANON_KEY`)
- ✅ Use the "anon public" key (NOT "service_role" key)

### Step 3: Restart Dev Server

After updating `.env`:
1. **Stop your dev server** (Ctrl+C)
2. **Start it again**: `npm run dev`
3. Environment variables only load when the server starts!

### Step 4: Verify in Browser Console

1. Open your app → Press F12 → Console
2. You should see:
   ```
   ✅ Supabase configured
   URL: https://ntleujqnruwjkcmzifuy.supabase.co
   Key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```

### Step 5: Test Again

1. Open `test_password_directly.html` in browser
2. Paste the **correct anon key** from Step 1
3. Test login again

## Common Mistakes

❌ **Wrong key type**: Using "service_role" key instead of "anon public" key
- **Fix**: Use "anon public" key only!

❌ **Key has quotes**: `VITE_SUPABASE_ANON_KEY="eyJ..."`
- **Fix**: Remove quotes: `VITE_SUPABASE_ANON_KEY=eyJ...`

❌ **Key has spaces**: `VITE_SUPABASE_ANON_KEY = eyJ...`
- **Fix**: Remove spaces: `VITE_SUPABASE_ANON_KEY=eyJ...`

❌ **Wrong variable name**: `SUPABASE_ANON_KEY=...`
- **Fix**: Must be `VITE_SUPABASE_ANON_KEY=...`

❌ **Didn't restart server**: Updated .env but server still running
- **Fix**: Stop and restart `npm run dev`

## Verify Your .env File

Your `.env` should look exactly like this (with your actual values):

```env
VITE_SUPABASE_URL=https://ntleujqnruwjkcmzifuy.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bGV1anFucnV3amtjbXppZnV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzE2ODk2MDAsImV4cCI6MjA0NzI2NTYwMH0.YOUR_ACTUAL_KEY_HERE
```

**No quotes, no spaces, correct variable names!**

---

**Once you fix the API key, the password test should work!**


