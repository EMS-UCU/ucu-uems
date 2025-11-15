# 🚀 Quick Super Admin Setup Guide

## The Problem
When you create users in Supabase Dashboard → Authentication → Users, they automatically become **Lecturers** by default because of the `handle_new_user()` trigger.

## Solution: Create Super Admin in 2 Steps

### Step 1: Create User in Supabase Dashboard

1. Go to **Supabase Dashboard** → **Authentication** → **Users**
2. Click **"Add user"** → **"Create new user"**
3. Fill in:
   - **Email**: `superadmin@ucu.ac.ug` (or your desired email)
   - **Password**: `admin123` (or your desired password)
   - ✅ **Check "Auto Confirm User"** (IMPORTANT!)
4. Click **"Create user"**

### Step 2: Run SQL to Make Them Super Admin

1. Go to **Supabase Dashboard** → **SQL Editor**
2. Open `create_super_admin.sql`
3. **Change the email** in the query (line 18):
   ```sql
   user_email TEXT := 'superadmin@ucu.ac.ug'; -- CHANGE THIS
   ```
4. **Run the query**
5. You should see: `✅ Super Admin profile created/updated for...`

### Step 3: Verify

The query will automatically verify at the end. You should see:
- `base_role`: `Admin`
- `is_super_admin`: `true`
- `status`: `✅ SUPER ADMIN`

## Alternative: Update Existing User

If you already created a user and want to make them Super Admin:

```sql
-- Replace 'your-email@ucu.ac.ug' with the actual email
UPDATE public.user_profiles
SET
  base_role = 'Admin',
  roles = ARRAY['Admin'],
  is_super_admin = TRUE,
  updated_at = NOW()
WHERE email = 'your-email@ucu.ac.ug';
```

## Why This Happens

The `handle_new_user()` trigger automatically creates a profile with:
- `base_role = 'Lecturer'` (default)
- `is_super_admin = FALSE` (default)

This SQL query overrides those defaults to make the user a Super Admin.

---

**After running the SQL, log out and log back in to see the Super Admin Dashboard!**


