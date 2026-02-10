# Approval Status Column Migration

## Overview
Separated approval status from workflow/vetting status by introducing a new `approval_status` column.

## Problem
The `status` column in `exam_papers` was being used for two different purposes:
1. **Workflow/Vetting Status**: Tracks where the paper is in the vetting workflow (e.g., `vetted_with_comments`, `vetting_in_progress`, `integrated_by_team_lead`)
2. **Approval Status**: Tracks whether the paper is approved for printing (e.g., `approved_for_printing`)

This caused ambiguity because:
- A paper can be `vetted_with_comments` (workflow status) AND `approved_for_printing` (approval status) simultaneously
- The repository query was mixing these concepts
- It was unclear which status to check for different purposes

## Solution
Created a separate `approval_status` column specifically for approval-related statuses.

### Column Usage

**`status` column** (workflow/vetting status):
- `submitted_to_repository`
- `integrated_by_team_lead`
- `appointed_for_vetting`
- `vetting_in_progress`
- `vetted_with_comments`
- `resubmitted_to_chief_examiner`
- `revision_in_progress`
- `rejected_restart_process`

**`approval_status` column** (approval status):
- `approved_for_printing` (when Chief Examiner approves)
- `NULL` (when not approved)

## Migration Steps

### 1. Run Database Migration
Execute `add_approval_status_column.sql` in Supabase SQL Editor:
- Adds `approval_status` column
- Migrates existing data (if any papers have `status='approved_for_printing'`, copies to `approval_status`)
- Updates indexes and functions

### 2. Code Changes Made

**Files Updated:**
- `src/lib/examServices/chiefExaminerService.ts`
  - `approveExamForPrinting()` now sets `approval_status` instead of `status`
  - Verification query uses `approval_status`

- `src/lib/examServices/repositoryService.ts`
  - `getApprovedPapersRepository()` queries by `approval_status` instead of `status`
  - Diagnostic queries include both `status` and `approval_status`

- `src/lib/supabase.ts`
  - Added `approval_status?: string` to `ExamPaper` interface

- `setup_approved_papers_repository.sql` (via migration)
  - Updated `check_and_generate_passwords()` function to use `approval_status`
  - Updated indexes to use `approval_status`

- `supabase/functions/generate-printing-passwords/index.ts`
  - Updated comment to note it uses `approval_status`

## How It Works Now

### Approval Flow
1. Chief Examiner approves paper → Sets `approval_status = 'approved_for_printing'` (workflow `status` remains unchanged, e.g., `vetted_with_comments`)
2. Paper is locked → `is_locked = true`
3. Repository query → Filters by `approval_status = 'approved_for_printing'`
4. Password generation → Checks `approval_status = 'approved_for_printing'`

### Benefits
- **Clear separation**: Workflow status and approval status are distinct
- **No conflicts**: Paper can be vetted (`vetted_with_comments`) and approved (`approved_for_printing`) simultaneously
- **Better queries**: Repository queries are unambiguous
- **Future-proof**: Can add more approval statuses (e.g., `rejected`, `pending_approval`) without affecting workflow status

## Testing Checklist

After migration:
- [ ] Run `add_approval_status_column.sql` in Supabase SQL Editor
- [ ] Verify `approval_status` column exists in `exam_papers` table
- [ ] Approve a paper as Chief Examiner
- [ ] Verify `approval_status = 'approved_for_printing'` is set in database
- [ ] Verify workflow `status` remains unchanged (e.g., still `vetted_with_comments`)
- [ ] Open Super Admin → Approved Papers Repository
- [ ] Verify approved paper appears in repository
- [ ] Check console logs show `approval_status` in diagnostic queries

## Notes

- **Workflow events**: Still use `to_status: 'approved_for_printing'` - this is fine as it's a historical record
- **UI status mapping**: Still maps workflow `status` to UI statuses (`'vetted'`, `'in-vetting'`, etc.) - this is correct
- **Backward compatibility**: Migration script copies existing `status='approved_for_printing'` to `approval_status`
