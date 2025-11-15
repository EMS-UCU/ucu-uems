# Step-by-Step Troubleshooting Guide

Follow these steps in order. Stop when you find the issue.

## Step 1: Run Comprehensive Diagnostic

1. Open Supabase Dashboard → SQL Editor
2. Copy and paste the ENTIRE `COMPREHENSIVE_DIAGNOSTIC.sql` script
3. Run it
4. **Check the results:**
   - Part 1: Should show table exists (result = 1)
   - Part 2: Should show permissions granted
   - Part 3: Should show RLS enabled with policies
   - Part 4: All test queries should return data
   - Part 5: Should complete without errors

**If any part fails, note which one and share the error.**

## Step 2: Test REST API Directly

This tests if the table is accessible via the REST API (bypassing the client):

### Option A: Use the Test HTML File

1. Open `test_rest_api.html` in your browser
2. Enter your Supabase URL: `https://ntleujgnruwjkcmzifuy.supabase.co`
3. Enter your Anon Key (from your `.env` file - the `VITE_SUPABASE_ANON_KEY` value)
4. Click "Test REST API"
5. **Check the result:**
   - ✅ SUCCESS = Table is accessible, issue is client-side
   - ❌ ERROR = Table not accessible, schema cache issue

### Option B: Use Browser Console

1. Open your app in browser
2. Press F12 → Console tab
3. Run this (replace YOUR_ANON_KEY with your actual key):

```javascript
fetch('https://ntleujgnruwjkcmzifuy.supabase.co/rest/v1/users?select=*&limit=1', {
  headers: {
    'apikey': 'YOUR_ANON_KEY',
    'Authorization': 'Bearer YOUR_ANON_KEY'
  }
}).then(r => r.json()).then(console.log).catch(console.error)
```

**What does it return?**
- If it shows user data: ✅ REST API works, issue is client-side
- If it shows 404/PGRST205: ❌ Schema cache not refreshed

## Step 3: Restart Supabase Project

If REST API test fails (404 error):

1. Go to Supabase Dashboard
2. Click **Settings** (gear icon) → **General**
3. Scroll down to find **"Restart Project"** or **"Pause Project"**
4. Click **Restart** (or Pause, wait 10 seconds, then Resume)
5. **Wait 3-5 minutes** for project to fully restart
6. Run REST API test again (Step 2)

## Step 4: Restart Dev Server

If REST API works but app doesn't:

1. Stop your dev server (Ctrl+C in terminal)
2. Clear node_modules cache (optional but recommended):
   ```bash
   rm -rf node_modules/.vite
   ```
3. Restart dev server:
   ```bash
   npm run dev
   ```
4. Hard refresh browser (Ctrl+F5)
5. Try login again

## Step 5: Clear Browser Cache

1. Open browser DevTools (F12)
2. Right-click the refresh button
3. Select "Empty Cache and Hard Reload"
4. Or manually:
   - Chrome: Ctrl+Shift+Delete → Clear browsing data
   - Firefox: Ctrl+Shift+Delete → Clear cache

## Step 6: Verify Environment Variables

1. Check your `.env` file exists in project root
2. Verify it has:
   ```
   VITE_SUPABASE_URL=https://ntleujgnruwjkcmzifuy.supabase.co
   VITE_SUPABASE_ANON_KEY=your-actual-key-here
   ```
3. **Restart dev server** after any changes to `.env`

## Step 7: Check Supabase Project Status

1. Go to https://status.supabase.com
2. Check if there are any service issues
3. Check your Supabase project dashboard for any warnings

## Step 8: Try Alternative Approach

If nothing works, we can try:
1. Creating a new table with a different name
2. Using Supabase's built-in auth instead of custom auth
3. Contacting Supabase support

---

## Report Back

After each step, report:
- Which step you're on
- What the results were
- Any error messages you see

This will help me identify the exact issue!




