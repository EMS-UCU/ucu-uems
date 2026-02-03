-- Seed role consent agreements into the database
-- Run this in Supabase SQL Editor after creating the table

-- Insert or update Chief Examiner agreement
INSERT INTO public.role_consent_agreements (role, title, agreement_summary, full_agreement, version, effective_date)
VALUES (
  'Chief Examiner',
  'Chief Examiner Consent Agreement',
  'By accepting this agreement, I acknowledge that I have been assigned the Chief Examiner role for the Uganda Christian University Exam Management System. I commit to upholding the highest standards of academic integrity, ensuring compliance with UCU exam regulations, and maintaining strict confidentiality of unreleased exam content. I understand that I am responsible for the oversight of exam paper creation, vetting processes, and final approval decisions. I accept the consequences of any breach, including disciplinary action and role revocation.',
  'UGANDA CHRISTIAN UNIVERSITY - CHIEF EXAMINER CONSENT AGREEMENT
Version 1.0 | Effective Date: ' || CURRENT_DATE || '

1. ROLE ACKNOWLEDGMENT
I acknowledge that I have been formally assigned the Chief Examiner role for the Uganda Christian University Exam Management System (UCU-UEMS). I understand that this role carries significant responsibility for the integrity of the examination process.

2. COMMITMENTS
I commit to:
- Upholding the highest standards of academic integrity in all exam-related activities
- Ensuring strict compliance with UCU exam regulations and institutional policies
- Maintaining absolute confidentiality of unreleased exam content
- Exercising fair and consistent judgment when appointing setters, team leads, and vetters
- Overseeing vetting sessions with diligence and ensuring compliance with secure session rules
- Making approval and rejection decisions based solely on quality and regulatory compliance

3. MONITORING AND OVERSIGHT
I acknowledge that vetting sessions may involve monitoring of participant activity. I will use such monitoring only to ensure compliance and will treat all information obtained with strict confidentiality.

4. CONSEQUENCES OF BREACH
I understand that any breach of this agreement, UCU exam regulations, or misuse of my privileges may result in:
- Immediate revocation of the Chief Examiner role
- Disciplinary action in accordance with UCU policies
- Legal action where applicable

5. ACCEPTANCE
By accepting this agreement, I confirm that I have read, understood, and agree to be bound by its terms.',
  '1.0',
  CURRENT_DATE
)
ON CONFLICT (role) DO UPDATE SET
  title = EXCLUDED.title,
  agreement_summary = EXCLUDED.agreement_summary,
  full_agreement = EXCLUDED.full_agreement,
  version = EXCLUDED.version,
  effective_date = EXCLUDED.effective_date,
  updated_at = NOW();

-- Insert or update Team Lead agreement
INSERT INTO public.role_consent_agreements (role, title, agreement_summary, full_agreement, version, effective_date)
VALUES (
  'Team Lead',
  'Team Lead Consent Agreement',
  'By accepting this agreement, I acknowledge that I have been assigned the Team Lead role. I commit to coordinating exam draft submissions from setters, integrating documents according to UCU standards, and submitting compiled papers to the Chief Examiner in a timely manner. I understand the confidential nature of exam content and agree to comply with all UCU exam regulations. I accept responsibility for any breaches.',
  'UGANDA CHRISTIAN UNIVERSITY - TEAM LEAD CONSENT AGREEMENT
Version 1.0 | Effective Date: ' || CURRENT_DATE || '

1. ROLE ACKNOWLEDGMENT
I acknowledge that I have been formally assigned the Team Lead role for the Uganda Christian University Exam Management System (UCU-UEMS). I understand that I am responsible for coordinating setters and managing exam draft submissions.

2. COMMITMENTS
I commit to:
- Coordinating exam draft submissions from setters within specified deadlines
- Integrating multiple drafts into a single document according to UCU formatting standards
- Ensuring all setter contributions meet quality requirements before submission
- Submitting compiled papers to the Chief Examiner in a timely manner
- Maintaining strict confidentiality of all exam content
- Communicating clearly with setters regarding revisions and feedback

3. CONFIDENTIALITY
I understand that unreleased exam content is strictly confidential. I will not share, copy, or disclose any exam materials outside the approved workflow.

4. CONSEQUENCES OF BREACH
I understand that any breach may result in role revocation and disciplinary action.

5. ACCEPTANCE
By accepting this agreement, I confirm that I have read, understood, and agree to be bound by its terms.',
  '1.0',
  CURRENT_DATE
)
ON CONFLICT (role) DO UPDATE SET
  title = EXCLUDED.title,
  agreement_summary = EXCLUDED.agreement_summary,
  full_agreement = EXCLUDED.full_agreement,
  version = EXCLUDED.version,
  effective_date = EXCLUDED.effective_date,
  updated_at = NOW();

-- Insert or update Vetter agreement
INSERT INTO public.role_consent_agreements (role, title, agreement_summary, full_agreement, version, effective_date)
VALUES (
  'Vetter',
  'Vetter Consent Agreement',
  'By accepting this agreement, I acknowledge that I have been assigned the Vetter role. I understand that vetting sessions require camera activation and secure browser use. I consent to session monitoring and agree to comply with strict rules: no screenshots, no leaving the window, no tab switching. Violations may result in immediate session termination and access restriction. I commit to providing fair, constructive feedback on exam papers and maintaining confidentiality.',
  'UGANDA CHRISTIAN UNIVERSITY - VETTER CONSENT AGREEMENT
Version 1.0 | Effective Date: ' || CURRENT_DATE || '

1. ROLE ACKNOWLEDGMENT
I acknowledge that I have been formally assigned the Vetter role for the Uganda Christian University Exam Management System (UCU-UEMS). I understand that vetting involves reviewing exam papers and providing structured feedback.

2. CONSENT TO MONITORING
I expressly consent to:
- Camera activation during vetting sessions for identity verification and session integrity
- Secure browser enforcement that restricts screenshots, tab switching, and window changes
- Monitoring of my session activity by the Chief Examiner for compliance purposes

3. SESSION RULES
I agree to comply with the following during vetting sessions:
- No screenshots or screen captures of any exam content
- No switching away from the vetting window
- No opening new tabs or windows
- Maintaining camera connectivity throughout the session
I understand that violations will result in immediate session termination and access restriction until reinstated by the Chief Examiner.

4. COMMITMENTS
I commit to:
- Providing fair, constructive, and timely feedback on exam papers
- Maintaining strict confidentiality of all exam content
- Completing vetting within the allocated session time

5. CONSEQUENCES OF BREACH
I understand that breaches may result in session termination, access restriction, and disciplinary action.

6. ACCEPTANCE
By accepting this agreement, I confirm that I have read, understood, and agree to be bound by its terms.',
  '1.0',
  CURRENT_DATE
)
ON CONFLICT (role) DO UPDATE SET
  title = EXCLUDED.title,
  agreement_summary = EXCLUDED.agreement_summary,
  full_agreement = EXCLUDED.full_agreement,
  version = EXCLUDED.version,
  effective_date = EXCLUDED.effective_date,
  updated_at = NOW();

-- Insert or update Setter agreement
INSERT INTO public.role_consent_agreements (role, title, agreement_summary, full_agreement, version, effective_date)
VALUES (
  'Setter',
  'Setter Consent Agreement',
  'By accepting this agreement, I acknowledge that I have been assigned the Setter role. I commit to creating exam drafts within specified deadlines, following UCU formatting and quality standards, and submitting drafts through the approved workflow. I understand the confidential nature of exam content and agree to incorporate feedback from vetting. I accept responsibility for any breaches of regulations.',
  'UGANDA CHRISTIAN UNIVERSITY - SETTER CONSENT AGREEMENT
Version 1.0 | Effective Date: ' || CURRENT_DATE || '

1. ROLE ACKNOWLEDGMENT
I acknowledge that I have been formally assigned the Setter role for the Uganda Christian University Exam Management System (UCU-UEMS). I understand that I am responsible for creating initial exam drafts.

2. COMMITMENTS
I commit to:
- Creating exam drafts within specified deadline windows
- Submitting drafts through the approved workflow to the Team Lead or repository
- Following UCU formatting and quality standards
- Incorporating feedback from vetting and revision processes
- Maintaining strict confidentiality of all exam content
- Revising drafts promptly when requested

3. CONFIDENTIALITY
I understand that unreleased exam content is strictly confidential. I will not share or disclose any exam materials outside the approved workflow.

4. CONSEQUENCES OF BREACH
I understand that any breach may result in role revocation and disciplinary action.

5. ACCEPTANCE
By accepting this agreement, I confirm that I have read, understood, and agree to be bound by its terms.',
  '1.0',
  CURRENT_DATE
)
ON CONFLICT (role) DO UPDATE SET
  title = EXCLUDED.title,
  agreement_summary = EXCLUDED.agreement_summary,
  full_agreement = EXCLUDED.full_agreement,
  version = EXCLUDED.version,
  effective_date = EXCLUDED.effective_date,
  updated_at = NOW();

SELECT '✅ Role consent agreements seeded successfully.' AS status;
