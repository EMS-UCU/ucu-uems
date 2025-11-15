# Quick Fix: "Invalid email or password"

## The Problem

The error "Invalid email or password" means the user doesn't exist in `auth.users` yet.

## Solution: Create the User

### Step 1: Create User in Supabase Auth

1. Go to **Supabase Dashboard**
2. Click **Authentication** (left sidebar)
3. Click **Users** tab
4. Click **"Add user"** button (top right)
5. Select **"Create new user"**
6. Fill in:
   - **Email**: `superadmin@ucu.ac.ug`
   - **Password**: `admin123`
   - ✅ **Auto Confirm User** (IMPORTANT - check this!)
7. Click **"Create user"**

### Step 2: Verify User Was Created

1. You should see the user in the list
2. Check that **"Email Confirmed"** column shows ✅
3. If not confirmed:
   - Click on the user
   - Click **"Confirm email"** button

### Step 3: Create User Profile

After creating the auth user, create their profile:

1. Go to **SQL Editor**
2. Run this SQL:

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
WHERE email = 'superadmin@ucu.ac.ug'
ON CONFLICT (id) DO UPDATE
SET 
  username = EXCLUDED.username,
  email = EXCLUDED.email,
  name = EXCLUDED.name,
  base_role = EXCLUDED.base_role,
  roles = EXCLUDED.roles,
  is_super_admin = EXCLUDED.is_super_admin;
```

### Step 4: Verify Everything

Run `check_auth_user.sql` in SQL Editor to verify:
- ✅ User exists in auth.users
- ✅ Email is confirmed
- ✅ Profile exists

### Step 5: Try Login Again

1. Go to your app
2. Email: `superadmin@ucu.ac.ug`
3. Password: `admin123`
4. Click **NEXT**

## Check Browser Console

Open browser console (F12) and look for:
- "Attempting to authenticate with Supabase Auth: ..."
- Any error messages

Share the console output if it still doesn't work!




