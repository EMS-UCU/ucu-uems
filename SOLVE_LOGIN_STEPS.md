# 🔧 Solve Login Issue - Complete Guide

## Current Status
- ✅ User exists in `auth.users`
- ✅ Email is confirmed (`email_confirmed_at` is set)
- ✅ Profile exists in `user_profiles`
- ❌ Login still fails with "Invalid email or password"

## The Problem
Since email is confirmed and user exists, **the issue is almost certainly the password**.

## Solution Steps

### Step 1: Reset Password in Supabase Dashboard

1. Go to **Supabase Dashboard** → **Authentication** → **Users**
2. Find and click on `superadmin@ucu.ac.ug`
3. Look for one of these options:
   - **"Update password"** button
   - **"Reset password"** button
   - **Pencil/edit icon** next to password field
   - **"Send password reset email"** (if available)
4. Set password to: `admin123`
5. **Save/Confirm**

### Step 2: Verify Password Was Set

After resetting, you should see:
- Password field shows as "set" or has a checkmark
- No error messages

### Step 3: Run SQL to Fix Profile (if needed)

Run `FIX_PASSWORD_AND_LOGIN.sql` in Supabase SQL Editor to ensure profile is correct.

### Step 4: Test Login

1. Go to your app (`http://localhost:5173`)
2. Email: `superadmin@ucu.ac.ug`
3. Password: `admin123` (the password you just set)
4. Click **NEXT**

### Step 5: Check Browser Console

Open browser console (F12) and look for:
- `🔐 Attempting to authenticate with Supabase Auth:`
- `❌ Supabase Auth error:` (if it fails)
- `✅ Auth successful!` (if it works)

**Share the exact console output** - it will show what's wrong!

## Alternative: Test Directly in Browser

1. Open your app → Press **F12** → **Console** tab
2. Run this (replace `YOUR_ANON_KEY` with your actual key from `.env`):

```javascript
const url = 'https://ntleujqnruwjkcmzifuy.supabase.co';
const key = 'YOUR_ANON_KEY'; // From .env file

const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
const supabase = createClient(url, key);

const { data, error } = await supabase.auth.signInWithPassword({
  email: 'superadmin@ucu.ac.ug',
  password: 'admin123'
});

if (error) {
  console.error('❌ ERROR:', error.message, error.status);
} else {
  console.log('✅ SUCCESS!', data.user.email);
}
```

This will show the exact error from Supabase Auth.

## Common Issues

1. **Password not set correctly**: When creating user, password field was left blank or had spaces
2. **Wrong password**: You're entering a different password than what was set
3. **Password with spaces**: Extra spaces before/after password
4. **Case sensitivity**: `Admin123` ≠ `admin123`

## What to Share

1. What does the browser console show when you try to login?
2. What error does the direct browser test show?
3. Did you successfully reset the password in Dashboard?

---

**Most likely fix: Reset password to `admin123` in Dashboard and try again!**


