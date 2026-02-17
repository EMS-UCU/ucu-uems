-- Add RLS policy to allow Chief Examiners to read all consent acceptances
-- This enables the Chief Examiner Console to display accurate consent statuses
-- Run this in Supabase SQL Editor

-- Drop policy if it exists (so script can be re-run safely)
DROP POLICY IF EXISTS "Chief Examiners can read all consent acceptances" ON public.role_consent_acceptances;

-- Chief Examiners can read all consent acceptances (for displaying status in console)
CREATE POLICY "Chief Examiners can read all consent acceptances"
  ON public.role_consent_acceptances FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
      AND (
        user_profiles.is_super_admin = TRUE
        OR (
          user_profiles.roles IS NOT NULL
          AND (
            (user_profiles.roles::text LIKE '%Chief Examiner%')
            OR (user_profiles.roles::jsonb ? 'Chief Examiner')
            OR (
              CASE 
                WHEN jsonb_typeof(user_profiles.roles::jsonb) = 'array' 
                THEN user_profiles.roles::jsonb @> '["Chief Examiner"]'::jsonb
                ELSE false
              END
            )
          )
        )
      )
    )
  );

SELECT '✅ Chief Examiner consent read policy added.' AS status;
