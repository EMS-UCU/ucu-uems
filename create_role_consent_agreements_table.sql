-- Role consent agreements - stores the agreement content for each role
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.role_consent_agreements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  role TEXT NOT NULL UNIQUE CHECK (role IN ('Chief Examiner', 'Team Lead', 'Vetter', 'Setter')),
  title TEXT NOT NULL,
  agreement_summary TEXT NOT NULL,
  full_agreement TEXT NOT NULL,
  version TEXT DEFAULT '1.0',
  effective_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_role_consent_agreements_role 
  ON public.role_consent_agreements(role);

ALTER TABLE public.role_consent_agreements ENABLE ROW LEVEL SECURITY;

-- Drop policies if they exist (so script can be re-run safely)
DROP POLICY IF EXISTS "Anyone can read role consent agreements" ON public.role_consent_agreements;
DROP POLICY IF EXISTS "Super admins can manage agreements" ON public.role_consent_agreements;

-- Anyone authenticated can read agreements (needed for users to see them)
CREATE POLICY "Anyone can read role consent agreements"
  ON public.role_consent_agreements FOR SELECT
  TO authenticated
  USING (true);

-- Only super admins can insert/update/delete agreements
CREATE POLICY "Super admins can manage agreements"
  ON public.role_consent_agreements FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_super_admin = TRUE
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_super_admin = TRUE
    )
  );

SELECT '✅ role_consent_agreements table created.' AS status;
