-- Multi-browser sync: store vetting session and moderation schedule in Supabase
-- so all tabs and browsers stay in sync via real-time subscriptions.

-- Table: single-row-per-key state (vetting_session, moderation_schedule)
CREATE TABLE IF NOT EXISTS public.moderation_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: allow authenticated users to read and write (all roles see same global state)
ALTER TABLE public.moderation_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read moderation_state" ON public.moderation_state;
CREATE POLICY "Allow authenticated read moderation_state"
  ON public.moderation_state FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Allow authenticated insert moderation_state" ON public.moderation_state;
CREATE POLICY "Allow authenticated insert moderation_state"
  ON public.moderation_state FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated update moderation_state" ON public.moderation_state;
CREATE POLICY "Allow authenticated update moderation_state"
  ON public.moderation_state FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Allow anon read so that unauthenticated loads don't fail (optional; remove if you want auth-only)
DROP POLICY IF EXISTS "Allow anon read moderation_state" ON public.moderation_state;
CREATE POLICY "Allow anon read moderation_state"
  ON public.moderation_state FOR SELECT
  TO anon
  USING (true);

-- Realtime: required for postgres_changes subscriptions (only add if not already in publication)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'moderation_state'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE moderation_state;
  END IF;
END $$;

-- Seed default keys so clients can upsert
INSERT INTO public.moderation_state (key, value, updated_at)
VALUES
  ('vetting_session', '{}', NOW()),
  ('moderation_schedule', '{}', NOW())
ON CONFLICT (key) DO NOTHING;
