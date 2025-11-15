# ✅ Verify Your .env File

## Quick Check

Run this command in your terminal to verify your .env file format:

```powershell
# In PowerShell (Windows)
Get-Content .env
```

Or check manually:

## Correct Format

```env
VITE_SUPABASE_URL=https://ntleujqnruwjkcmzifuy.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50bGV1anFucnV3amtjbXppZnV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzE2ODk2MDAsImV4cCI6MjA0NzI2NTYwMH0.YOUR_KEY_HERE
```

## What to Check

1. ✅ File is named `.env` (not `.env.txt` or `env`)
2. ✅ File is in project root (same folder as `package.json`)
3. ✅ No quotes around values
4. ✅ No spaces around `=`
5. ✅ Variable names start with `VITE_`
6. ✅ URL starts with `https://`
7. ✅ Key starts with `eyJ` (JWT token)

## Get Your Correct Key

1. Supabase Dashboard → Settings → API
2. Copy "anon public" key (NOT service_role!)
3. Paste into `.env` file
4. Restart dev server


