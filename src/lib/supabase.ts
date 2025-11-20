import { createClient } from '@supabase/supabase-js';

// Get Supabase URL and Anon Key from environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Log configuration (without exposing the full key)
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Supabase credentials not found!');
  console.error('Please create a .env file in the project root with:');
  console.error('VITE_SUPABASE_URL=https://your-project-id.supabase.co');
  console.error('VITE_SUPABASE_ANON_KEY=your-anon-key-here');
  console.error('');
  console.error('Get these from: Supabase Dashboard → Settings → API');
} else {
  console.log('✅ Supabase configured');
  console.log('URL:', supabaseUrl);
  console.log('Key:', supabaseAnonKey.substring(0, 20) + '...');
}

// Create Supabase client with options
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  db: {
    schema: 'public',
  },
  auth: {
    persistSession: true, // Changed to true - allows session to persist
    autoRefreshToken: true, // Changed to true - allows token refresh
    detectSessionInUrl: true, // Detect auth callbacks
  },
  global: {
    headers: {
      'x-client-info': 'ucu-uems',
    },
  },
});

// Database types
export interface DatabaseUser {
  id: string;
  email?: string;
  username: string;
  name: string;
  base_role: 'Admin' | 'Lecturer';
  roles: string[];
  password_hash: string;
  is_super_admin?: boolean;
  campus?: string;
  department?: string;
  course_unit?: string | null;
  lecturer_category?: 'Undergraduate' | 'Postgraduate';
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  username: string;
  name: string;
  baseRole: 'Admin' | 'Lecturer';
  roles: string[];
  email?: string;
  isSuperAdmin?: boolean;
  campus?: string;
  department?: string;
  courseUnit?: string;
  lecturerCategory?: 'Undergraduate' | 'Postgraduate';
}

// Exam Paper types
export interface ExamPaper {
  id: string;
  course_code: string;
  course_name: string;
  semester: string;
  academic_year: string;
  campus: string;
  setter_id?: string;
  team_lead_id?: string;
  chief_examiner_id?: string;
  status: ExamPaperStatus;
  version_number: number;
  file_url?: string;
  file_name?: string;
  file_size?: number;
  submitted_at?: string;
  deadline?: string;
  created_at: string;
  updated_at: string;
}

export type ExamPaperStatus =
  | 'draft'
  | 'submitted_to_repository'
  | 'integrated_by_team_lead'
  | 'sent_to_chief_examiner'
  | 'appointed_for_vetting'
  | 'vetting_in_progress'
  | 'vetted_with_comments'
  | 'revision_in_progress'
  | 'resubmitted_to_chief_examiner'
  | 'approved_for_printing'
  | 'rejected_restart_process';

export interface ModerationList {
  id: string;
  exam_paper_id: string;
  course_outline: string;
  blooms_taxonomy_levels?: string[];
  created_at: string;
}

export interface VettingSession {
  id: string;
  exam_paper_id: string;
  chief_examiner_id?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'expired' | 'cancelled';
  started_at?: string;
  completed_at?: string;
  expires_at?: string;
  recording_url?: string;
  recording_file_path?: string;
  recording_file_size?: number;
  recording_duration_seconds?: number;
  recording_started_at?: string;
  recording_completed_at?: string;
  created_at: string;
}

export interface VettingAssignment {
  id: string;
  vetting_session_id: string;
  vetter_id: string;
  assigned_by?: string;
  assigned_at: string;
}

export interface VettingComment {
  id: string;
  vetting_session_id: string;
  vetter_id?: string;
  comment_text: string;
  page_number?: number;
  question_number?: string;
  comment_type?: 'general' | 'question_specific' | 'formatting' | 'content';
  is_addressed: boolean;
  created_at: string;
}

export interface ExamVersion {
  id: string;
  exam_paper_id: string;
  version_number: number;
  file_url: string;
  file_name?: string;
  created_by?: string;
  notes?: string;
  created_at: string;
}

export interface WorkflowTimelineEntry {
  id: string;
  exam_paper_id: string;
  actor_id?: string;
  action: string;
  description?: string;
  from_status?: string;
  to_status?: string;
  metadata?: Record<string, any>;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success' | 'deadline';
  is_read: boolean;
  related_exam_paper_id?: string;
  created_at: string;
}

export interface PrivilegeElevation {
  id: string;
  user_id: string;
  elevated_by?: string;
  role_granted: string;
  granted_at: string;
  revoked_at?: string;
  is_active: boolean;
  metadata?: {
    faculty?: string;
    department?: string;
    course?: string;
    semester?: string;
    year?: string;
  } | Record<string, any>;
}


