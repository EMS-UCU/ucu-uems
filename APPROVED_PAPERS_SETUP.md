# Approved Papers Repository - Setup Guide

## Overview
This system allows Chief Examiners to set printing due dates when approving papers. Papers are locked in a repository, and passwords are automatically generated on the printing due date and sent to Super Admins.

## Setup Steps

### 1. Database Migration
Run the SQL migration file in Supabase SQL Editor:
```bash
# File: setup_approved_papers_repository.sql
```
This creates:
- New columns in `exam_papers` table
- `paper_unlock_logs` table for audit trail
- Database functions for password generation checks
- Indexes for performance

### 2. Supabase Edge Function (Optional - for scheduled password generation)

#### Option A: Use Supabase Cron (Recommended)
1. Go to Supabase Dashboard → Database → Cron Jobs
2. Create a new cron job:
   - **Name**: `generate-printing-passwords`
   - **Schedule**: `0 0 * * *` (daily at midnight UTC)
   - **SQL**:
   ```sql
   SELECT net.http_post(
     url := 'https://YOUR_PROJECT_ID.supabase.co/functions/v1/generate-printing-passwords',
     headers := jsonb_build_object(
       'Content-Type', 'application/json',
       'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
     ),
     body := '{}'::jsonb
   );
   ```

#### Option B: Use pg_cron Extension
```sql
-- Enable pg_cron extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule the function
SELECT cron.schedule(
  'generate-printing-passwords',
  '0 0 * * *', -- Daily at midnight
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_ID.supabase.co/functions/v1/generate-printing-passwords',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

#### Option C: Manual Trigger (for testing)
You can manually trigger password generation by calling the Edge Function:
```bash
curl -X POST 'https://YOUR_PROJECT_ID.supabase.co/functions/v1/generate-printing-passwords' \
  -H 'Authorization: Bearer YOUR_ANON_KEY' \
  -H 'Content-Type: application/json'
```

### 3. Deploy Edge Function (if using scheduled job)
```bash
# Install Supabase CLI if not already installed
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref YOUR_PROJECT_ID

# Deploy the function
supabase functions deploy generate-printing-passwords
```

### 4. Verify Setup
1. **Test Approval Flow**:
   - Login as Chief Examiner
   - Approve a paper
   - Verify date/time picker appears
   - Set printing due date/time
   - Confirm paper is locked

2. **Test Password Generation**:
   - Set a printing due date/time in the past (for testing)
   - Manually trigger the Edge Function or wait for scheduled run
   - Check Super Admin notifications for password

3. **Test Unlock Flow**:
   - Login as Super Admin
   - Go to "Approved Papers" tab
   - Enter password from notification
   - Verify paper unlocks
   - Verify paper re-locks after 24 hours (or manually re-lock)

## Usage

### Chief Examiner - Approving Papers
1. Navigate to approval portal
2. Click "Approve for Printing"
3. Modal appears asking for:
   - **Printing Due Date**: Select date
   - **Printing Due Time**: Select time (e.g., 09:00)
4. Enter optional notes
5. Click "Confirm Approval"
6. Paper is locked and stored in repository

### Super Admin - Managing Repository
1. Navigate to Super Admin Dashboard
2. Click "Approved Papers" tab
3. View all approved papers (locked and unlocked)
4. Search/filter papers as needed
5. To unlock:
   - Click "Unlock Paper" on a locked paper
   - Enter password from notification
   - Paper unlocks for 24 hours
6. To re-lock:
   - Click "Re-lock" on an unlocked paper
   - Paper immediately locks again

## Features

### Automatic Password Generation
- Runs daily at midnight (configurable)
- Checks papers where `printing_due_date + printing_due_time <= NOW()`
- Generates secure 16-character passwords
- Sends notifications to all Super Admins

### Temporary Unlock
- Papers unlock for 24 hours by default
- Can be manually re-locked by Super Admin
- Automatically re-locks after expiry

### Security
- Passwords are hashed (never stored in plaintext)
- Passwords sent only via notifications (one-time)
- All unlock events logged for audit

## Troubleshooting

### Passwords Not Generating
1. Check Edge Function logs in Supabase Dashboard
2. Verify cron job is scheduled correctly
3. Check database function `check_and_generate_passwords` returns correct data
4. Verify Super Admin users exist (`is_super_admin = true`)

### Papers Not Locking
1. Check `approveExamForPrinting` function is called with date/time
2. Verify database migration ran successfully
3. Check browser console for errors

### Unlock Not Working
1. Verify password matches (case-sensitive)
2. Check password was generated (check `password_generated_at` field)
3. Verify Super Admin permissions
4. Check unlock logs in `paper_unlock_logs` table

## Database Schema

### New Columns in `exam_papers`:
- `printing_due_date` (TIMESTAMP WITH TIME ZONE)
- `printing_due_time` (TIME)
- `is_locked` (BOOLEAN)
- `unlock_password_hash` (TEXT)
- `password_generated_at` (TIMESTAMP WITH TIME ZONE)
- `unlocked_at` (TIMESTAMP WITH TIME ZONE)
- `unlocked_by` (UUID)
- `unlock_expires_at` (TIMESTAMP WITH TIME ZONE)

### New Table: `paper_unlock_logs`
- Audit trail for all password generations and unlocks
- Tracks who unlocked what and when

## API Reference

### Functions
- `getApprovedPapersRepository()`: Get all approved papers
- `generatePasswordForPaper(examPaperId)`: Manually generate password
- `unlockPaper(examPaperId, password, userId, durationHours)`: Unlock paper
- `reLockPaper(examPaperId, userId)`: Re-lock paper
- `checkAndReLockExpired()`: Re-lock expired temporary unlocks

## Notes

- Password generation happens automatically on the printing due date/time
- Super Admins receive notifications with plaintext passwords (one-time)
- Papers can be manually re-locked at any time
- Temporary unlocks expire after 24 hours (configurable)
- All operations are logged for audit purposes
