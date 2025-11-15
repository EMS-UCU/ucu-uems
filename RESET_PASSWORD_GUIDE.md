# 🔑 Reset Password - Step by Step

## The Problem
Error: `invalid_credentials` (400) - Password doesn't match what's stored in Supabase.

## Solution: Reset Password in Supabase Dashboard

### Method 1: Update Password Directly (Recommended)

1. **Go to Supabase Dashboard**
   - Open: https://supabase.com/dashboard
   - Select your project

2. **Navigate to Authentication**
   - Click **Authentication** in left sidebar
   - Click **Users** tab

3. **Find and Edit User**
   - Find `superadmin@ucu.ac.ug` in the list
   - **Click on the user** (click the email or row)

4. **Update Password**
   - Look for **"Update password"** button or **"Reset password"** button
   - Or look for a **pencil/edit icon** next to password field
   - Enter new password: `admin123`
   - **Save/Confirm**

5. **Verify**
   - Password field should show as "set" or have a checkmark
   - No error messages

### Method 2: Delete and Recreate User

If you can't find the update password option:

1. **Delete the user**:
   - Authentication → Users → Click `superadmin@ucu.ac.ug`
   - Click **Delete** or **Remove** button
   - Confirm deletion

2. **Create new user**:
   - Click **"Add user"** → **"Create new user"**
   - Email: `superadmin@ucu.ac.ug`
   - Password: `admin123` (type it carefully, no spaces)
   - ✅ **Check "Auto Confirm User"** (IMPORTANT!)
   - Click **"Create user"**

3. **Create Profile** (run this SQL):
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

### Method 3: Use Password Reset Email (If enabled)

1. In your app, add a "Forgot Password" link
2. User clicks it → Supabase sends reset email
3. User clicks link in email → Sets new password

## After Resetting Password

1. **Test Login**:
   - Email: `superadmin@ucu.ac.ug`
   - Password: `admin123`
   - Click NEXT

2. **Check Console**:
   - Should see: `✅ Auth successful!`
   - Should NOT see: `❌ Supabase Auth error`

## Common Mistakes

- ❌ Password has spaces: `admin123 ` (with trailing space)
- ❌ Wrong password: `Admin123` vs `admin123` (case sensitive)
- ❌ Password not saved: Clicked cancel instead of save
- ❌ Auto Confirm not checked: User created but email not confirmed

---

**Try Method 1 first - it's the quickest!**


