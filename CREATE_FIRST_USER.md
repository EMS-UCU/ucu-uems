# Create Your First User in Supabase Auth

## The Error: "Invalid email or password"

This means the user doesn't exist in `auth.users` yet. Follow these steps:

## Step 1: Create User in Supabase Auth

1. Go to **Supabase Dashboard** → **Authentication** → **Users**
2. Click **"Add user"** button (top right)
3. Select **"Create new user"**
4. Fill in:
   - **Email**: `superadmin@ucu.ac.ug`
   - **Password**: `admin123` (or your preferred password)
   - **Auto Confirm User**: ✅ **CHECK THIS** (important!)
5. Click **"Create user"**

## Step 2: Verify User Was Created

1. You should see the user in the list
2. Check that **"Email Confirmed"** shows a checkmark ✅
3. If not confirmed, click the user → **"Confirm email"** button

## Step 3: Create User Profile

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

## Step 4: Verify Everything

Run `check_auth_user.sql` to verify:
- User exists in auth.users ✅
- Email is confirmed ✅
- Profile exists ✅

## Step 5: Try Login Again

1. Go to your app
2. Email: `superadmin@ucu.ac.ug`
3. Password: `admin123` (or whatever you set)
4. Click **NEXT**

## Troubleshooting

### Still "Invalid email or password"?

1. **Check browser console (F12)** - What error do you see?
2. **Verify user exists**: Run `check_auth_user.sql`
3. **Check password**: Make sure you're using the exact password you set
4. **Check email**: Make sure it matches exactly (case-sensitive)

### "Email not confirmed" error?

- Go to Authentication → Users
- Click on the user
- Click **"Confirm email"** button

### User exists but profile doesn't?

- Run the profile creation SQL from Step 3 again




