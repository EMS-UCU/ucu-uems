// Test Supabase Auth directly in browser console
// Run this in your browser console (F12) to test authentication

// Get your Supabase URL and Key from .env file
const SUPABASE_URL = 'https://ntleujqnruwjkcmzifuy.supabase.co';
const SUPABASE_KEY = 'YOUR_ANON_KEY_HERE'; // Get from .env file

// Import Supabase client (or use the one from your app)
// In browser console, you can test like this:

async function testAuth() {
  console.log('🧪 Testing Supabase Auth...');
  
  // Create a test client
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  
  // Test 1: Try to sign in
  console.log('Test 1: Attempting sign in...');
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'superadmin@ucu.ac.ug',
    password: 'admin123'
  });
  
  if (error) {
    console.error('❌ Auth Error:', {
      message: error.message,
      status: error.status,
      name: error.name
    });
    return;
  }
  
  if (data.user) {
    console.log('✅ SUCCESS! User authenticated:', {
      id: data.user.id,
      email: data.user.email,
      confirmed: !!data.user.email_confirmed_at
    });
  }
}

// Or simpler test - just check what your app is doing
console.log('To test, run: testAuth()');



