# Troubleshooting: "Could not find the table 'public.users'"

If you're still getting this error after running the SQL script, try these steps:

## Step 1: Verify the Table Exists

1. Go to Supabase Dashboard → **Table Editor**
2. Check if you see a `users` table in the list
3. If you don't see it, the table wasn't created

## Step 2: Check for Errors in SQL Editor

1. Go to Supabase Dashboard → **SQL Editor**
2. Look at the "History" tab
3. Check if there were any errors when you ran the script
4. Common errors:
   - Permission denied
   - Syntax errors
   - Schema issues

## Step 3: Run the SQL Script Again

1. Open the SQL Editor
2. Copy the ENTIRE contents of `create_users_table.sql`
3. Paste it into a new query
4. Click "Run" (or press Ctrl+Enter)
5. Wait for it to complete
6. Check for any error messages in red

## Step 4: Verify with a Simple Query

Run this in SQL Editor to check if the table exists:

```sql
SELECT * FROM users LIMIT 1;
```

- If this works, the table exists
- If you get an error, the table doesn't exist

## Step 5: Check Your Schema

Run this to see all tables in the public schema:

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public';
```

You should see `users` in the list.

## Step 6: Refresh Schema Cache

Sometimes Supabase needs to refresh its schema cache:

1. Go to Supabase Dashboard → **Settings** → **API**
2. Scroll down and look for "Schema Cache" or similar
3. Or try restarting your development server

## Step 7: Check Your Project Connection

1. Verify you're connected to the correct Supabase project
2. Check your `.env` file has the correct URL and key
3. Make sure there are no typos in the credentials

## Step 8: Alternative - Create Table via Table Editor

If SQL isn't working, try creating the table manually:

1. Go to **Table Editor**
2. Click "New Table"
3. Name it: `users`
4. Add these columns:
   - `id` - UUID, Primary Key, Default: `gen_random_uuid()`
   - `username` - Text, Unique, Not Null
   - `email` - Text, Unique, Nullable
   - `name` - Text, Not Null
   - `base_role` - Text, Not Null
   - `roles` - Text Array, Default: `{}`
   - `password_hash` - Text, Not Null
   - `created_at` - Timestamp, Default: `now()`
   - `updated_at` - Timestamp, Default: `now()`
5. Save the table
6. Then run the RLS policy SQL separately

## Still Having Issues?

If none of these work:
1. Check the browser console (F12) for the exact error
2. Check Supabase Dashboard → Logs for any errors
3. Make sure your Supabase project is active and not paused
4. Try creating a simple test table to verify SQL execution works



