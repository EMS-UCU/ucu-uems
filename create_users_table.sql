-- Create users table for UCU E-Exam Manager
-- Run this in your Supabase SQL Editor

-- First, make sure we're in the public schema
SET search_path TO public;

-- Drop table if it exists (to start fresh)
DROP TABLE IF EXISTS users CASCADE;

-- Create users table
CREATE TABLE users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  name TEXT NOT NULL,
  base_role TEXT NOT NULL CHECK (base_role IN ('Admin', 'Lecturer')),
  roles TEXT[] DEFAULT ARRAY[]::TEXT[],
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Enable Row Level Security (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies first
DROP POLICY IF EXISTS "Allow all operations" ON users;
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON users;

-- Create a new policy that allows all operations (for development)
-- For production, you should create more restrictive policies
CREATE POLICY "Allow all operations" ON users
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create a function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Verify the table was created
SELECT 'Table created successfully!' AS status;

-- ============================================
-- COMPLETE DATABASE SCHEMA FOR UCU E-EXAM MANAGER
-- ============================================

-- Update users table to support Super Admin
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS campus TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT;

-- Create exam_papers table
CREATE TABLE IF NOT EXISTS exam_papers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  course_code TEXT NOT NULL,
  course_name TEXT NOT NULL,
  semester TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  campus TEXT NOT NULL,
  setter_id UUID REFERENCES users(id) ON DELETE SET NULL,
  team_lead_id UUID REFERENCES users(id) ON DELETE SET NULL,
  chief_examiner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 
    'submitted_to_repository', 
    'integrated_by_team_lead', 
    'sent_to_chief_examiner',
    'appointed_for_vetting',
    'vetting_in_progress',
    'vetted_with_comments',
    'revision_in_progress',
    'resubmitted_to_chief_examiner',
    'approved_for_printing',
    'rejected_restart_process'
  )),
  version_number INTEGER DEFAULT 1,
  file_url TEXT,
  file_name TEXT,
  file_size BIGINT,
  submitted_at TIMESTAMP WITH TIME ZONE,
  deadline TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create moderation_lists table
CREATE TABLE IF NOT EXISTS moderation_lists (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_paper_id UUID REFERENCES exam_papers(id) ON DELETE CASCADE,
  course_outline TEXT NOT NULL,
  blooms_taxonomy_levels TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create vetting_sessions table
CREATE TABLE IF NOT EXISTS vetting_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_paper_id UUID REFERENCES exam_papers(id) ON DELETE CASCADE,
  chief_examiner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',
    'in_progress',
    'completed',
    'expired'
  )),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create vetting_assignments table (many-to-many: vetters to sessions)
CREATE TABLE IF NOT EXISTS vetting_assignments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vetting_session_id UUID REFERENCES vetting_sessions(id) ON DELETE CASCADE,
  vetter_id UUID REFERENCES users(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(vetting_session_id, vetter_id)
);

-- Create vetting_comments table
CREATE TABLE IF NOT EXISTS vetting_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vetting_session_id UUID REFERENCES vetting_sessions(id) ON DELETE CASCADE,
  vetter_id UUID REFERENCES users(id) ON DELETE SET NULL,
  comment_text TEXT NOT NULL,
  page_number INTEGER,
  question_number TEXT,
  comment_type TEXT CHECK (comment_type IN ('general', 'question_specific', 'formatting', 'content')),
  is_addressed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create exam_versions table (version history)
CREATE TABLE IF NOT EXISTS exam_versions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_paper_id UUID REFERENCES exam_papers(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  file_url TEXT NOT NULL,
  file_name TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(exam_paper_id, version_number)
);

-- Create workflow_timeline table
CREATE TABLE IF NOT EXISTS workflow_timeline (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_paper_id UUID REFERENCES exam_papers(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  description TEXT,
  from_status TEXT,
  to_status TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT CHECK (type IN ('info', 'warning', 'error', 'success', 'deadline')),
  is_read BOOLEAN DEFAULT FALSE,
  related_exam_paper_id UUID REFERENCES exam_papers(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create privilege_elevations table (track who elevated whom)
CREATE TABLE IF NOT EXISTS privilege_elevations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  elevated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  role_granted TEXT NOT NULL,
  granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  revoked_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT TRUE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_exam_papers_setter ON exam_papers(setter_id);
CREATE INDEX IF NOT EXISTS idx_exam_papers_team_lead ON exam_papers(team_lead_id);
CREATE INDEX IF NOT EXISTS idx_exam_papers_chief_examiner ON exam_papers(chief_examiner_id);
CREATE INDEX IF NOT EXISTS idx_exam_papers_status ON exam_papers(status);
CREATE INDEX IF NOT EXISTS idx_exam_papers_course ON exam_papers(course_code, semester, academic_year);
CREATE INDEX IF NOT EXISTS idx_vetting_sessions_exam ON vetting_sessions(exam_paper_id);
CREATE INDEX IF NOT EXISTS idx_vetting_assignments_vetter ON vetting_assignments(vetter_id);
CREATE INDEX IF NOT EXISTS idx_vetting_comments_session ON vetting_comments(vetting_session_id);
CREATE INDEX IF NOT EXISTS idx_workflow_timeline_exam ON workflow_timeline(exam_paper_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_privilege_elevations_user ON privilege_elevations(user_id, is_active);

-- Enable RLS on all tables
ALTER TABLE exam_papers ENABLE ROW LEVEL SECURITY;
ALTER TABLE moderation_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE vetting_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vetting_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE vetting_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_timeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE privilege_elevations ENABLE ROW LEVEL SECURITY;

-- Create policies for all tables (allow all for development)
DO $$
DECLARE
  table_name TEXT;
  tables TEXT[] := ARRAY[
    'exam_papers',
    'moderation_lists',
    'vetting_sessions',
    'vetting_assignments',
    'vetting_comments',
    'exam_versions',
    'workflow_timeline',
    'notifications',
    'privilege_elevations'
  ];
BEGIN
  FOREACH table_name IN ARRAY tables
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Allow all operations" ON %I', table_name);
    EXECUTE format('CREATE POLICY "Allow all operations" ON %I FOR ALL USING (true) WITH CHECK (true)', table_name);
  END LOOP;
END $$;

-- Add triggers for updated_at on all tables
CREATE TRIGGER update_exam_papers_updated_at
  BEFORE UPDATE ON exam_papers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Insert a super admin user (change credentials!)
-- Password: admin123 (change this!)
INSERT INTO users (username, email, name, base_role, roles, password_hash, is_super_admin)
VALUES 
  ('superadmin', 'superadmin@ucu.ac.ug', 'Super Administrator', 'Admin', ARRAY['Admin'], 'admin123', TRUE)
ON CONFLICT (username) DO NOTHING;

SELECT 'Complete database schema created successfully!' AS status;

