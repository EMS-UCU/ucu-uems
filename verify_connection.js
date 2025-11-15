// Quick script to verify Supabase connection
// Run this in your browser console (F12) on your app page

// Get the values from your app
const supabaseUrl = 'https://ntleujqnruwjkcmzifuy.supabase.co';
const anonKey = 'YOUR_ANON_KEY_HERE'; // Replace with your actual key from .env

console.log('🔍 Testing Supabase Connection...');
console.log('URL:', supabaseUrl);

// Test 1: Check if we can reach the API
fetch(`${supabaseUrl}/rest/v1/`, {
  headers: {
    'apikey': anonKey,
    'Authorization': `Bearer ${anonKey}`
  }
})
.then(r => {
  console.log('✅ API is reachable!');
  console.log('Status:', r.status);
  return r.text();
})
.then(text => {
  console.log('Response:', text.substring(0, 200));
  
  // Test 2: Try to access users table
  console.log('\n🔍 Testing users table access...');
  return fetch(`${supabaseUrl}/rest/v1/users?select=*&limit=1`, {
    headers: {
      'apikey': anonKey,
      'Authorization': `Bearer ${anonKey}`,
      'Content-Type': 'application/json'
    }
  });
})
.then(r => r.json())
.then(data => {
  if (Array.isArray(data)) {
    console.log('✅ SUCCESS! Users table is accessible!');
    console.log('Data:', data);
    console.log('\n✅ Your project IS connected to Supabase!');
    console.log('The issue is likely the schema cache.');
  } else if (data.code === 'PGRST205') {
    console.log('❌ ERROR: Schema cache issue');
    console.log('Message:', data.message);
    console.log('Hint:', data.hint);
    console.log('\n⚠️ Your project IS connected, but schema cache needs refresh.');
  } else {
    console.log('❌ ERROR:', data);
    console.log('\n⚠️ Connection issue or wrong credentials.');
  }
})
.catch(err => {
  console.error('❌ NETWORK ERROR:', err);
  console.log('\n❌ Cannot reach Supabase. Check:');
  console.log('1. Internet connection');
  console.log('2. Supabase URL is correct');
  console.log('3. Anon key is correct');
});





