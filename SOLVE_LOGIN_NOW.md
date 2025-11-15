# Solve Login Issue - Step by Step

Email is confirmed ✅, profile is correct ✅, but login still fails.

## The Issue: Password

Since email is confirmed, the issue is almost certainly the **password**.

## Solution: Reset Password in Supabase

### Step 1: Reset Password

1. Go to **Supabase Dashboard** → **Authentication** → **Users**
2. Click on `superadmin@ucu.ac.ug`
3. Look for one of these buttons:
   - **"Reset password"**
   - **"Update password"**
   - **"Change password"**
   - Or a **pencil/edit icon** next to password
4. Set password to: `admin123`
5. **Save**

### Step 2: Verify Password Was Set

After resetting, the password field should show as "set" or have a checkmark.

### Step 3: Try Login

1. Go to your app
2. Email: `superadmin@ucu.ac.ug`
3. Password: `admin123` (the password you just set)
4. Click NEXT

## Alternative: Delete and Recreate User

If you can't find the reset password option:

1. **Delete the user**:
   - Authentication → Users → Click user → Delete
2. **Create new user**:
   - Click "Add user" → "Create new user"
   - Email: `superadmin@ucu.ac.ug`
   - Password: `admin123` (enter it clearly)
   - ✅ **Auto Confirm User** (check this!)
   - Click "Create user"
3. **Create profile** (run this SQL):
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
4. **Try login** with `admin123`

## Check Browser Console

When you try to login, open browser console (F12) and look for:
- "Attempting to authenticate with Supabase Auth: superadmin@ucu.ac.ug"
- "❌ Supabase Auth error: ..."

**Share the exact error message** - it will tell us what's wrong!

## Common Password Issues

1. **Password not set**: When creating user, password field was left blank
2. **Wrong password**: You're entering a different password than what was set
3. **Password with spaces**: Extra spaces before/after password
4. **Case sensitivity**: `Admin123` ≠ `admin123`

---

**Try resetting the password to `admin123` and let me know what happens!**


