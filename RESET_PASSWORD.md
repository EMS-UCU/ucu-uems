# Reset Password for User

Since the user exists but you don't know the password, here are your options:

## Option 1: Reset Password via Dashboard (Easiest)

1. Go to **Supabase Dashboard** → **Authentication** → **Users**
2. Click on the user `superadmin@ucu.ac.ug`
3. Look for **"Reset password"** or **"Update password"** button
4. Set a new password (e.g., `admin123`)
5. Save
6. Try logging in with the new password

## Option 2: Delete and Recreate User

1. Go to **Authentication** → **Users**
2. Click on `superadmin@ucu.ac.ug`
3. Click **"Delete user"** (or trash icon)
4. Confirm deletion
5. Create new user:
   - Click **"Add user"** → **"Create new user"**
   - Email: `superadmin@ucu.ac.ug`
   - Password: `admin123`
   - ✅ **Auto Confirm User**
   - Click **"Create user"**
6. Run `FIX_USER_LOGIN.sql` to create the profile

## Option 3: Use Supabase Auth API (Advanced)

If the dashboard doesn't have a reset option, you can use the Management API, but this requires the service_role key (not recommended for security).

## After Resetting Password

1. Run `FIX_USER_LOGIN.sql` to ensure profile exists
2. Try logging in with the new password
3. Check browser console (F12) for any errors

## What Password to Use?

- If you created the user yourself: Use the password you entered when creating
- If someone else created it: Ask them, or reset it using Option 1 or 2 above
- If you forgot: Use Option 1 or 2 to set a new one




