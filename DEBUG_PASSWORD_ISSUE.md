# 🔍 Debug Password Issue - Complete Guide

## The Problem
You're entering the exact password `admin123` but login still fails with `invalid_credentials`.

## Possible Causes

### 1. Password Not Actually Set in Supabase Auth
**Most Likely!** When you create a user in Supabase Dashboard, sometimes the password field doesn't save properly.

**Fix:**
1. Go to Supabase Dashboard → Authentication → Users
2. Click on `superadmin@ucu.ac.ug`
3. **Delete the user completely**
4. Click "Add user" → "Create new user"
5. Email: `superadmin@ucu.ac.ug`
6. Password: `admin123` (type it fresh, don't copy-paste)
7. ✅ **Check "Auto Confirm User"**
8. Click "Create user"
9. Verify password shows as "set" or has a checkmark

### 2. Password Has Hidden Characters
Sometimes passwords have spaces or special characters you can't see.

**Test:**
1. Open `test_password_directly.html` in your browser
2. Enter your Supabase credentials
3. Click "Test All Password Variations"
4. This will test: `admin123`, `admin123 `, ` admin123`, etc.

### 3. Supabase Auth Settings Blocking Login
Check Supabase Dashboard → Authentication → Settings:
- **Enable Email Signup**: Should be ON
- **Enable Email Confirmations**: If ON, email must be confirmed (yours is confirmed ✅)
- **Site URL**: Should be `http://localhost:5173` or `*` for development

### 4. Backend Code Modifying Password
**Unlikely** - I checked the code, it only trims the password (removes spaces). But let's verify:

**Test:**
1. Open `test_password_directly.html` in browser
2. This bypasses ALL your app code
3. If this works, the problem is in your app code
4. If this fails, the problem is in Supabase Auth

### 5. Wrong Supabase Project
Make sure your `.env` file points to the correct Supabase project.

**Check:**
1. Open `.env` file
2. Compare `VITE_SUPABASE_URL` with your Supabase Dashboard URL
3. They should match!

## Step-by-Step Debugging

### Step 1: Test Password Directly (Bypass All Code)
1. Open `test_password_directly.html` in your browser
2. Enter:
   - URL: `https://ntleujqnruwjkcmzifuy.supabase.co`
   - Key: Your `VITE_SUPABASE_ANON_KEY` from `.env`
   - Email: `superadmin@ucu.ac.ug`
   - Password: `admin123`
3. Click "Test Login"
4. **Share the result!**

### Step 2: Check Supabase Auth Settings
1. Go to Supabase Dashboard → Authentication → Settings
2. Check:
   - Enable Email Signup: ON
   - Enable Email Confirmations: OFF (for testing) or ON (if ON, email must be confirmed)
   - Site URL: `http://localhost:5173` or `*`

### Step 3: Verify User in Supabase
1. Run `check_supabase_auth_settings.sql` in SQL Editor
2. Check:
   - `email_confirmed`: Should be `true`
   - `has_password`: Should be `true`
   - `banned_until`: Should be `NULL`
   - `deleted_at`: Should be `NULL`

### Step 4: Reset Password Fresh
1. **Delete user** in Dashboard
2. **Create new user** with password `admin123`
3. **Type password fresh** (don't copy-paste)
4. **Check "Auto Confirm User"**
5. **Save**
6. **Try login again**

## What to Share

1. **Result from `test_password_directly.html`** - Does it work?
2. **Output from `check_supabase_auth_settings.sql`** - What does it show?
3. **Supabase Auth Settings** - What are your settings?

## Most Likely Solution

**Delete and recreate the user with a fresh password:**

1. Supabase Dashboard → Authentication → Users
2. Delete `superadmin@ucu.ac.ug`
3. Add user → Create new user
4. Email: `superadmin@ucu.ac.ug`
5. Password: `admin123` (type it, don't copy)
6. ✅ Auto Confirm User
7. Create user
8. Run `FIX_PASSWORD_AND_LOGIN.sql` to create profile
9. Try login

---

**The password in Supabase Auth doesn't match `admin123`. Reset it fresh and it should work!**


