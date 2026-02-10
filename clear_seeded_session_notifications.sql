-- =============================================================================
-- CLEAR SEEDED SESSION NOTIFICATIONS
-- =============================================================================
-- Run this in Supabase SQL Editor if you previously ran seed_all_notification_messages.sql
-- and vetters are seeing "Vetting Session Started" / "Vetter re-activated" even when
-- the Chief hasn't started a session.
--
-- This deletes the fake session notifications that were seeded. The app will create
-- the real ones when the Chief actually starts a session or re-activates a vetter.
-- =============================================================================

DELETE FROM public.notifications
WHERE title IN ('Vetting Session Started', 'Vetter re-activated');

SELECT '✅ Seeded session notifications cleared. Chief must Start Session to create real ones for vetters.' AS status;
