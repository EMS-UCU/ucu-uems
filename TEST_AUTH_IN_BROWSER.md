# Test Authentication Directly in Browser

Since multiple users are failing, let's test Supabase Auth directly to see what's happening.

## Step 1: Open Browser Console

1. Go to your app: http://localhost:5173
2. Press **F12** → **Console** tab

## Step 2: Test Authentication Directly

Run this in the browser console (replace YOUR_ANON_KEY with your actual key from .env):

```javascript
// Get the Supabase client from your app
const supabaseUrl = 'https://ntleujqnruwjkcmzifuy.supabase.co';
const supabaseKey = 'YOUR_ANON_KEY_HERE';

// Import Supabase (or use window.supabase if available)
// For testing, you can use the CDN version:
const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
const testSupabase = createClient(supabaseUrl, supabaseKey);

// Test 1: Try to sign in
console.log('🧪 Testing authentication...');
const { data, error } = await testSupabase.auth.signInWithPassword({
  email: 'superadmin@ucu.ac.ug',
  password: 'admin123'
});

if (error) {
  console.error('❌ ERROR:', {
    message: error.message,
    status: error.status,
    name: error.name
  });
} else {
  console.log('✅ SUCCESS!', {
    userId: data.user.id,
    email: data.user.email,
    confirmed: !!data.user.email_confirmed_at
  });
}
```

## Step 3: Check What Your App Is Doing

Or, check what your app's Supabase client is doing:

```javascript
// Check if supabase is available globally
console.log('Supabase URL:', window.location.href);

// Try to access the supabase instance
// (This depends on how your app exposes it)
```

## Step 4: Check Supabase Auth Settings

1. Go to **Supabase Dashboard** → **Authentication** → **Settings**
2. Check:
   - **Enable Email Signup**: Should be ✅ enabled
   - **Enable Email Confirmations**: Check if this is blocking login
   - **Site URL**: Should match your app URL or be set to allow all

## Step 5: Verify User Email Confirmation

Run this in SQL Editor:

```sql
SELECT 
  email,
  email_confirmed_at IS NOT NULL as is_confirmed,
  created_at
FROM auth.users
WHERE email IN ('superadmin@ucu.ac.ug', 'your-other-test-email@example.com');
```

**If `is_confirmed` is FALSE**, that's the problem! You need to confirm the email.

## Common Issues

### Issue 1: Email Not Confirmed
- **Fix**: Go to Authentication → Users → Click user → "Confirm email"

### Issue 2: Auth Settings Blocking
- **Fix**: Check Authentication → Settings → Make sure email signup is enabled

### Issue 3: Wrong Project
- **Fix**: Verify you're creating users in the SAME project as your .env file points to

### Issue 4: Password Not Set
- **Fix**: When creating user, make sure you actually set a password (not left blank)

---

**Run the browser console test and share the results!**


