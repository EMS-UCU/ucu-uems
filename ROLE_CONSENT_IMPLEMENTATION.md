# Role Consent Agreements Implementation

## Overview
This implementation ensures that **every time** a user with workflow roles (Chief Examiner, Team Lead, Vetter, or Setter) logs in, they are presented with a consent agreement popup that they must accept or decline.

## Architecture

### Database-Driven Approach (Similar to Notifications)
- **Agreements stored in database**: `role_consent_agreements` table
- **Acceptances tracked**: `role_consent_acceptances` table
- **Automatic fetching**: Agreements are fetched from the database when the modal opens
- **No hardcoded content**: All agreement text comes from Supabase

## Database Setup

### Step 1: Create the Agreements Table
Run `create_role_consent_agreements_table.sql` in Supabase SQL Editor:
- Creates `role_consent_agreements` table
- Stores agreement content (title, summary, full text) for each role
- Sets up RLS policies (authenticated users can read, super admins can manage)

### Step 2: Seed the Agreements
Run `seed_role_consent_agreements.sql` in Supabase SQL Editor:
- Inserts all 4 role agreements (Chief Examiner, Team Lead, Vetter, Setter)
- Safe to re-run (uses `ON CONFLICT`)

### Step 3: Ensure Acceptances Table Exists
Run `create_role_consent_acceptances.sql` in Supabase SQL Editor:
- Creates table to track user acceptances
- Includes super admin policy for reporting

## How It Works

### 1. Login Flow
When a user logs in:
1. `handleLogin()` sets `authUserId`
2. `useEffect` detects `authUserId` change
3. `checkRoleConsent()` is called
4. Fetches user roles from database
5. Checks if user has workflow roles
6. If yes → shows consent modal

### 2. Session Restore Flow
When page loads/refreshes:
1. `restoreSession()` checks for existing Supabase session
2. If session exists → sets `authUserId`
3. Same flow as login → consent modal appears

### 3. Modal Display
- Modal fetches agreements from database automatically
- Shows one agreement at a time (if user has multiple roles)
- User must accept or decline each agreement
- Cannot be dismissed (no clicking outside, no Escape key)

### 4. Accept Flow
- User clicks "I Accept"
- Acceptance is recorded in `role_consent_acceptances` table
- If multiple roles → shows next agreement
- When all accepted → modal closes, user can use system

### 5. Decline Flow
- User clicks "I Decline"
- Confirmation dialog appears
- If confirmed → user is logged out
- Error message shown: "You have declined the terms and conditions..."

## Key Features

✅ **Shows on EVERY login** - Not just first time, every single login
✅ **Database-driven** - All content from Supabase, no hardcoded text
✅ **Cannot be bypassed** - Modal blocks all interaction until resolved
✅ **Multiple roles support** - Shows agreements sequentially if user has multiple roles
✅ **Proper error handling** - Shows helpful messages if agreements missing
✅ **Logging** - Console logs help debug issues

## Files Modified/Created

### New Files
- `create_role_consent_agreements_table.sql` - Creates agreements table
- `seed_role_consent_agreements.sql` - Seeds agreement content
- `src/lib/roleConsentAgreementService.ts` - Service to fetch agreements
- `ROLE_CONSENT_IMPLEMENTATION.md` - This file

### Modified Files
- `src/App.tsx` - Added consent check on login/session restore
- `src/components/ConsentAgreementModal.tsx` - Fetches from database, shows Accept/Decline
- `create_role_consent_acceptances.sql` - Added super admin policy

## Testing Checklist

1. ✅ Run SQL scripts in Supabase
2. ✅ Login as user with Chief Examiner role → Modal should appear
3. ✅ Accept agreement → Should record acceptance and close modal
4. ✅ Logout and login again → Modal should appear again (every login)
5. ✅ Login as user with multiple roles → Should show agreements sequentially
6. ✅ Decline agreement → Should log out user
7. ✅ Refresh page while logged in → Modal should appear (session restore)

## Troubleshooting

### Modal Not Appearing
- Check browser console for logs (look for 🔍, ✅, ❌ emojis)
- Verify user has workflow roles in `user_profiles.roles`
- Verify agreements exist in `role_consent_agreements` table
- Check RLS policies allow reading agreements

### Agreements Not Loading
- Check `role_consent_agreements` table has data
- Verify RLS policy allows authenticated users to read
- Check browser console for errors
- Verify Supabase connection is working

### Modal Stuck in Loading
- Check network tab for failed requests
- Verify agreements table exists and has data
- Check RLS policies

## Console Logs to Watch

When working correctly, you should see:
```
🔄 authUserId changed, checking role consent...
🔍 Checking role consent for user: [user-id]
📋 User roles: [array of roles]
✅ User workflow roles: [Chief Examiner, etc.]
📝 Showing consent modal for roles: [roles]
📥 Loading consent agreements for roles: [roles]
✅ Loaded agreements: [roles]
✅ Accepting agreement for role: Chief Examiner
✅ Agreement accepted successfully
```

## Future Enhancements

- Admin interface to edit agreements (currently requires SQL)
- Version tracking for agreements
- Email notifications when agreements are updated
- Analytics on acceptance rates
