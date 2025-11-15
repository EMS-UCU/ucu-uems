# Verify Login Credentials

## What Your App Sends to Supabase Auth

Looking at your code, here's exactly what happens:

### Step 1: User Enters Credentials
- **Email field**: User types email
- **Password field**: User types password

### Step 2: Form Processing (HomePage.tsx)
```javascript
// Line 90: Email is trimmed and lowercased
// Password is trimmed
onLogin(email.trim().toLowerCase(), password.trim())
```

### Step 3: Authentication (auth.ts)
```javascript
// Line 84-87: Sent to Supabase Auth
supabase.auth.signInWithPassword({
  email: email.trim().toLowerCase(),  // Lowercase email
  password: password.trim()           // Trimmed password
})
```

## What Supabase Auth Requires

✅ **Email**: The exact email address stored in `auth.users`  
✅ **Password**: The exact password you set when creating the user

## Important Notes

1. **Email is lowercased**: Your app converts email to lowercase
   - If you enter: `SuperAdmin@ucu.ac.ug`
   - It becomes: `superadmin@ucu.ac.ug`
   - This is correct! Supabase stores emails in lowercase

2. **Password is trimmed**: Leading/trailing spaces are removed
   - If you enter: ` admin123 ` (with spaces)
   - It becomes: `admin123`
   - This is correct!

3. **Password must match exactly**: 
   - The password you enter must match the password stored in Supabase Auth
   - Passwords are case-sensitive
   - `Admin123` ≠ `admin123`

## How to Verify Your Password

Since you can't see the password in Supabase, you need to:

### Option 1: Reset Password
1. Go to **Authentication** → **Users**
2. Click on `superadmin@ucu.ac.ug`
3. Click **"Reset password"** or **"Update password"**
4. Set password to: `admin123`
5. Save

### Option 2: Test with Known Password
1. Delete the existing user
2. Create a new one with password: `admin123`
3. Make sure **Auto Confirm User** is checked
4. Try logging in with `admin123`

## What to Enter in Login Form

Based on your code, enter:
- **Email**: `superadmin@ucu.ac.ug` (case doesn't matter, will be lowercased)
- **Password**: The exact password you set in Supabase Auth (case-sensitive!)

## Debug: Check Browser Console

Open browser console (F12) and look for:
```
Attempting to authenticate with Supabase Auth: superadmin@ucu.ac.ug
Supabase Auth error: { message: "...", status: ... }
```

This will show the exact error from Supabase Auth.



