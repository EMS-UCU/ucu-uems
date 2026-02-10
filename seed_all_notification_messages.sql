-- =============================================================================
-- SEED ALL NOTIFICATION MESSAGES FOR UCU E-EXAM MANAGER
-- =============================================================================
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Prerequisites: Run notifications_table_and_rls.sql first (and fix_notifications_foreign_key.sql if needed).
--
-- Run this script ONCE per environment. Running it again will insert duplicate rows per user.
--
-- Uses the table that notifications.user_id references (see FK). The notifications table
-- FK references user_profiles(id), so we select FROM public.user_profiles.
-- This script inserts one sample of every notification type for EACH user so dashboards
-- can display alerts. Real notifications are also created by the app when events occur.
-- =============================================================================

-- Insert one row per notification type per user (so every user sees all alert types on dashboard)
-- Types: info, warning, error, success, deadline
-- Table: user_profiles (matches notifications_user_id_fkey FK)

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id,
  'Privilege Elevated',
  'You have been assigned a new role. Check your permissions and workflow access.',
  'warning',
  false
FROM public.user_profiles u;

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id, 'Privilege Revoked', 'Your role has been revoked. Contact an administrator if this was a mistake.', 'warning', false
FROM public.user_profiles u;

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id, 'Chief Examiner Role Assigned', 'You have been elevated to Chief Examiner. You can now manage exam workflows and assign roles.', 'warning', false
FROM public.user_profiles u;

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id, 'Role Assigned', 'A role (Team Lead, Vetter, or Setter) was assigned to you or by you. Check workflow for details.', 'warning', false
FROM public.user_profiles u;

-- NOTE: Do NOT seed "Vetting Session Started" or "Vetter re-activated" - the app creates these when Chief starts session or re-activates a vetter.

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id, 'Vetter deactivated', 'A vetter was deactivated during vetting due to a violation. Re-activate them from the Vetter Monitoring Dashboard if needed.', 'error', false
FROM public.user_profiles u;

-- NOTE: "Vetter re-activated" is created by the app only when Chief re-activates a vetter.

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id, 'Session Expired', 'The current session has ended. All records have been saved.', 'warning', false
FROM public.user_profiles u;

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id, 'Vetting Session Expired', 'Vetting session time finished. All vetter records have been saved and cameras stopped.', 'warning', false
FROM public.user_profiles u;

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id, 'New Setter Draft Submitted', 'A setter has submitted a new draft for your review. Check Chief Examiner Console or Track Paper.', 'info', false
FROM public.user_profiles u;

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id, 'Team Lead Submission Received', 'Team Lead has submitted compiled work for a course. Awaiting Chief Examiner analysis before vetting.', 'info', false
FROM public.user_profiles u;

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id, 'Team Lead Submission Received - Action Required', 'Team Lead submitted work. Action required from Chief Examiner (review and start vetting when ready).', 'info', false
FROM public.user_profiles u;

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id, 'Vetting Completed', 'Vetting session has been completed. Comments and checklist are available. Forward to Team Lead for revision if needed.', 'success', false
FROM public.user_profiles u;

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id, 'Vetting Feedback Packet', 'Vetting session completed. Comments and checklist attached. Download from moderation workflow.', 'warning', false
FROM public.user_profiles u;

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id, 'Moderation Checklist Available', 'Chief Examiner has forwarded the moderation checklist with vetting feedback. You can download the moderation results.', 'info', false
FROM public.user_profiles u;

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id, 'Checklist Forwarded', 'Moderation checklist has been forwarded to Team Lead(s). They can now download the moderation results.', 'success', false
FROM public.user_profiles u;

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id, 'Modulation Results Received', 'Chief Examiner has sent sanitized modulation results. Please review and proceed with revisions.', 'info', false
FROM public.user_profiles u;

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id, 'Revisions Completed', 'Team Lead has completed revisions and submitted for final review. Chief Examiner may approve or reject.', 'info', false
FROM public.user_profiles u;

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id, 'Paper Approved', 'Paper has been approved for printing. Vetting was positive with no comments to address.', 'success', false
FROM public.user_profiles u;

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id, 'Paper Rejected - Revision Required', 'Paper was rejected. Revision required. Check rejection notes and resubmit after changes.', 'warning', false
FROM public.user_profiles u;

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id, 'Rejection Delivered', 'Rejection notification was sent to Team Lead(s). They can view feedback and resubmit.', 'success', false
FROM public.user_profiles u;

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id, 'Notification Failed', 'Failed to send one or more notifications. Check browser console or Supabase for details.', 'error', false
FROM public.user_profiles u;

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id, 'No Team Leads Found', 'No Team Lead found for this paper. Cannot send rejection. Assign a Team Lead first.', 'error', false
FROM public.user_profiles u;

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id, 'New Annotation Added', 'A new annotation was added during the vetting session. Check the checklist or moderation view.', 'info', false
FROM public.user_profiles u;

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id, 'New Exam Submission', 'New exam paper submitted. Check course code and course name in workflow.', 'info', false
FROM public.user_profiles u;

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id, 'Exams Integrated', 'Team Lead has integrated exam paper(s). Ready for Chief Examiner vetting appointment.', 'info', false
FROM public.user_profiles u;

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id, 'Exam Ready for Vetting', 'Team Lead has sent integrated exam for vetting appointment. Assign vetters and start session when ready.', 'info', false
FROM public.user_profiles u;

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id, 'Vetting Assignment', 'You have been assigned to vet an exam paper. Join the vetting session when Chief Examiner starts it.', 'info', false
FROM public.user_profiles u;

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id, 'Exam Approved', 'Exam paper has been approved for printing. Workflow complete for this paper.', 'success', false
FROM public.user_profiles u;

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id, 'Exam Rejected', 'Exam was rejected. Please restart the process or address the reason provided.', 'error', false
FROM public.user_profiles u;

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id, 'Revised Exam Submitted', 'Team Lead has resubmitted the revised exam for final approval. Chief Examiner may approve or reject.', 'info', false
FROM public.user_profiles u;

INSERT INTO public.notifications (user_id, title, message, type, is_read)
SELECT u.id, 'Deadline Reminder', 'A deadline is approaching. Check workflow or timetable for details.', 'deadline', false
FROM public.user_profiles u;

-- =============================================================================
SELECT '✅ All notification messages seeded. Every user in public.user_profiles now has one of each alert type. Check Table Editor → notifications.' AS status;
-- =============================================================================
