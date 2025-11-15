# Debug Authentication Issue

Since multiple users are failing, let's systematically check everything.

## Step 1: Check Email Confirmation

Run `check_auth_settings.sql` and look at **Check 2**:
- If `email_confirmed` is **FALSE** → That's the problem!
- **Fix**: Go to Authentication → Users → Click user → "Confirm email"

## Step 2: Check Supabase Auth Settings

1. Go to **Supabase Dashboard** → **Authentication** → **Settings**
2. Check these settings:

### Email Auth Settings:
- ✅ **Enable Email Signup**: Should be ON
- ⚠️ **Enable Email Confirmations**: 
  - If ON → Users must confirm email before login
  - If OFF → Users can login immediately
  - **For testing, turn this OFF temporarily**

### Site URL:
- Should be set to your app URL or `http://localhost:5173`
- Or set to allow all: `*` (for development only)

## Step 3: Test Authentication Directly

Open browser console (F12) and run:

```javascript
// Get your anon key from .env file
const url = 'https://ntleujqnruwjkcmzifuy.supabase.co';
const key = 'YOUR_ANON_KEY'; // From .env file

// Import Supabase
const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
const supabase = createClient(url, key);

// Test login
console.log('Testing login...');
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'superadmin@ucu.ac.ug',
  password: 'admin123'
});

if (error) {
  console.error('❌ ERROR:', error.message);
  console.error('Full error:', error);
} else {
  console.log('✅ SUCCESS!', data.user);
}
```

## Step 4: Check What Password Was Set

When you created the user in Supabase Dashboard:
1. Did you actually enter a password?
2. What password did you enter?
3. Did you check "Auto Confirm User"?

## Step 5: Reset Password

If you're not sure about the password:

1. Go to **Authentication** → **Users**
2. Click on `superadmin@ucu.ac.ug`
3. Look for **"Reset password"** or **"Update password"**
4. Set it to: `admin123`
5. Make sure **"Email Confirmed"** shows ✅

## Common Issues

### Issue 1: Email Not Confirmed
**Symptom**: `email_confirmed_at` is NULL  
**Fix**: Confirm email in Dashboard

### Issue 2: Email Confirmation Required
**Symptom**: Auth settings require email confirmation  
**Fix**: Disable email confirmation in Auth Settings (for testing)

### Issue 3: Wrong Password
**Symptom**: "Invalid login credentials"  
**Fix**: Reset password in Dashboard

### Issue 4: Site URL Mismatch
**Symptom**: CORS or redirect errors  
**Fix**: Update Site URL in Auth Settings

---

**Share the results from:**
1. `check_auth_settings.sql` - Check 2 (email_confirmed status)
2. Browser console test results
3. Your Auth Settings (Authentication → Settings)


