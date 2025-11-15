# Direct Authentication Test

Let's test authentication directly to see the exact error.

## Test 1: Browser Console Test

1. **Open your app** in browser: http://localhost:5173
2. **Press F12** → **Console** tab
3. **Get your anon key** from `.env` file
4. **Run this** (replace YOUR_ANON_KEY):

```javascript
// Test Supabase Auth directly
const url = 'https://ntleujqnruwjkcmzifuy.supabase.co';
const key = 'YOUR_ANON_KEY_HERE'; // From .env file

const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
const testSupabase = createClient(url, key);

console.log('🧪 Testing authentication...');
const { data, error } = await testSupabase.auth.signInWithPassword({
  email: 'superadmin@ucu.ac.ug',
  password: 'admin123'
});

if (error) {
  console.error('❌ ERROR:', {
    message: error.message,
    status: error.status,
    name: error.name,
    code: error.code
  });
  console.error('Full error:', error);
} else {
  console.log('✅ SUCCESS!', {
    userId: data.user.id,
    email: data.user.email,
    confirmed: !!data.user.email_confirmed_at
  });
}
```

## Test 2: Check Email Confirmation

Run `test_auth_now.sql` in SQL Editor:
- If `email_confirmed_at` is **NULL** → Email not confirmed (blocks login!)
- If it has a date → Email is confirmed

## Test 3: Check Supabase Auth Settings

1. Go to **Authentication** → **Settings**
2. Check:
   - **Enable Email Signup**: Should be ✅ ON
   - **Enable Email Confirmations**: 
     - If ON → Users MUST confirm email
     - **For testing, turn this OFF**
   - **Site URL**: Should be `http://localhost:5173` or `*`

## Most Common Issues

### Issue 1: Email Not Confirmed (90% of cases)
**Symptom**: `email_confirmed_at` is NULL  
**Fix**: 
1. Authentication → Users → Click user → "Confirm email"
2. OR disable email confirmation in Settings

### Issue 2: Wrong Password
**Symptom**: "Invalid login credentials"  
**Fix**: Reset password in Dashboard

### Issue 3: Email Confirmation Required
**Symptom**: Auth settings require confirmation  
**Fix**: Disable "Enable Email Confirmations" in Settings

---

**Run the browser console test and share:**
1. What error message do you get?
2. What does `test_auth_now.sql` show for email_confirmed_at?


