# Approved Papers Repository & Password Unlock System

## Overview
This document outlines the implementation plan for locking approved papers in a repository and automatically generating unlock passwords on the printing due date.

## Requirements
1. **During Approval**: Chief Examiner must specify a printing due date
2. **After Approval**: Paper is locked in "Approved Papers Repository"
3. **On Printing Date**: System automatically generates password and notifies Super Admin
4. **Super Admin Access**: Can unlock papers using the generated password

---

## Implementation Plan

### Phase 1: Database Schema Changes

#### 1.1 Update `exam_papers` Table
```sql
-- Add columns for printing date and lock mechanism
ALTER TABLE exam_papers
ADD COLUMN IF NOT EXISTS printing_due_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS unlock_password_hash TEXT,
ADD COLUMN IF NOT EXISTS password_generated_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS unlocked_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS unlocked_by UUID REFERENCES auth.users(id);

-- Create index for scheduled password generation queries
CREATE INDEX IF NOT EXISTS idx_exam_papers_printing_due_date 
ON exam_papers(printing_due_date) 
WHERE status = 'approved_for_printing' AND is_locked = TRUE AND unlock_password_hash IS NULL;

-- Create index for super admin repository queries
CREATE INDEX IF NOT EXISTS idx_exam_papers_approved_locked 
ON exam_papers(status, is_locked) 
WHERE status = 'approved_for_printing';
```

#### 1.2 Create Password Generation Log Table (Optional - for audit)
```sql
CREATE TABLE IF NOT EXISTS paper_unlock_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_paper_id UUID REFERENCES exam_papers(id) ON DELETE CASCADE,
  password_generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  password_hash TEXT NOT NULL,
  generated_by TEXT DEFAULT 'system', -- 'system' for auto-generated
  unlocked_at TIMESTAMP WITH TIME ZONE,
  unlocked_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_unlock_logs_exam_paper 
ON paper_unlock_logs(exam_paper_id);
```

---

### Phase 2: Backend Service Functions

#### 2.1 Update `approveExamForPrinting()` Function
**File**: `src/lib/examServices/chiefExaminerService.ts`

**Changes**:
- Add `printingDueDate: string` parameter (ISO date string)
- Set `printing_due_date` in database
- Set `is_locked = TRUE` after approval
- Store paper in approved repository

#### 2.2 Create Password Generation Service
**New File**: `src/lib/examServices/passwordService.ts`

**Functions**:
- `generateSecurePassword(length: number = 16)`: Generate cryptographically secure password
- `hashPassword(password: string)`: Hash password using bcrypt or similar
- `verifyPassword(password: string, hash: string)`: Verify password against hash

#### 2.3 Create Repository Service
**New File**: `src/lib/examServices/repositoryService.ts`

**Functions**:
- `getApprovedPapersRepository()`: Get all locked approved papers
- `unlockPaper(examPaperId: string, password: string, userId: string)`: Unlock paper with password
- `checkPasswordGenerationDue()`: Check which papers need passwords generated (for scheduled job)

---

### Phase 3: Scheduled Password Generation

#### 3.1 Supabase Edge Function (Recommended)
**New File**: `supabase/functions/generate-printing-passwords/index.ts`

**Purpose**: 
- Run daily (via Supabase Cron or pg_cron)
- Check `exam_papers` where `printing_due_date <= NOW()` and `unlock_password_hash IS NULL`
- Generate passwords for due papers
- Send notification to Super Admin with password

**Alternative**: Database Trigger + pg_cron
- Create PostgreSQL function that runs daily
- Generate passwords automatically
- Insert into notifications table for Super Admin

#### 3.2 Password Generation Logic
```typescript
// Pseudo-code
1. Query papers where printing_due_date <= NOW() AND unlock_password_hash IS NULL
2. For each paper:
   a. Generate secure password (16+ characters, alphanumeric + special chars)
   b. Hash password
   c. Update exam_papers.unlock_password_hash
   d. Update exam_papers.password_generated_at
   e. Log to paper_unlock_logs
   f. Create notification for Super Admin with plaintext password
```

---

### Phase 4: UI Modifications

#### 4.1 Approval Modal/Form Enhancement
**File**: `src/App.tsx` - `WorkflowOrchestration` component

**Changes**:
- Add date picker input for "Printing Due Date" when Chief Examiner clicks "Approve for Printing"
- Validate date is in the future
- Show confirmation modal with date before final approval

**UI Flow**:
1. Chief Examiner clicks "Approve for Printing"
2. Modal appears asking for:
   - Printing Due Date (date picker)
   - Notes (existing textarea)
3. On confirm, call `approveExamForPrinting(examPaperId, chiefExaminerId, notes, printingDueDate)`

#### 4.2 Super Admin Repository View
**New Component**: `src/components/ApprovedPapersRepository.tsx`

**Features**:
- List all approved papers (locked and unlocked)
- Show printing due date
- Show lock status (🔒 Locked / 🔓 Unlocked)
- Show password generation status
- Unlock form (password input + unlock button)
- Filter by status (All / Locked / Unlocked)
- Search by course code/name

**Integration**: Add to `SuperAdminDashboard.tsx` as new tab

---

### Phase 5: Password Notification System

#### 5.1 Notification Format
When password is generated, create notification for Super Admin:

```typescript
{
  user_id: superAdminId,
  title: 'Paper Unlock Password Generated',
  message: `Password generated for ${courseCode} - ${courseName}. Printing due: ${printingDueDate}. Password: ${plaintextPassword}`,
  type: 'info',
  related_exam_paper_id: examPaperId
}
```

**Security Consideration**: 
- Store password hash in database
- Send plaintext password ONLY in notification (one-time)
- Consider encrypting notification message if storing in database

---

### Phase 6: Unlock Mechanism

#### 6.1 Unlock Function
**File**: `src/lib/examServices/repositoryService.ts`

```typescript
async function unlockPaper(
  examPaperId: string,
  password: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  // 1. Fetch paper and verify it's locked
  // 2. Verify password against hash
  // 3. Update is_locked = FALSE
  // 4. Update unlocked_at and unlocked_by
  // 5. Log unlock event
  // 6. Return success
}
```

#### 6.2 Unlock UI
- Password input field
- "Unlock Paper" button
- Show success/error messages
- Refresh repository list after unlock

---

## File Structure

### New Files to Create:
1. `setup_approved_papers_repository.sql` - Database migrations
2. `src/lib/examServices/passwordService.ts` - Password generation/hashing
3. `src/lib/examServices/repositoryService.ts` - Repository operations
4. `src/components/ApprovedPapersRepository.tsx` - Super Admin UI
5. `supabase/functions/generate-printing-passwords/index.ts` - Scheduled job (if using Edge Functions)

### Files to Modify:
1. `src/lib/examServices/chiefExaminerService.ts` - Update `approveExamForPrinting()`
2. `src/App.tsx` - Update `handleApprove()` and approval UI
3. `src/components/SuperAdminDashboard.tsx` - Add repository tab
4. `src/lib/supabase.ts` - Update `ExamPaper` interface

---

## Security Considerations

1. **Password Storage**: 
   - Never store plaintext passwords
   - Use bcrypt or Argon2 for hashing
   - Salt passwords before hashing

2. **Password Transmission**:
   - Send plaintext password ONLY in notification (one-time)
   - Use HTTPS for all communications
   - Consider expiring notifications after 24 hours

3. **Access Control**:
   - Only Super Admins can unlock papers
   - Log all unlock attempts (successful and failed)
   - Rate limit unlock attempts

4. **Audit Trail**:
   - Log all password generations
   - Log all unlock events
   - Track who unlocked what and when

---

## Testing Checklist

- [ ] Chief Examiner can set printing due date during approval
- [ ] Paper is locked after approval
- [ ] Paper appears in Approved Papers Repository
- [ ] Password is generated on printing due date
- [ ] Super Admin receives notification with password
- [ ] Super Admin can unlock paper with correct password
- [ ] Unlock fails with incorrect password
- [ ] Unlock events are logged
- [ ] Password is hashed in database
- [ ] Repository shows correct lock/unlock status

---

## Implementation Order

1. **Step 1**: Database schema changes (SQL migrations)
2. **Step 2**: Update `approveExamForPrinting()` function
3. **Step 3**: Create password service (generation/hashing)
4. **Step 4**: Update approval UI with date picker
5. **Step 5**: Create repository service functions
6. **Step 6**: Create Super Admin repository component
7. **Step 7**: Implement scheduled password generation
8. **Step 8**: Add unlock functionality
9. **Step 9**: Testing and refinement

---

## Questions to Clarify

1. **Password Format**: 
   - Length? (recommend 16+ characters)
   - Character set? (alphanumeric + special chars?)
   - Should it be human-readable or random?

2. **Password Delivery**:
   - Only via notification? (since emails are deferred)
   - Should it be visible in Super Admin dashboard?
   - Should there be a "Regenerate Password" option?

3. **Unlock Behavior**:
   - Can papers be re-locked after unlocking?
   - Should unlock be permanent or temporary?
   - Should there be an unlock expiration?

4. **Repository Access**:
   - Only Super Admin?
   - Should Chief Examiner see locked papers?
   - Should there be read-only access for others?

5. **Scheduled Job**:
   - Run daily at specific time?
   - Check every hour?
   - Use Supabase Edge Functions or pg_cron?

---

## Next Steps

Once you approve this plan, I'll start implementing:
1. Database migrations
2. Backend service functions
3. UI components
4. Scheduled job setup

Let me know if you'd like any modifications to this plan!
