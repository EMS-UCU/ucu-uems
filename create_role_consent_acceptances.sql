-- Role consent acceptances - tracks which users have accepted role-specific agreements
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.role_consent_acceptances (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('Chief Examiner', 'Team Lead', 'Vetter', 'Setter')),
  accepted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_role_consent_user_role 
  ON public.role_consent_acceptances(user_id, role);

ALTER TABLE public.role_consent_acceptances ENABLE ROW LEVEL SECURITY;

-- Drop policies if they exist (so script can be re-run safely)
DROP POLICY IF EXISTS "Users can read own consent records" ON public.role_consent_acceptances;
DROP POLICY IF EXISTS "Users can insert own consent" ON public.role_consent_acceptances;

-- Users can read their own consent records
CREATE POLICY "Users can read own consent records"
  ON public.role_consent_acceptances FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own consent (when accepting)
CREATE POLICY "Users can insert own consent"
  ON public.role_consent_acceptances FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own consent records (for upsert when accepting again)
CREATE POLICY "Users can update own consent"
  ON public.role_consent_acceptances FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Super admins can read all consent acceptances (for reporting)
CREATE POLICY "Super admins can read all consent acceptances"
  ON public.role_consent_acceptances FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_super_admin = TRUE
    )
  );

-- No update/delete needed - acceptances are immutable

SELECT '✅ role_consent_acceptances table created.' AS status;
