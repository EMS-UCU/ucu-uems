# Migrate to Supabase Auth (auth.users)

## What Changed

We've switched from using `public.users` table to Supabase's built-in `auth.users` table. This avoids schema cache issues!

## Setup Steps

### Step 1: Run SQL Setup Script

1. Open Supabase Dashboard → SQL Editor
2. Copy and paste the ENTIRE `setup_auth_users.sql` script
3. Run it
4. This creates:
   - `user_profiles` table (stores additional user data)
   - RLS policies
   - Auto-profile creation trigger

### Step 2: Create Users in Supabase Auth

You need to create users via Supabase Auth (not SQL):

1. Go to Supabase Dashboard → **Authentication** → **Users**
2. Click **"Add user"** → **"Create new user"**
3. Fill in:
   - **Email**: `superadmin@ucu.ac.ug`
   - **Password**: `admin123` (or your preferred password)
   - **Auto Confirm User**: ✅ Check this (so they can login immediately)
4. Click **"Create user"**

### Step 3: Create User Profile

After creating the auth user, create their profile:

1. Go to Supabase Dashboard → **SQL Editor**
2. Run this (replace the ID with the actual user ID from auth.users):

```sql
-- Get the user ID first
SELECT id, email FROM auth.users WHERE email = 'superadmin@ucu.ac.ug';

-- Then create the profile (replace USER_ID with the ID from above)
INSERT INTO public.user_profiles (id, username, email, name, base_role, roles, is_super_admin)
VALUES (
  'USER_ID_FROM_ABOVE',
  'superadmin',
  'superadmin@ucu.ac.ug',
  'Super Administrator',
  'Admin',
  ARRAY['Admin'],
  TRUE
);
```

Or use this one-liner:

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
ON CONFLICT (id) DO NOTHING;
```

### Step 4: Test Login

1. Restart your dev server (if running)
2. Go to your app: http://localhost:5173
3. Try logging in:
   - Email: `superadmin@ucu.ac.ug`
   - Password: `admin123` (or whatever you set)

## Benefits

✅ **No schema cache issues** - auth.users is always available  
✅ **Built-in password hashing** - Supabase handles it  
✅ **Email verification** - Can enable if needed  
✅ **Session management** - Built-in  
✅ **More secure** - Industry standard

## Creating More Users

To create more users:

1. **Via Dashboard**: Authentication → Users → Add user
2. **Then create profile**: Run SQL to insert into `user_profiles`

Or use the `createUser` function in the app (it will create both auth user and profile).

## Troubleshooting

### "Invalid login credentials"
- User doesn't exist in auth.users
- Wrong password
- User not confirmed (check "Auto Confirm User" when creating)

### "Profile not found"
- Profile will be auto-created with default values
- Or manually create it using the SQL above

### Still seeing old errors?
- Clear browser cache
- Restart dev server
- Check browser console for new error messages

