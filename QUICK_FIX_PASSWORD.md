# 🚨 QUICK FIX: Password Reset

## The Error
```
❌ Supabase Auth error: invalid_credentials (400)
Invalid login credentials
```

**This means: Password is wrong!**

## ✅ Fix in 2 Minutes

### Step 1: Open Supabase Dashboard
1. Go to: https://supabase.com/dashboard
2. Select your project

### Step 2: Go to Authentication → Users
1. Click **"Authentication"** in left sidebar
2. Click **"Users"** tab
3. Find `superadmin@ucu.ac.ug`

### Step 3: Reset Password
**Option A: Update Password (if available)**
- Click on the user (`superadmin@ucu.ac.ug`)
- Look for **"Update password"** or **"Reset password"** button
- Enter: `admin123`
- Click **Save**

**Option B: Delete and Recreate (if update not available)**
1. Click on user → **Delete** → Confirm
2. Click **"Add user"** → **"Create new user"**
3. Fill in:
   - Email: `superadmin@ucu.ac.ug`
   - Password: `admin123` (type carefully, no spaces!)
   - ✅ **Check "Auto Confirm User"** (IMPORTANT!)
4. Click **"Create user"**
5. Run this SQL to create profile:
   ```sql
   INSERT INTO public.user_profiles (id, username, email, name, base_role, roles, is_super_admin)
   SELECT 
     id,
     'superadmin',
     email,
     'Super Administrator',
     'Admin',
     ARRAY['Admin'],
     TRUE
   FROM auth.users
   WHERE email = 'superadmin@ucu.ac.ug';
   ```

### Step 4: Verify
Run `verify_password_reset.sql` in SQL Editor - should show:
- ✅ `email_confirmed: true`
- ✅ `has_password: true`
- ✅ `status: ✅ READY TO LOGIN`

### Step 5: Test Login
1. Go to your app
2. Email: `superadmin@ucu.ac.ug`
3. Password: `admin123`
4. Click **NEXT**

**Should work now!** ✅

---

**If it still fails, share the new console error!**


