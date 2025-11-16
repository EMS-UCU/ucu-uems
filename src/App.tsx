import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { motion } from 'framer-motion';
import {
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  Cell,
} from 'recharts';
import HomePage from './HomePage';
import { authenticateUser, getAllUsers } from './lib/auth';
import SuperAdminDashboard from './components/SuperAdminDashboard';
import LecturerDashboard from './components/LecturerDashboard';
import PrivilegeElevationPanel from './components/PrivilegeElevationPanel';
import { supabase } from './lib/supabase';
import { elevateToChiefExaminer, appointRole } from './lib/privilegeElevation';
import { createNotification, getUserNotifications } from './lib/examServices/notificationService';

type BaseRole = 'Admin' | 'Lecturer';
type Role =
  | 'Admin'
  | 'Lecturer'
  | 'Chief Examiner'
  | 'Team Lead'
  | 'Vetter'
  | 'Setter';

type WorkflowStage =
  | 'Awaiting Setter'
  | 'Submitted to Team Lead'
  | 'Compiled for Vetting'
  | 'Vetting in Progress'
  | 'Vetting Session Expired'
  | 'Vetted & Returned to Chief Examiner'
  | 'Sanitized for Revision'
  | 'Revision Complete'
  | 'Awaiting Approval'
  | 'Approved'
  | 'Rejected';

interface PanelConfig {
  id: string;
  label: string;
  visible: boolean;
  render: () => ReactNode;
}

interface User {
  id: string;
  name: string;
  baseRole: BaseRole;
  roles: Role[];
  password: string;
  email?: string;
  isSuperAdmin?: boolean;
  campus?: string;
  department?: string;
  courseUnit?: string;
  lecturerCategory?: 'Undergraduate' | 'Postgraduate';
}

interface AppNotification {
  id: string;
  message: string;
  timestamp: string;
  read: boolean;
}

interface TimelineEvent {
  id: string;
  timestamp: string;
  actor: string;
  message: string;
  stage: WorkflowStage;
}

interface WorkflowDecision {
  type: 'Approved' | 'Rejected';
  actor: string;
  timestamp: string;
  notes?: string;
}

interface WorkflowState {
  stage: WorkflowStage;
  timeline: TimelineEvent[];
  currentVersion: number;
  portalOpen: boolean;
  awaitingRecycle: boolean;
  lastDecision?: WorkflowDecision;
}

interface VersionHistoryEntry {
  id: string;
  majorVersion: number;
  sequence: number;
  versionLabel: string;
  actor: string;
  notes: string;
  timestamp: string;
}

interface VettingSessionState {
  active: boolean;
  startedAt?: number;
  durationMinutes?: number;
  expiresAt?: number;
  safeBrowserEnabled: boolean;
  cameraOn: boolean;
  screenshotBlocked: boolean;
  switchingLocked: boolean;
  lastClosedReason?: 'completed' | 'expired' | 'cancelled';
}

interface DestructionLogEntry {
  id: string;
  versionLabel: string;
  timestamp: string;
  details: string;
}

interface SubmittedPaper {
  id: string;
  fileName: string;
  submittedBy: string;
  submittedAt: string;
  fileSize?: number;
  status: 'submitted' | 'in-vetting' | 'vetted' | 'approved';
}

interface SetterSubmission {
  id: string;
  fileName: string;
  submittedBy: string;
  submittedAt: string;
  fileContent?: string;
}

interface Annotation {
  id: string;
  author: string;
  comment: string;
  timestamp: string;
}

const DEFAULT_PASSWORD = 'user123';
const defaultLecturerModules = [
  'Lecturer Dashboard',
  'My Classes',
  'Scheduling',
  'Enter Marks',
  'Search Student',
  'Monthly Reports',
  'Account Settings',
];

interface RolePrivilege {
  id: string;
  name: string;
  description: string;
  category: string;
}

interface RolePrivilegeSet {
  role: Role;
  privileges: RolePrivilege[];
  panelCount: number;
  totalPrivileges: number;
}

const rolePrivileges: Record<Role, RolePrivilegeSet> = {
  'Lecturer': {
    role: 'Lecturer',
    panelCount: 7,
    totalPrivileges: 12,
    privileges: [
      { id: 'lect-dash', name: 'View Dashboard', description: 'Access teaching dashboard with overview', category: 'Dashboard' },
      { id: 'lect-classes', name: 'Manage Classes', description: 'View and manage assigned classes', category: 'Teaching' },
      { id: 'lect-schedule', name: 'Schedule Management', description: 'Create and manage class schedules', category: 'Teaching' },
      { id: 'lect-marks', name: 'Enter Marks', description: 'Record student assessment marks', category: 'Assessment' },
      { id: 'lect-search', name: 'Search Students', description: 'Lookup student records and profiles', category: 'Student Management' },
      { id: 'lect-reports', name: 'Generate Reports', description: 'Create monthly and academic reports', category: 'Reporting' },
      { id: 'lect-settings', name: 'Account Settings', description: 'Manage personal account and preferences', category: 'Account' },
      { id: 'lect-view-grades', name: 'View Grade Distribution', description: 'Access grade analytics and distributions', category: 'Assessment' },
      { id: 'lect-upload', name: 'Upload Materials', description: 'Upload lecture materials and resources', category: 'Teaching' },
      { id: 'lect-attendance', name: 'Track Attendance', description: 'Record and view student attendance', category: 'Student Management' },
      { id: 'lect-communication', name: 'Student Communication', description: 'Send messages and announcements', category: 'Communication' },
      { id: 'lect-export', name: 'Export Data', description: 'Export class and student data', category: 'Reporting' },
    ],
  },
  'Chief Examiner': {
    role: 'Chief Examiner',
    panelCount: 8,
    totalPrivileges: 19,
    privileges: [
      { id: 'ce-orchestrate', name: 'Orchestration Console', description: 'Full workflow orchestration control', category: 'Workflow' },
      { id: 'ce-award-roles', name: 'Award Roles', description: 'Assign Team Lead, Vetter, Setter roles', category: 'Role Management' },
      { id: 'ce-repositories', name: 'Manage Repositories', description: 'Open/close semester repositories', category: 'System Control' },
      { id: 'ce-deadlines', name: 'Control Deadlines', description: 'Toggle deadline windows', category: 'System Control' },
      { id: 'ce-approve', name: 'Final Approval', description: 'Approve or reject workflow submissions', category: 'Workflow' },
      { id: 'ce-sanitize', name: 'Sanitize & Forward', description: 'Sanitize vetted content and forward', category: 'Workflow' },
      { id: 'ce-portal', name: 'Open Approval Portal', description: 'Open portal for final approvals', category: 'Workflow' },
      { id: 'ce-download', name: 'Download Moderation', description: 'Download moderated exam packages', category: 'System Control' },
      { id: 'ce-restart', name: 'Restart Workflow', description: 'Restart workflow cycle if needed', category: 'Workflow' },
      { id: 'ce-view-all', name: 'View All Accounts', description: 'View all system users and roles', category: 'Administration' },
      { id: 'ce-timeline', name: 'View Timeline', description: 'Access complete workflow timeline', category: 'Workflow' },
      { id: 'ce-annotations', name: 'View Annotations', description: 'Access all vetting annotations', category: 'Workflow' },
      { id: 'ce-version', name: 'Version Management', description: 'View version history and labels', category: 'Workflow' },
      { id: 'ce-mask', name: 'Mask Footprints', description: 'Mask moderator identification', category: 'Security' },
      { id: 'ce-ai-similarity', name: 'AI Similarity Detection', description: 'Compare submitted papers with historical papers using AI', category: 'Academic Integrity' },
      { id: 'ce-lecturer', name: 'All Lecturer Privileges', description: 'Full access to all lecturer features', category: 'Teaching' },
      { id: 'ce-reports', name: 'System Reports', description: 'Generate system-wide reports', category: 'Reporting' },
      { id: 'ce-audit', name: 'Audit Trail Access', description: 'View complete audit logs', category: 'Administration' },
      { id: 'ce-settings', name: 'System Settings', description: 'Configure system parameters', category: 'Administration' },
    ],
  },
  'Admin': {
    role: 'Admin',
    panelCount: 6,
    totalPrivileges: 18,
    privileges: [
      { id: 'admin-add-lecturer', name: 'Create Lecturers', description: 'Register new lecturer accounts', category: 'User Management' },
      { id: 'admin-add-admin', name: 'Create Admins', description: 'Provision additional administrators', category: 'User Management' },
      { id: 'su-chief-role', name: 'Manage Chief Examiner', description: 'Enable and assign Chief Examiner role', category: 'Role Management' },
      { id: 'su-view-accounts', name: 'View All Accounts', description: 'View all system users and their roles', category: 'User Management' },
      { id: 'su-manage-users', name: 'Manage Users', description: 'Edit, disable, or delete user accounts', category: 'User Management' },
      { id: 'su-system-stats', name: 'System Statistics', description: 'View system-wide statistics and metrics', category: 'Administration' },
      { id: 'su-audit-log', name: 'Audit Log Access', description: 'View complete system audit logs', category: 'Administration' },
      { id: 'su-workflow-control', name: 'Workflow Control', description: 'Override and control workflow stages', category: 'Workflow' },
      { id: 'su-role-assignment', name: 'Role Assignment', description: 'Assign any role to any user', category: 'Role Management' },
      { id: 'su-security', name: 'Security Settings', description: 'Configure security policies', category: 'Security' },
      { id: 'su-backup', name: 'System Backup', description: 'Create and restore system backups', category: 'Administration' },
      { id: 'su-notifications', name: 'System Notifications', description: 'Send system-wide notifications', category: 'Administration' },
      { id: 'su-reports', name: 'System Reports', description: 'Generate comprehensive system reports', category: 'Reporting' },
      { id: 'su-settings', name: 'System Configuration', description: 'Configure system-wide settings', category: 'Administration' },
      { id: 'su-all-privileges', name: 'All Privileges', description: 'Inherit all privileges from all roles', category: 'Administration' },
    ],
  },
  'Team Lead': {
    role: 'Team Lead',
    panelCount: 2,
    totalPrivileges: 6,
    privileges: [
      { id: 'tl-compile', name: 'Compile Drafts', description: 'Collect and compile setter submissions', category: 'Workflow' },
      { id: 'tl-integrate', name: 'Integrate Revisions', description: 'Integrate sanitized revisions', category: 'Workflow' },
      { id: 'tl-forward', name: 'Forward to Vetting', description: 'Push compiled drafts to vetting', category: 'Workflow' },
      { id: 'tl-view', name: 'View Workflow', description: 'Access workflow execution panel', category: 'Workflow' },
      { id: 'tl-lecturer', name: 'All Lecturer Privileges', description: 'Full access to lecturer features', category: 'Teaching' },
      { id: 'tl-coordinate', name: 'Coordinate Team', description: 'Coordinate with setters and vetters', category: 'Workflow' },
    ],
  },
  'Vetter': {
    role: 'Vetter',
    panelCount: 2,
    totalPrivileges: 5,
    privileges: [
      { id: 'vet-session', name: 'Vetting Sessions', description: 'Join safe-browser vetting sessions', category: 'Workflow' },
      { id: 'vet-annotate', name: 'Annotate Documents', description: 'Add collaborative annotations', category: 'Workflow' },
      { id: 'vet-return', name: 'Return Comments', description: 'Return sanitized comments', category: 'Workflow' },
      { id: 'vet-view', name: 'View Vetting Suite', description: 'Access vetting interface', category: 'Workflow' },
      { id: 'vet-lecturer', name: 'All Lecturer Privileges', description: 'Full access to lecturer features', category: 'Teaching' },
    ],
  },
  'Setter': {
    role: 'Setter',
    panelCount: 2,
    totalPrivileges: 4,
    privileges: [
      { id: 'set-submit', name: 'Submit Drafts', description: 'Submit exam drafts within deadline', category: 'Workflow' },
      { id: 'set-view', name: 'View Workflow', description: 'Access workflow execution panel', category: 'Workflow' },
      { id: 'set-deadline', name: 'Deadline Tracking', description: 'View and track submission deadlines', category: 'Workflow' },
      { id: 'set-lecturer', name: 'All Lecturer Privileges', description: 'Full access to lecturer features', category: 'Teaching' },
    ],
  },
};

const roleToPanelIdMap: Partial<Record<Role, string>> = {
  'Admin': 'admin-add-lecturer',
  Lecturer: 'lecturer-dashboard',
  'Chief Examiner': 'chief-examiner-console',
  'Team Lead': 'workflow-execution',
  Vetter: 'vetting-suite',
  Setter: 'workflow-execution',
};

const initialUsers: User[] = [
  {
    id: 'admin-1',
    name: 'Prof. Wambui Njoroge',
    baseRole: 'Admin',
    roles: ['Admin'],
    password: DEFAULT_PASSWORD,
  },
  {
    id: 'lecturer-1',
    name: 'Dr. Achieng Odhiambo',
    baseRole: 'Lecturer',
    roles: ['Lecturer'],
    password: DEFAULT_PASSWORD,
  },
  {
    id: 'lecturer-2',
    name: 'Dr. Brian Muturi',
    baseRole: 'Lecturer',
    roles: ['Lecturer'],
    password: DEFAULT_PASSWORD,
  },
  {
    id: 'lecturer-3',
    name: 'Dr. Catherine Wekesa',
    baseRole: 'Lecturer',
    roles: ['Lecturer'],
    password: DEFAULT_PASSWORD,
  },
  {
    id: 'lecturer-4',
    name: 'Dr. Daniel Mburu',
    baseRole: 'Lecturer',
    roles: ['Lecturer'],
    password: DEFAULT_PASSWORD,
  },
  {
    id: 'lecturer-5',
    name: 'Dr. Esther Maina',
    baseRole: 'Lecturer',
    roles: ['Lecturer'],
    password: DEFAULT_PASSWORD,
  },
  {
    id: 'lecturer-6',
    name: 'Dr. Francis Kimani',
    baseRole: 'Lecturer',
    roles: ['Lecturer'],
    password: DEFAULT_PASSWORD,
  },
  {
    id: 'lecturer-7',
    name: 'Dr. Grace Ouma',
    baseRole: 'Lecturer',
    roles: ['Lecturer'],
    password: DEFAULT_PASSWORD,
  },
  {
    id: 'lecturer-8',
    name: 'Dr. Henry Kibet',
    baseRole: 'Lecturer',
    roles: ['Lecturer'],
    password: DEFAULT_PASSWORD,
  },
  {
    id: 'lecturer-9',
    name: 'Dr. Irene Atieno',
    baseRole: 'Lecturer',
    roles: ['Lecturer'],
    password: DEFAULT_PASSWORD,
  },
  {
    id: 'lecturer-10',
    name: 'Dr. Joseph Mworia',
    baseRole: 'Lecturer',
    roles: ['Lecturer'],
    password: DEFAULT_PASSWORD,
  },
  {
    id: 'lecturer-11',
    name: 'Dr. Leah Adero',
    baseRole: 'Lecturer',
    roles: ['Lecturer'],
    password: DEFAULT_PASSWORD,
  },
];

const initialWorkflow: WorkflowState = {
  stage: 'Awaiting Setter',
  timeline: [
    {
      id: 'initial-timeline',
      actor: 'System',
      message:
        'Workflow initialised. Awaiting setter to submit the semester paper draft.',
      stage: 'Awaiting Setter',
      timestamp: new Date().toISOString(),
    },
  ],
  currentVersion: 1,
  portalOpen: false,
  awaitingRecycle: false,
};

const initialVersionHistory: VersionHistoryEntry[] = [
  {
    id: 'version-1-0',
    majorVersion: 1,
    sequence: 1,
    versionLabel: 'v1.1',
    actor: 'System',
    notes: 'Workflow initialised for semester paper cycle.',
    timestamp: new Date().toISOString(),
  },
];

const emptyVettingSession: VettingSessionState = {
  active: false,
  safeBrowserEnabled: false,
  cameraOn: false,
  screenshotBlocked: false,
  switchingLocked: false,
};

const safeBrowserPolicies = [
  'Camera stream locked on and monitored',
  'Screenshots and recordings disabled',
  'Tab switching blocked while session is active',
  'Secure timer enforces automatic logout on expiry',
];

const digitalChecklist = {
  courseOutline: [
    'Coverage of core topics for the semester',
    'Inclusion of emerging issues and contextualised examples',
    'Alignment with departmental learning outcomes',
  ],
  bloomsTaxonomy: [
    'Remember: Foundational recall questions present',
    'Understand: Conceptual interpretation items',
    'Apply: Problem-solving scenarios included',
    'Analyse: Comparative or breakdown questions',
    'Evaluate: Critical judgement components',
    'Create: Synthesis or design-oriented prompts where appropriate',
  ],
  compliance: [
    'Marking scheme references cross-checked',
    'Academic integrity statements embedded',
    'Formatting adheres to faculty print standards',
  ],
};

const createId = (() => {
  let counter = 0;
  return () => {
    counter += 1;
    return `id-${Date.now()}-${counter}`;
  };
})();

const formatTimestamp = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

const roleColours: Record<Role, string> = {
  'Admin': 'bg-blue-100 text-blue-700',
  Lecturer: 'bg-red-100 text-red-700',
  'Chief Examiner': 'bg-indigo-100 text-indigo-700',
  'Team Lead': 'bg-blue-100 text-blue-700',
  Vetter: 'bg-yellow-100 text-yellow-700',
  Setter: 'bg-yellow-100 text-yellow-700',
};

function App() {
  // Load persisted state from localStorage
  const loadPersistedUsers = (): User[] => {
    try {
      const saved = localStorage.getItem('ucu-moderation-users');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Ensure roles are properly typed
        return parsed.map((user: any) => ({
          ...user,
          roles: user.roles || [],
          baseRole: user.baseRole || 'Lecturer',
        })) as User[];
      }
    } catch (error) {
      console.error('Error loading persisted users:', error);
    }
    return initialUsers;
  };

  const loadPersistedChiefExaminerEnabled = (): boolean => {
    try {
      const saved = localStorage.getItem('ucu-moderation-chief-examiner-enabled');
      if (saved !== null) {
        return JSON.parse(saved);
      }
    } catch (error) {
      console.error('Error loading persisted chief examiner state:', error);
    }
    return false;
  };

  const [users, setUsers] = useState<User[]>(loadPersistedUsers);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [chiefExaminerRoleEnabled, setChiefExaminerRoleEnabled] =
    useState(loadPersistedChiefExaminerEnabled);
  const [deadlinesActive, setDeadlinesActive] = useState(false);
  const [deadlineStartTime, setDeadlineStartTime] = useState<number | null>(null);
  const [deadlineDuration, setDeadlineDuration] = useState<{
    days: number;
    hours: number;
    minutes: number;
  }>({ days: 7, hours: 0, minutes: 0 });
  
  // Separate deadline states for Setter and Team Lead
  const [setterDeadlineActive, setSetterDeadlineActive] = useState(false);
  const [setterDeadlineStartTime, setSetterDeadlineStartTime] = useState<number | null>(null);
  const [setterDeadlineDuration, setSetterDeadlineDuration] = useState<{
    days: number;
    hours: number;
    minutes: number;
  }>({ days: 0, hours: 0, minutes: 7 });
  
  const [teamLeadDeadlineActive, setTeamLeadDeadlineActive] = useState(false);
  const [teamLeadDeadlineStartTime, setTeamLeadDeadlineStartTime] = useState<number | null>(null);
  const [teamLeadDeadlineDuration, setTeamLeadDeadlineDuration] = useState<{
    days: number;
    hours: number;
    minutes: number;
  }>({ days: 7, hours: 0, minutes: 0 });
  
  const [repositoriesActive, setRepositoriesActive] = useState(false);
  const [lastModerationDownload, setLastModerationDownload] = useState<
    string | null
  >(null);
  const [workflow, setWorkflow] = useState<WorkflowState>(initialWorkflow);
  const [versionHistory, setVersionHistory] =
    useState<VersionHistoryEntry[]>(initialVersionHistory);
  const [vettingSession, setVettingSession] =
    useState<VettingSessionState>(emptyVettingSession);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [destructionLog, setDestructionLog] = useState<DestructionLogEntry[]>(
    []
  );
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [showNotificationPanel, setShowNotificationPanel] = useState(false);
  const [activeToast, setActiveToast] = useState<AppNotification | null>(null);
  const [submittedPapers, setSubmittedPapers] = useState<SubmittedPaper[]>([]);
  const [setterSubmissions, setSetterSubmissions] = useState<SetterSubmission[]>([]);
  const [repositoryPapers, setRepositoryPapers] = useState<Array<{
    id: string;
    courseUnit: string;
    courseCode: string;
    semester: string;
    year: string;
    submittedBy: string;
    submittedAt: string;
    fileName: string;
    content: string;
    fileSize?: number;
  }>>([]);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [activePanelId, setActivePanelId] = useState<string>('overview');
  const mainContentRef = useRef<HTMLDivElement | null>(null);

  const currentUser = useMemo(
    () => users.find((user) => user.id === authUserId) ?? null,
    [authUserId, users]
  );

  // Helper: upload exam paper file to Supabase Storage + log metadata in exam_papers table
  const saveExamPaperToSupabase = async (
    file: File,
    params: {
      courseUnit: string;
      courseCode: string;
      semester: string;
      year: string;
      campus?: string;
      submittedById?: string;
      submittedByName?: string;
      submittedRole?: 'Setter' | 'Team Lead' | 'Chief Examiner' | 'Manual';
    }
  ): Promise<{ success: boolean; storagePath?: string; error?: string }> => {
    try {
      const timestamp = new Date().toISOString();
      const safeCourseCode = params.courseCode || 'NO_CODE';
      const safeYear = params.year || 'UNKNOWN_YEAR';
      const filePath = `${safeCourseCode}/${safeYear}/${Date.now()}-${file.name}`;

      // 1) Upload file to exam_papers bucket
      const { data: storageData, error: storageError } = await supabase.storage
        .from('exam_papers')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
        });

      if (storageError || !storageData) {
        console.error('Error uploading exam paper to storage:', storageError);
        return { success: false, error: storageError?.message || 'Failed to upload exam paper file.' };
      }

      // 2) Insert metadata into exam_papers table
      const status: ExamPaperStatus =
        params.submittedRole === 'Setter'
          ? 'submitted_to_repository'
          : params.submittedRole === 'Team Lead'
          ? 'integrated_by_team_lead'
          : 'submitted_to_repository';

      const campus = params.campus || currentUser?.campus || 'Main Campus';

      const insertPayload = {
        course_code: safeCourseCode,
        course_name: params.courseUnit,
        semester: params.semester,
        academic_year: safeYear,
        campus,
        setter_id: params.submittedRole === 'Setter' ? params.submittedById : null,
        team_lead_id: params.submittedRole === 'Team Lead' ? params.submittedById : null,
        chief_examiner_id: params.submittedRole === 'Chief Examiner' ? params.submittedById : null,
        status,
        version_number: 1,
        file_url: storageData.path,
        file_name: file.name,
        file_size: file.size,
        submitted_at: timestamp,
      };

      const { error: insertError } = await supabase.from('exam_papers').insert(insertPayload);

      if (insertError) {
        console.error('Error inserting exam paper metadata:', insertError);
        return { success: false, error: insertError.message || 'Failed to save exam paper metadata.' };
      }

      return { success: true, storagePath: storageData.path };
    } catch (error: any) {
      console.error('Unexpected error saving exam paper:', error);
      return { success: false, error: error?.message || 'Unexpected error saving exam paper.' };
    }
  };

  // Load users from Supabase on mount
  useEffect(() => {
    const loadUsersFromSupabase = async () => {
      setIsLoadingUsers(true);
      try {
        const supabaseUsers = await getAllUsers();
        if (supabaseUsers.length > 0) {
          setUsers(supabaseUsers);
          // Also persist to localStorage as backup
          try {
            localStorage.setItem('ucu-moderation-users', JSON.stringify(supabaseUsers));
          } catch (error) {
            console.error('Error saving users to localStorage:', error);
          }
        } else {
          // If no users from Supabase, try to load from localStorage as fallback
          const saved = localStorage.getItem('ucu-moderation-users');
          if (saved) {
            try {
              const parsed = JSON.parse(saved);
              if (parsed.length > 0) {
                setUsers(parsed.map((user: any) => ({
                  ...user,
                  roles: user.roles || [],
                  baseRole: user.baseRole || 'Lecturer',
                })) as User[]);
              }
            } catch (error) {
              console.error('Error loading users from localStorage:', error);
            }
          }
        }
      } catch (error) {
        console.error('Error loading users from Supabase:', error);
        // Fallback to localStorage if Supabase fails
        const saved = localStorage.getItem('ucu-moderation-users');
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            if (parsed.length > 0) {
              setUsers(parsed.map((user: any) => ({
                ...user,
                roles: user.roles || [],
                baseRole: user.baseRole || 'Lecturer',
              })) as User[]);
            }
          } catch (error) {
            console.error('Error loading users from localStorage:', error);
          }
        }
      } finally {
        setIsLoadingUsers(false);
      }
    };

    loadUsersFromSupabase();
  }, []);

  // Load persisted notifications for the signed-in user from Supabase
  useEffect(() => {
    const loadNotifications = async () => {
      if (!currentUser) {
        setNotifications([]);
        return;
      }
      try {
        const dbNotifications = await getUserNotifications(currentUser.id);
        const mapped: AppNotification[] = dbNotifications.map((n) => ({
          id: n.id,
          message: n.message,
          timestamp: n.created_at,
          read: n.is_read,
        }));
        setNotifications(mapped);
      } catch (error) {
        console.error('Error loading user notifications:', error);
      }
    };

    void loadNotifications();
  }, [currentUser]);

  // Persist users to localStorage whenever they change (as backup)
  useEffect(() => {
    try {
      localStorage.setItem('ucu-moderation-users', JSON.stringify(users));
    } catch (error) {
      console.error('Error saving users to localStorage:', error);
    }
  }, [users]);

  // Persist chiefExaminerRoleEnabled to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('ucu-moderation-chief-examiner-enabled', JSON.stringify(chiefExaminerRoleEnabled));
    } catch (error) {
      console.error('Error saving chief examiner state to localStorage:', error);
    }
  }, [chiefExaminerRoleEnabled]);

  // Global ticking clock used for vetting sessions and deadline logic
  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (
      vettingSession.active &&
      vettingSession.expiresAt &&
      currentTime >= vettingSession.expiresAt
    ) {
      handleVettingExpired();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, vettingSession.active, vettingSession.expiresAt]);

  const currentUserHasRole = (role: Role) =>
    currentUser?.roles.includes(role) ?? false;

  const handleLogin = async (email: string, password: string) => {
    setAuthError(null);
    
    try {
      console.log('Attempting login for:', email);
      const { user, error } = await authenticateUser(email, password);
      
      if (error || !user) {
        console.error('Login failed:', error);
        setAuthError(error || 'Invalid email or password. Please try again.');
        return false;
      }

      console.log('Login successful for user:', user.name, 'Roles:', user.roles);

      // Update users list if user is not already in it
      setUsers((prevUsers) => {
        const exists = prevUsers.find((u) => u.id === user.id);
        if (!exists) {
          return [...prevUsers, user];
        }
        return prevUsers;
      });

      setAuthUserId(user.id);
      setAuthError(null);
      
      // Set default panel based on role
      if (user.isSuperAdmin) {
        setActivePanelId('super-admin-dashboard');
      } else if (user.roles.includes('Admin')) {
        setActivePanelId('overview');
      } else if (user.baseRole === 'Lecturer') {
        setActivePanelId('lecturer-role-dashboard');
      } else {
        setActivePanelId('overview');
      }
      
      return true;
    } catch (error: any) {
      console.error('Login error:', error);
      setAuthError(error?.message || 'An error occurred during login. Please try again.');
      return false;
    }
  };

  const handleLogout = () => {
    setAuthUserId(null);
    setAuthError(null);
  };

  const appendVersionHistory = (
    actor: string,
    notes: string,
    majorVersion = workflow.currentVersion
  ) => {
    setVersionHistory((prev) => {
      const sequence =
        prev.filter((entry) => entry.majorVersion === majorVersion).length + 1;
      const versionLabel = `v${majorVersion}.${sequence}`;
      const entry: VersionHistoryEntry = {
        id: createId(),
        majorVersion,
        sequence,
        versionLabel,
        actor,
        notes,
        timestamp: new Date().toISOString(),
      };
      return [entry, ...prev];
    });
  };

  const pushWorkflowEvent = (
    message: string,
    actor: string,
    options?:
      | {
          stage?: WorkflowStage;
          mutate?: (prev: WorkflowState) => Partial<WorkflowState>;
        }
      | undefined
  ) => {
    setWorkflow((prev) => {
      const nextStage = options?.stage ?? prev.stage;
      const overrides = options?.mutate ? options.mutate(prev) : {};
      const event: TimelineEvent = {
        id: createId(),
        actor,
        message,
        stage: nextStage,
        timestamp: new Date().toISOString(),
      };

      return {
        ...prev,
        ...overrides,
        stage: nextStage,
        timeline: [event, ...prev.timeline],
      };
    });
  };

  const handleAddUser = (name: string, baseRole: BaseRole) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }

    const newUser: User = {
      id: createId(),
      name: trimmedName,
      baseRole,
      roles: baseRole === 'Admin' ? ['Admin'] : ['Lecturer'],
      password: DEFAULT_PASSWORD,
    };

    setUsers((prev) => [...prev, newUser]);
  };

  const handleEnableChiefExaminerRole = () => {
    if (chiefExaminerRoleEnabled) {
      return;
    }
    const actor = currentUser?.name ?? 'System';
    setChiefExaminerRoleEnabled(true);
    pushWorkflowEvent(
      'Chief Examiner role template activated by Admin.',
      actor
    );
  };

  const addLecturerAccount = async (name: string, category?: 'Undergraduate' | 'Postgraduate', email?: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }

    // Use createUser from auth.ts to create lecturer in database
    if (email) {
      const { createUser } = await import('./lib/auth');
      const username = email.split('@')[0] || trimmedName.toLowerCase().replace(/\s+/g, '.');
      const { user, error } = await createUser({
        username,
        name: trimmedName,
        email,
        baseRole: 'Lecturer',
        roles: ['Lecturer'],
        password: DEFAULT_PASSWORD,
        lecturerCategory: category,
      });

      if (error) {
        console.error('Error creating lecturer:', error);
        alert(`Failed to create lecturer: ${error}`);
        return;
      }

      if (user) {
        setUsers((prev) => {
          const exists = prev.find((u) => u.id === user.id);
          if (!exists) {
            return [...prev, user];
          }
          return prev;
        });
        alert(`Lecturer ${trimmedName} created successfully!`);
      }
    } else {
      // Fallback to local state if no email provided
      const newUser: User = {
        id: createId(),
        name: trimmedName,
        baseRole: 'Lecturer',
        roles: ['Lecturer'],
        password: DEFAULT_PASSWORD,
        lecturerCategory: category,
      };
      setUsers((prev) => [...prev, newUser]);
    }
  };
  const addAdminAccount = async (name: string, email: string, isSuperAdmin: boolean) => {
    const trimmedName = name.trim();
    if (!trimmedName || !email.trim()) {
      return;
    }

    // Create Admin (or Super Admin) in Supabase Auth + user_profiles
    const { createUser } = await import('./lib/auth');
    const username = email.split('@')[0] || trimmedName.toLowerCase().replace(/\s+/g, '.');
    const { user, error } = await createUser({
      username,
      name: trimmedName,
      email,
      baseRole: 'Admin',
      roles: isSuperAdmin ? ['Admin'] : ['Admin'],
      password: DEFAULT_PASSWORD,
      isSuperAdmin,
    });

    if (error) {
      console.error('Error creating admin:', error);
      alert(`Failed to create admin: ${error}`);
      return;
    }

    if (user) {
      setUsers((prev) => {
        const exists = prev.find((u) => u.id === user.id);
        if (!exists) {
          return [...prev, user];
        }
        return prev.map((u) => (u.id === user.id ? user : u));
      });
      alert(`Admin ${trimmedName} created successfully!`);
    }
  };

  const handlePromoteToChiefExaminer = async (userId: string) => {
    if (!chiefExaminerRoleEnabled) {
      return;
    }
    if (!currentUser) {
      alert('You must be signed in to promote a Chief Examiner.');
      return;
    }

    // Persist promotion in Supabase (user_profiles + privilege_elevations)
    const result = await elevateToChiefExaminer(userId, currentUser.id);
    if (!result.success) {
      console.error('Error elevating to Chief Examiner:', result.error);
      alert(result.error || 'Failed to promote lecturer to Chief Examiner.');
      return;
    }

    // Refresh users from backend so roles stay in sync
    try {
      const refreshedUsers = await getAllUsers();
      if (refreshedUsers && refreshedUsers.length > 0) {
        setUsers(refreshedUsers);
      } else {
        // Fallback: update local state if refresh failed or returned empty
        setUsers((prev) =>
          prev.map((user) =>
            user.id === userId && !user.roles.includes('Chief Examiner')
              ? { ...user, roles: [...user.roles, 'Chief Examiner'] as Role[] }
              : user
          )
        );
      }
    } catch (error) {
      console.error('Error refreshing users after promotion:', error);
      // Fallback local update
      setUsers((prev) =>
        prev.map((user) =>
          user.id === userId && !user.roles.includes('Chief Examiner')
            ? { ...user, roles: [...user.roles, 'Chief Examiner'] as Role[] }
            : user
        )
      );
    }

    const actor = currentUser?.name ?? 'Unknown';
    const promotedUser = users.find((user) => user.id === userId);
    if (promotedUser) {
      pushWorkflowEvent(
        `${actor} elevated ${promotedUser.name} to Chief Examiner.`,
        actor
      );
    }
  };

  const handleUnassignChiefExaminer = (userId: string) => {
    const actor = currentUser?.name ?? 'Unknown';
    setUsers((prev) => {
      const updated = prev.map((user) =>
        user.id === userId
          ? {
              ...user,
              roles: user.roles.filter((role) => role !== 'Chief Examiner'),
            }
          : user
      );
      // Persist immediately
      try {
        localStorage.setItem('ucu-moderation-users', JSON.stringify(updated));
      } catch (error) {
        console.error('Error saving users to localStorage:', error);
      }
      return updated;
    });

    const demotedUser = users.find((user) => user.id === userId);
    if (demotedUser) {
      pushWorkflowEvent(
        `${actor} removed Chief Examiner privileges from ${demotedUser.name}.`,
        actor
      );
    }
  };

  const handleAssignRole = async (userId: string, role: Role) => {
    if (!currentUser) return;

    const actor = currentUser.name ?? 'Unknown';
    let assigned = false;
    let targetUser: User | undefined;

    // Update local state first so UI feels instant
    setUsers((prev) => {
      const updated = prev.map((user) => {
        if (user.id !== userId) return user;
        targetUser = user;
        if (user.roles.includes(role)) return user;
        assigned = true;
        return { ...user, roles: [...user.roles, role] };
      });
      try {
        localStorage.setItem('ucu-moderation-users', JSON.stringify(updated));
      } catch (error) {
        console.error('Error saving users to localStorage:', error);
      }
      return updated;
    });

    if (!assigned || !targetUser) {
      return;
    }

    // Persist assignment to Supabase so it's saved in the DB
    const dbResult =
      role === 'Team Lead' || role === 'Vetter' || role === 'Setter'
        ? await appointRole(targetUser.id, role, currentUser.id)
        : await elevateToChiefExaminer(targetUser.id, currentUser.id);

    if (!dbResult.success) {
      console.error('Error saving role assignment to database:', dbResult.error);
      // Optional: show an error toast or roll back the local change
    }

      const message = `${role} role assigned to ${targetUser.name} by ${actor}.`;

      pushWorkflowEvent(message, actor);

      const notification: AppNotification = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        message,
        timestamp: new Date().toISOString(),
        read: false,
      };

    // Show toast + local bell update for the current user (Chief Examiner)
      setNotifications((prev) => [notification, ...prev].slice(0, 20));
      setActiveToast(notification);

    // Also persist notification to DB for the appointed lecturer,
    // so they see it next time they sign in.
    void createNotification({
      user_id: targetUser.id,
      title: 'New Operational Role Assigned',
      message,
      type: 'success',
    });

      // Auto-hide toast after a few seconds
      setTimeout(() => {
        setActiveToast((current) =>
          current && current.id === notification.id ? null : current
        );
      }, 5000);
  };

  const handleUnassignRole = (userId: string, role: Role) => {
    const actor = currentUser?.name ?? 'Unknown';
    let unassigned = false;
    setUsers((prev) => {
      const updated = prev.map((user) => {
        if (user.id !== userId) {
          return user;
        }
        if (!user.roles.includes(role)) {
          return user;
        }
        unassigned = true;
        return { ...user, roles: user.roles.filter((r) => r !== role) };
      });
      // Persist immediately
      try {
        localStorage.setItem('ucu-moderation-users', JSON.stringify(updated));
      } catch (error) {
        console.error('Error saving users to localStorage:', error);
      }
      return updated;
    });

    if (unassigned) {
      const target = users.find((user) => user.id === userId);
      if (target) {
        pushWorkflowEvent(
          `${actor} removed the ${role} role from ${target.name}.`,
          actor
        );
      }
    }
  };

  const handleToggleDeadlines = (nextValue: boolean) => {
    const actor = currentUser?.name ?? 'Unknown';
    setDeadlinesActive(nextValue);
    if (nextValue) {
      setDeadlineStartTime(Date.now());
    } else {
      setDeadlineStartTime(null);
    }
    pushWorkflowEvent(
      `${nextValue ? 'Activated' : 'Deactivated'} timed submission deadlines.`,
      actor
    );
  };

  const handleSetDeadlineDuration = (duration: { days: number; hours: number; minutes: number }) => {
    setDeadlineDuration(duration);
    const actor = currentUser?.name ?? 'Unknown';
    const durationText = `${duration.days} day${duration.days !== 1 ? 's' : ''}, ${duration.hours} hour${duration.hours !== 1 ? 's' : ''}, ${duration.minutes} minute${duration.minutes !== 1 ? 's' : ''}`;
    pushWorkflowEvent(
      `Deadline duration set to ${durationText} for Team Lead submissions.`,
      actor
    );
  };

  const handleToggleRepositories = (nextValue: boolean) => {
    const actor = currentUser?.name ?? 'Unknown';
    setRepositoriesActive(nextValue);
    pushWorkflowEvent(
      `${nextValue ? 'Opened' : 'Closed'} semester repositories for submissions.`,
      actor
    );
  };

  const handleDownloadModeration = () => {
    const actor = currentUser?.name ?? 'Unknown';
    const timestamp = new Date().toISOString();
    setLastModerationDownload(timestamp);
    pushWorkflowEvent(
      'Moderation results packaged for secure download.',
      actor
    );
  };

  const handleAddPaperToRepository = async (
    file: File,
    courseUnit: string,
    courseCode: string,
    semester: string,
    year: string
  ) => {
    const actorName = currentUser?.name ?? 'Unknown';
    const actorId = authUserId || currentUser?.id;

    const result = await saveExamPaperToSupabase(file, {
      courseUnit,
      courseCode,
      semester,
      year,
      campus: currentUser?.campus,
      submittedById: actorId,
      submittedByName: actorName,
      submittedRole: 'Chief Examiner',
    });

    if (!result.success) {
      alert(result.error || 'Failed to add paper to repository.');
      return;
    }

    const paperId = createId();
    const newPaper = {
      id: paperId,
      courseUnit,
      courseCode,
      semester,
      year,
      submittedBy: actorName,
      submittedAt: new Date().toISOString(),
      fileName: file.name,
      content: `Stored in Supabase at ${result.storagePath}`,
      fileSize: file.size,
    };

    setRepositoryPapers((prev) => [...prev, newPaper]);
    pushWorkflowEvent(
      `Added paper "${file.name}" to repository for AI analysis (${courseCode} - ${courseUnit}).`,
      actorName
    );
  };

  const handleSetterSubmit = async (
    file: File,
    courseCode: string,
    courseName: string,
    semester: string,
    academicYear: string,
    campus: string
  ) => {
    if (!currentUserHasRole('Setter')) {
      return;
    }
    if (workflow.stage !== 'Awaiting Setter') {
      return;
    }
    
    // Check if Setter deadline has expired
    if (setterDeadlineActive && setterDeadlineStartTime) {
      const setterTotalMs =
        setterDeadlineDuration.days * 24 * 60 * 60 * 1000 +
        setterDeadlineDuration.hours * 60 * 60 * 1000 +
        setterDeadlineDuration.minutes * 60 * 1000;
      const setterElapsed = currentTime - setterDeadlineStartTime;
      const setterRemaining = setterTotalMs - setterElapsed;
      
      if (setterRemaining <= 0) {
        // Deadline expired, cannot submit
        return;
      }
    }

    const actor = currentUser?.name ?? 'Unknown';
    const actorId = authUserId || currentUser?.id;
    const submissionId = createId();
    const newSubmission = {
      id: submissionId,
      fileName: file.name,
      submittedBy: actor,
      submittedAt: new Date().toISOString(),
      fileContent: file.name, // Store file reference
    };

    setSetterSubmissions((prev) => [...prev, newSubmission]);

    // Save to Supabase Storage + exam_papers table
    const result = await saveExamPaperToSupabase(file, {
      courseUnit: courseName,
      courseCode,
      semester,
      year: academicYear,
      campus,
      submittedById: actorId,
      submittedByName: actor,
      submittedRole: 'Setter',
    });

    if (!result.success) {
      alert(result.error || 'Failed to save exam paper to the system.');
      return;
    }

    // Also reflect in local repository list for current session
    const repositoryPaper = {
      id: createId(),
      courseUnit: courseName,
      courseCode,
      semester,
      year: academicYear,
      submittedBy: actor,
      submittedAt: new Date().toISOString(),
      fileName: file.name,
      content: `Stored in Supabase at ${result.storagePath}`,
      fileSize: file.size,
    };
    setRepositoryPapers((prev) => [...prev, repositoryPaper]);

    pushWorkflowEvent(
      'Submitted draft to Team Lead. Copy automatically shared with Chief Examiner. Paper added to repository and vetting.',
      actor,
      {
        stage: 'Submitted to Team Lead',
        mutate: (prev) => ({
          portalOpen: false,
          awaitingRecycle: false,
          lastDecision: undefined,
        }),
      }
    );
    appendVersionHistory(
      actor,
      `Setter lodged the initial draft paper (${courseCode} - ${courseUnit}) and notified Chief Examiner. Paper added to repository for AI analysis.`
    );

    // Notify Team Lead(s) that a new draft has arrived
    const message = `New draft "${file.name}" submitted by ${actor} for ${courseCode} - ${courseName}.`;
    const toast: AppNotification = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      message,
      timestamp: new Date().toISOString(),
      read: false,
    };

    // Show toast locally if the current user has Team Lead role (e.g. multi-role account)
    if (currentUserHasRole('Team Lead')) {
      setNotifications((prev) => [toast, ...prev].slice(0, 20));
      setActiveToast(toast);
      setTimeout(() => {
        setActiveToast((current) => (current && current.id === toast.id ? null : current));
      }, 5000);
    }

    // Persist notification for all users who have Team Lead role
    users
      .filter((u) => u.roles.includes('Team Lead'))
      .forEach((teamLead) => {
        if (teamLead.id) {
          void createNotification({
            user_id: teamLead.id,
            title: 'New Setter Draft Submitted',
            message,
            type: 'info',
          });
        }
      });
  };

  const handleTeamLeadSubmitPDF = (file: File, courseUnit: string, courseCode: string, semester: string, year: string) => {
    if (!currentUserHasRole('Team Lead')) {
      return;
    }
    
    // Check if Team Lead deadline has expired
    if (teamLeadDeadlineActive && teamLeadDeadlineStartTime) {
      const teamLeadTotalMs =
        teamLeadDeadlineDuration.days * 24 * 60 * 60 * 1000 +
        teamLeadDeadlineDuration.hours * 60 * 60 * 1000 +
        teamLeadDeadlineDuration.minutes * 60 * 1000;
      const teamLeadElapsed = currentTime - teamLeadDeadlineStartTime;
      const teamLeadRemaining = teamLeadTotalMs - teamLeadElapsed;

      if (teamLeadRemaining <= 0) {
        // Deadline expired, cannot submit
        return;
      }
    }

    const actor = currentUser?.name ?? 'Unknown';
    const paperId = createId();
    const newPaper = {
      id: paperId,
      fileName: file.name,
      submittedBy: actor,
      submittedAt: new Date().toISOString(),
      fileSize: file.size,
      status: 'submitted' as const,
    };

    setSubmittedPapers(prev => [...prev, newPaper]);

    // Auto-add to repository
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      const repositoryPaper = {
        id: createId(),
        courseUnit,
        courseCode,
        semester,
        year,
        submittedBy: actor,
        submittedAt: new Date().toISOString(),
        fileName: file.name,
        content: content || `Paper content for ${file.name}`,
        fileSize: file.size,
      };
      setRepositoryPapers(prev => [...prev, repositoryPaper]);
    };
    reader.readAsText(file);

    pushWorkflowEvent(
      `Team Lead submitted PDF "${file.name}" to Chief Examiner. Paper added to repository and vetting.`,
      actor
    );
    appendVersionHistory(
      actor,
      `Team Lead submitted paper: ${file.name} (${courseCode} - ${courseUnit}, ${(file.size / 1024).toFixed(2)} KB). Paper added to repository for AI analysis.`
    );
  };

  const handleTeamLeadCompile = () => {
    if (!currentUserHasRole('Team Lead')) {
      return;
    }
    if (workflow.stage !== 'Submitted to Team Lead') {
      return;
    }
    const actor = currentUser?.name ?? 'Unknown';
    
    // Update submitted papers status to 'in-vetting'
    setSubmittedPapers(prev => 
      prev.map(paper => 
        paper.submittedBy === actor && paper.status === 'submitted'
          ? { ...paper, status: 'in-vetting' }
          : paper
      )
    );
    
    pushWorkflowEvent(
      'Integrated all branch inputs and forwarded compiled document for vetting.',
      actor,
      {
        stage: 'Compiled for Vetting',
      }
    );
    appendVersionHistory(
      actor,
      'Team Lead merged setter submissions into a unified draft.'
    );
  };

  const handleStartVetting = (minutes: number) => {
    if (!currentUserHasRole('Vetter')) {
      return;
    }
    if (
      workflow.stage !== 'Compiled for Vetting' &&
      workflow.stage !== 'Vetting Session Expired'
    ) {
      return;
    }

    const duration = Math.max(5, minutes);
    const startedAt = Date.now();
    const expiresAt = startedAt + duration * 60 * 1000;
    setVettingSession({
      active: true,
      startedAt,
      durationMinutes: duration,
      expiresAt,
      safeBrowserEnabled: true,
      cameraOn: true,
      screenshotBlocked: true,
      switchingLocked: true,
    });

    const actor = currentUser?.name ?? 'Unknown';
    pushWorkflowEvent(
      `Vetting session started with a ${duration}-minute secure window.`,
      actor,
      { stage: 'Vetting in Progress' }
    );
  };

  const handleCompleteVetting = () => {
    if (!currentUserHasRole('Vetter')) {
      return;
    }
    if (!vettingSession.active || workflow.stage !== 'Vetting in Progress') {
      return;
    }
    const actor = currentUser?.name ?? 'Unknown';
    setVettingSession((prev) => ({
      ...prev,
      active: false,
      lastClosedReason: 'completed',
    }));
    
    // Update submitted papers status to 'vetted'
    setSubmittedPapers(prev => 
      prev.map(paper => 
        paper.status === 'in-vetting'
          ? { ...paper, status: 'vetted' }
          : paper
      )
    );
    
    pushWorkflowEvent(
      'Returned annotated paper and digital moderation log to Chief Examiner.',
      actor,
      { stage: 'Vetted & Returned to Chief Examiner' }
    );
    appendVersionHistory(
      actor,
      `Vetting complete with ${annotations.length} inline annotations.`
    );
  };

  const handleVettingExpired = () => {
    setVettingSession((prev) => ({
      ...prev,
      active: false,
      lastClosedReason: 'expired',
    }));
    pushWorkflowEvent(
      'Vetting window expired — vetter logged out automatically by safe browser.',
      'System',
      { stage: 'Vetting Session Expired' }
    );
  };

  const handleSanitizeAndForward = () => {
    if (!currentUserHasRole('Chief Examiner')) {
      return;
    }
    if (workflow.stage !== 'Vetted & Returned to Chief Examiner') {
      return;
    }
    const actor = currentUser?.name ?? 'Unknown';
    pushWorkflowEvent(
      'Removed moderator footprints and forwarded sanitized paper to Team Lead for revisions.',
      actor,
      { stage: 'Sanitized for Revision' }
    );
    appendVersionHistory(
      actor,
      'Sanitized version delivered to Team Lead with moderation identities masked.'
    );
  };

  const handleRevisionComplete = () => {
    if (!currentUserHasRole('Team Lead')) {
      return;
    }
    if (workflow.stage !== 'Sanitized for Revision') {
      return;
    }
    const actor = currentUser?.name ?? 'Unknown';
    pushWorkflowEvent(
      'Revisions completed and pushed for Chief Examiner final review.',
      actor,
      { stage: 'Revision Complete' }
    );
    appendVersionHistory(
      actor,
      'Team Lead integrated revisions and documented the change log.'
    );
  };

  const handleOpenApprovalPortal = () => {
    if (!currentUserHasRole('Chief Examiner')) {
      return;
    }
    if (workflow.stage !== 'Revision Complete') {
      return;
    }
    const actor = currentUser?.name ?? 'Unknown';
    pushWorkflowEvent(
      'Opened final approval portal to review revision pack.',
      actor,
      {
        stage: 'Awaiting Approval',
        mutate: () => ({ portalOpen: true }),
      }
    );
    appendVersionHistory(
      actor,
      'Final approval checkpoint opened for Chief Examiner.'
    );
  };

  const handleApprove = (notes: string) => {
    if (!currentUserHasRole('Chief Examiner')) {
      return;
    }
    if (workflow.stage !== 'Awaiting Approval') {
      return;
    }
    const actor = currentUser?.name ?? 'Unknown';
    const timestamp = new Date().toISOString();
    
    // Update submitted papers status to 'approved'
    setSubmittedPapers(prev => 
      prev.map(paper => 
        paper.status === 'vetted'
          ? { ...paper, status: 'approved' }
          : paper
      )
    );
    
    pushWorkflowEvent('Approved for printing.', actor, {
      stage: 'Approved',
      mutate: () => ({
        portalOpen: false,
        awaitingRecycle: false,
        lastDecision: {
          type: 'Approved',
          actor,
          timestamp,
          notes,
        },
      }),
    });
    appendVersionHistory(
      actor,
      notes
        ? `Approved for printing with note: ${notes}`
        : 'Approved for printing.'
    );
  };

  const handleReject = (notes: string) => {
    if (!currentUserHasRole('Chief Examiner')) {
      return;
    }
    if (workflow.stage !== 'Awaiting Approval') {
      return;
    }
    const actor = currentUser?.name ?? 'Unknown';
    const timestamp = new Date().toISOString();
    const latestVersion =
      versionHistory.find(
        (entry) => entry.majorVersion === workflow.currentVersion
      )?.versionLabel ?? `v${workflow.currentVersion}`;

    pushWorkflowEvent(
      'Rejected — new setter required and recycling process initiated.',
      actor,
      {
        stage: 'Rejected',
        mutate: () => ({
          portalOpen: false,
          awaitingRecycle: true,
          lastDecision: {
            type: 'Rejected',
            actor,
            timestamp,
            notes,
          },
        }),
      }
    );
    appendVersionHistory(
      actor,
      notes
        ? `Rejected and flagged for recycling. Notes: ${notes}`
        : 'Rejected and flagged for recycling.'
    );
    setDestructionLog((prev) => [
      {
        id: createId(),
        versionLabel: latestVersion,
        timestamp,
        details:
          'Draft secured for digital destruction and archival pending new setter assignment.',
      },
      ...prev,
    ]);
  };

  const handleRestartWorkflow = () => {
    if (
      !currentUserHasRole('Chief Examiner') &&
      !currentUserHasRole('Admin')
    ) {
      return;
    }
    if (!workflow.awaitingRecycle) {
      return;
    }
    const actor = currentUser?.name ?? 'Unknown';
    const nextMajor = workflow.currentVersion + 1;

    pushWorkflowEvent(
      `New setter request initiated. Workflow restarted for version v${nextMajor}.1.`,
      actor,
      {
        stage: 'Awaiting Setter',
        mutate: () => ({
          portalOpen: false,
          awaitingRecycle: false,
          currentVersion: nextMajor,
          lastDecision: undefined,
        }),
      }
    );

    appendVersionHistory(
      actor,
      'Workflow recycled — awaiting fresh setter assignment.',
      nextMajor
    );

    setAnnotations([]);
    setVettingSession(emptyVettingSession);
  };

  const handleAddAnnotation = (comment: string) => {
    const trimmed = comment.trim();
    if (!trimmed || !currentUser) {
      return;
    }
    setAnnotations((prev) => [
      {
        id: createId(),
        author: currentUser.name,
        comment: trimmed,
        timestamp: new Date().toISOString(),
      },
      ...prev,
    ]);
  };

  const vettingCountdown = useMemo(() => {
    if (!vettingSession.active || !vettingSession.expiresAt) {
      return null;
    }
    const remainingMs = Math.max(0, vettingSession.expiresAt - currentTime);
    const minutes = Math.floor(remainingMs / 60000);
    const seconds = Math.floor((remainingMs % 60000) / 1000);
    return `${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`;
  }, [currentTime, vettingSession.active, vettingSession.expiresAt]);

  const isAuthenticated = Boolean(currentUser);
  const isAdmin = currentUserHasRole('Admin');
  const isChiefExaminer = currentUserHasRole('Chief Examiner');
  const isTeamLead = currentUserHasRole('Team Lead');
  const isSetter = currentUserHasRole('Setter');
  const isVetter = currentUserHasRole('Vetter');
  const isPureLecturer =
    isAuthenticated &&
    currentUserHasRole('Lecturer') &&
    !isAdmin &&
    !currentUserHasRole('Chief Examiner') &&
    !currentUserHasRole('Team Lead') &&
    !currentUserHasRole('Vetter') &&
    !currentUserHasRole('Setter');
  const showWorkflowInterfaces =
    currentUserHasRole('Setter') ||
    currentUserHasRole('Team Lead') ||
    currentUserHasRole('Chief Examiner') ||
    currentUserHasRole('Vetter') ||
    currentUserHasRole('Admin');
  const showVettingInterfaces =
    currentUserHasRole('Vetter') ||
    currentUserHasRole('Chief Examiner') ||
    currentUserHasRole('Admin');
  const showDestructionPanel =
    currentUserHasRole('Chief Examiner') || currentUserHasRole('Admin');

  const stageGuidance: Partial<Record<WorkflowStage, string>> = {
    'Awaiting Setter': 'Awaiting draft submission from the assigned setter.',
    'Submitted to Team Lead': 'Team Lead should compile branch inputs for vetting.',
    'Compiled for Vetting': 'Vetting team can initiate a secure annotation session.',
    'Vetting in Progress': 'Monitor safe-browser session until annotations are complete.',
    'Vetting Session Expired': 'Restart a vetted session or extend the timer.',
    'Vetted & Returned to Chief Examiner': 'Chief Examiner should sanitize comments and forward for revision.',
    'Sanitized for Revision': 'Team Lead to integrate changes before final review.',
    'Revision Complete': 'Chief Examiner may open the approval portal.',
    'Awaiting Approval': 'Approve for printing or reject to recycle the workflow.',
    Approved: 'Workflow closed successfully. Prepare for printing.',
    Rejected: 'Assign a new setter and restart the workflow cycle.',
  };

  // Automatically start Team Lead deadline when Setter deadline expires
  useEffect(() => {
    if (!setterDeadlineActive || !setterDeadlineStartTime) {
      return;
    }
    if (teamLeadDeadlineActive && teamLeadDeadlineStartTime) {
      return;
    }

    const setterTotalMs =
      setterDeadlineDuration.days * 24 * 60 * 60 * 1000 +
      setterDeadlineDuration.hours * 60 * 60 * 1000 +
      setterDeadlineDuration.minutes * 60 * 1000;

    const setterElapsed = currentTime - setterDeadlineStartTime;

    if (setterElapsed >= setterTotalMs) {
      // Start Team Lead deadline immediately when Setter window closes
      setSetterDeadlineActive(false);
      const now = Date.now();
      setTeamLeadDeadlineActive(true);
      setTeamLeadDeadlineStartTime(now);

      const actor = currentUser?.name ?? 'System';
      const durationText = `${teamLeadDeadlineDuration.days} day${teamLeadDeadlineDuration.days !== 1 ? 's' : ''}, ${teamLeadDeadlineDuration.hours} hour${teamLeadDeadlineDuration.hours !== 1 ? 's' : ''}, ${teamLeadDeadlineDuration.minutes} minute${teamLeadDeadlineDuration.minutes !== 1 ? 's' : ''}`;
      pushWorkflowEvent(
        `Setter submission window closed. Activated Team Lead submission deadline (${durationText}).`,
        actor
      );
    }
  }, [
    currentTime,
    setterDeadlineActive,
    setterDeadlineStartTime,
    setterDeadlineDuration.days,
    setterDeadlineDuration.hours,
    setterDeadlineDuration.minutes,
    teamLeadDeadlineActive,
    teamLeadDeadlineStartTime,
    teamLeadDeadlineDuration.days,
    teamLeadDeadlineDuration.hours,
    teamLeadDeadlineDuration.minutes,
    currentUser?.name,
  ]);

  const latestVersionLabel =
    versionHistory[0]?.versionLabel ?? `v${workflow.currentVersion}.x`;
  const timelineEntries = workflow.timeline.length;
  const totalAnnotations = annotations.length;
  const outstandingAction =
    isPureLecturer
      ? 'Review weekly teaching plan, upload course materials, and coordinate consultations.'
      : stageGuidance[workflow.stage] ??
        'Monitor workflow progress and await next trigger.';

  // Admin Dashboard
  const adminDashboard: PanelConfig | null = isAuthenticated && isAdmin
    ? {
        id: 'overview',
        label: 'Dashboard',
        visible: true,
        render: () => {
          const handleNavigate = (panelId: string) => {
            setActivePanelId(panelId);
            if (mainContentRef.current) {
              mainContentRef.current.scrollTo({ top: 0, behavior: 'smooth' });
            }
          };
          const admins = users.filter(u => u.baseRole === 'Admin').length;
          const lecturers = users.filter(u => u.baseRole === 'Lecturer').length;
          const chiefExaminers = users.filter(u => u.roles.includes('Chief Examiner')).length;
          const teamLeads = users.filter(u => u.roles.includes('Team Lead')).length;
          const vetters = users.filter(u => u.roles.includes('Vetter')).length;
          const setters = users.filter(u => u.roles.includes('Setter')).length;
          const totalUsers = users.length;
          const activeRoles = chiefExaminers + teamLeads + vetters + setters;
          
          // Vetting staff (Team Leads, Vetters, Setters)
          const vettingStaff = users.filter(u => 
            u.roles.includes('Team Lead') || 
            u.roles.includes('Vetter') || 
            u.roles.includes('Setter')
          );

          const recentUsers = users.slice(-5).reverse();

          return (
            <div className="space-y-6">
              {/* Dashboard Label */}
              <div className="flex items-center justify-between rounded-xl border-2 border-blue-600 bg-gradient-to-r from-blue-50 to-purple-50 p-4 shadow-md">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <div>
                    <h1 className="text-xl font-bold text-blue-900">Admin Dashboard</h1>
                    <p className="text-sm text-slate-600">User Management & System Administration</p>
                  </div>
                </div>
                <div className="rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white">
                  ADMIN
                </div>
              </div>

              {/* Key Metrics */}
              <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Total Users</p>
                    <span className="text-blue-600">👥</span>
                  </div>
                  <p className="text-3xl font-bold text-blue-600">{totalUsers}</p>
                  <div className="mt-3 flex gap-4 text-xs text-slate-600">
                    <span>Admins: {admins}</span>
                    <span>Lecturers: {lecturers}</span>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Active Roles</p>
                    <span className="text-purple-600">🎭</span>
                  </div>
                  <p className="text-3xl font-bold text-purple-600">{activeRoles}</p>
                  <div className="mt-3 text-xs text-slate-600">
                    {chiefExaminers} CE • {teamLeads} TL • {vetters} V • {setters} S
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs uppercase tracking-wide text-slate-500">System Status</p>
                    <span className="text-green-600">✓</span>
                  </div>
                  <p className="text-2xl font-bold text-green-600">Operational</p>
                  <p className="mt-3 text-xs text-slate-600">
                    Chief Examiner: {chiefExaminerRoleEnabled ? 'Enabled' : 'Locked'}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Workflow Stage</p>
                    <span className="text-purple-600">⚙️</span>
                  </div>
                  <p className="text-lg font-bold text-purple-600">{workflow.stage.replace(/-/g, ' ')}</p>
                  <p className="mt-3 text-xs text-slate-600">
                    {workflow.timeline.length} timeline entries
                  </p>
                </div>
              </section>

              {/* Quick Actions */}
              <SectionCard
                title="Quick Actions"
                kicker="Administrative Tasks"
                description="Common administrative tasks you can perform from this dashboard."
              >
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => handleNavigate('admin-view-lecturers')}
                    className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 text-left transition-all hover:border-blue-400 hover:shadow-lg hover:bg-blue-100"
                  >
                    <p className="text-sm font-semibold text-blue-700">View Lecturers</p>
                    <p className="mt-1 text-xs text-slate-600">Browse lecturers by department</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNavigate('super-chief-role')}
                    className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 text-left transition-all hover:border-blue-400 hover:shadow-lg hover:bg-blue-100"
                  >
                    <p className="text-sm font-semibold text-purple-700">Manage Chief Examiner</p>
                    <p className="mt-1 text-xs text-slate-600">Enable and assign Chief Examiner role</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNavigate('super-system-stats')}
                    className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 text-left transition-all hover:border-blue-400 hover:shadow-lg hover:bg-blue-100"
                  >
                    <p className="text-sm font-semibold text-amber-700">System Statistics</p>
                    <p className="mt-1 text-xs text-slate-600">View detailed system metrics</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNavigate('admin-add-admin')}
                    className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 text-left transition-all hover:border-blue-400 hover:shadow-lg hover:bg-blue-100"
                  >
                    <p className="text-sm font-semibold text-blue-700">Add Admin</p>
                    <p className="mt-1 text-xs text-slate-600">Create additional administrators</p>
                  </button>
                </div>
              </SectionCard>

              {/* Vetting Staff */}
              <SectionCard
                title="Vetting Staff"
                kicker="Moderation Team"
                description="Staff members assigned to the moderation workflow (Team Leads, Vetters, Setters)."
              >
                {vettingStaff.length === 0 ? (
                  <div className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-6 text-center shadow-md">
                    <p className="text-sm text-slate-600">No vetting staff assigned yet.</p>
                    <p className="text-xs text-slate-500 mt-2">Assign roles through the Chief Examiner Role panel.</p>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {vettingStaff.map((user) => {
                      const vettingRoles = user.roles.filter(r => ['Team Lead', 'Vetter', 'Setter'].includes(r));
                      return (
                        <div
                          key={user.id}
                          className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4"
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex-1">
                              <p className="text-sm font-semibold text-slate-800">{user.name}</p>
                              <p className="mt-1 text-xs text-slate-600">{user.baseRole}</p>
                            </div>
                            <span className="text-xs font-semibold text-amber-400 bg-amber-500/20 px-2 py-1 rounded">
                              Vetting Staff
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {vettingRoles.map((role) => (
                              <RoleBadge key={role} role={role} />
                            ))}
                          </div>
                          {user.roles.includes('Chief Examiner') && (
                            <div className="mt-2">
                              <RoleBadge role="Chief Examiner" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </SectionCard>

              {/* Recent Users */}
              <SectionCard
                title="Recently Added Users"
                kicker="User Management"
                description="Latest users added to the system."
              >
                {recentUsers.length === 0 ? (
                  <p className="text-sm text-slate-600">No users in the system yet.</p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {recentUsers.map((user) => (
                      <div
                        key={user.id}
                        className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 shadow-md"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-slate-800">{user.name}</p>
                            <p className="mt-1 text-xs text-slate-600">{user.baseRole}</p>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {user.roles.map((role) => (
                              <RoleBadge key={role} role={role} />
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>

              {/* System Health */}
              <SectionCard
                title="System Health"
                kicker="Status Overview"
                description="Current status of key system components."
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-semibold text-slate-800">Chief Examiner Role</p>
                      <StatusPill
                        label={chiefExaminerRoleEnabled ? 'Active' : 'Locked'}
                        active={chiefExaminerRoleEnabled}
                        tone={chiefExaminerRoleEnabled ? 'blue' : 'amber'}
                      />
                    </div>
                    <p className="text-xs text-slate-600">
                      {chiefExaminerRoleEnabled
                        ? 'Role template is enabled and ready for assignments'
                        : 'Enable the role template to assign Chief Examiner privileges'}
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-semibold text-slate-800">Workflow Status</p>
                      <span className="text-xs text-blue-600">Active</span>
                    </div>
                    <p className="text-xs text-slate-600">
                      Current stage: {workflow.stage.replace(/-/g, ' ')}
                    </p>
                  </div>
                </div>
              </SectionCard>
            </div>
          );
        },
      }
    : null;

  // Chief Examiner / Workflow Dashboard
  const workflowDashboard: PanelConfig | null = isAuthenticated && !isAdmin && !isPureLecturer
    ? {
        id: 'overview',
        label: 'Dashboard',
        visible: true,
        render: () => {
          const recentTimeline = workflow.timeline.slice(0, 5);
          const recentVersions = versionHistory.slice(0, 4);
          const roles = currentUser?.roles ?? [];
          const isChiefExaminer = roles.includes('Chief Examiner');

          return (
            <div className="space-y-6">
              {/* Dashboard Label */}
              <div className="flex items-center justify-between rounded-xl border-2 border-blue-600 bg-gradient-to-r from-blue-50 to-purple-50 p-4 shadow-md">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                  </div>
                  <div>
                    <h1 className="text-xl font-bold text-blue-900">
                      {isChiefExaminer ? 'Chief Examiner Dashboard' : 'Workflow Dashboard'}
                    </h1>
                    <p className="text-sm text-slate-600">
                      {isChiefExaminer ? 'Exam Moderation & Approval' : 'Workflow Management & Tracking'}
                    </p>
                  </div>
                </div>
                <div className="rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white">
                  {isChiefExaminer ? 'CHIEF EXAMINER' : 'WORKFLOW'}
                </div>
              </div>

              <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <DashboardStat
                  label="Workflow Stage"
                  value={workflow.stage.replace(/-/g, ' ')}
                  tone="blue"
                />
                <DashboardStat label="Version Label" value={latestVersionLabel} />
                <DashboardStat
                  label="Timeline Entries"
                  value={`${timelineEntries} update${timelineEntries === 1 ? '' : 's'}`}
                />
                <DashboardStat
                  label="Annotations Logged"
                  value={`${totalAnnotations}`}
                />
              </section>

              <SectionCard
                title="Operational Snapshot"
                kicker="Next Action"
                description="High-level summary of the moderation cycle and pending responsibilities."
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 text-sm shadow-md">
                    <p className="text-xs uppercase tracking-wide text-blue-600 font-semibold">
                      Outstanding Task
                    </p>
                    <p className="mt-2 text-base font-semibold text-blue-800">
                      {outstandingAction}
                    </p>
                  </div>
                  <div className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 text-sm shadow-md">
                    <p className="text-xs uppercase tracking-wide text-blue-600 font-semibold">
                      Acting Roles
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {roles.map((role) => (
                        <RoleBadge key={`overview-${role}`} role={role} />
                      ))}
                    </div>
                  </div>
                </div>
              </SectionCard>

              <SectionCard
                title="Recent Activity"
                kicker="Audit Trail"
                description="Snapshot of the latest workflow events recorded in the timeline."
              >
                {recentTimeline.length === 0 ? (
                  <p className="text-sm text-blue-700">
                    No activity logged yet. Actions taken across the moderation lifecycle will appear here.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {recentTimeline.map((event) => (
                      <li
                        key={`overview-timeline-${event.id}`}
                        className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-3 text-sm text-blue-900 shadow-md"
                      >
                        <p className="font-semibold text-blue-800">{event.actor}</p>
                        <p className="text-blue-900">{event.message}</p>
                        <div className="mt-1 flex flex-wrap items-center justify-between text-xs text-blue-600">
                          <span>{event.stage}</span>
                          <span>{formatTimestamp(event.timestamp)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>

              <SectionCard
                title="Version Ledger Snapshot"
                kicker="Secure History"
                description="Latest published versions and ownership details."
              >
                {recentVersions.length === 0 ? (
                  <p className="text-sm text-blue-700">
                    No version history recorded yet. Once the workflow progresses, versions will be listed here.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {recentVersions.map((entry) => (
                      <li
                        key={`overview-version-${entry.id}`}
                        className="rounded-2xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-3 shadow-md"
                      >
                        <div className="flex items-center justify-between text-xs text-blue-700">
                          <span className="font-semibold text-blue-800">
                            {entry.versionLabel}
                          </span>
                          <span>{formatTimestamp(entry.timestamp)}</span>
                        </div>
                        <p className="mt-1 text-sm text-blue-900">{entry.notes}</p>
                        <p className="mt-1 text-xs text-blue-600">Owner: {entry.actor}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </div>
          );
        },
      }
    : null;

  // Lecturer Dashboard
  const lecturerDashboard: PanelConfig | null = isAuthenticated && isPureLecturer && currentUser
    ? {
        id: 'overview',
        label: 'Dashboard',
        visible: true,
        render: () => (
          <LecturerDashboard
            currentUserId={currentUser.id}
            userRoles={currentUser.roles}
            baseRole={currentUser.baseRole}
          />
        ),
      }
    : null;

  // Super Admin Dashboard
  const superAdminDashboard: PanelConfig | null = 
    isAuthenticated && currentUser?.isSuperAdmin
      ? {
          id: 'super-admin-dashboard',
          label: 'Super Admin Dashboard',
          visible: true,
          render: () => (
            <SuperAdminDashboard
              currentUserId={currentUser.id}
              isSuperAdmin={true}
            />
          ),
        }
      : null;

  const overviewPanel = superAdminDashboard || adminDashboard || workflowDashboard || lecturerDashboard;

  const adminPanels: PanelConfig[] = isAuthenticated && isAdmin
    ? [
        {
          id: 'admin-view-lecturers',
          label: 'View Lecturers',
          visible: true,
          render: () => (
            <AdminViewLecturersPanel users={users} />
          ),
        },
        {
          id: 'admin-add-admin',
          label: 'Add Admin',
          visible: true,
          render: () => (
            <AdminAddAdminPanel onAddAdmin={addAdminAccount} />
          ),
        },
        {
          id: 'admin-add-chief-examiner',
          label: 'Add Chief Examiner',
          visible: true,
          render: () => (
            <PrivilegeElevationPanel
              currentUserId={currentUser!.id}
              isSuperAdmin={true}
              isChiefExaminer={false}
            />
          ),
        },
        {
          id: 'super-system-stats',
          label: 'System Statistics',
          visible: true,
          render: () => <SuperUserSystemStatsPanel users={users} workflow={workflow} />,
        },
        {
          id: 'admin-system-settings',
          label: 'System Settings',
          visible: true,
          render: () => <AdminSystemSettingsPanel />,
        },
      ]
    : [];

  // Always show lecturer panels for any user with baseRole === 'Lecturer' or Lecturer role
  const isLecturer = isAuthenticated && currentUser && (
    (currentUser.baseRole as BaseRole) === 'Lecturer' || 
    currentUserHasRole('Lecturer')
  );

  const lecturerPanels: PanelConfig[] = isLecturer
    ? [
        {
          id: 'lecturer-enter-marks',
          label: 'Enter Marks',
          visible: true,
          render: () => <LecturerEnterMarksPanel />,
        },
        {
          id: 'lecturer-search-student',
          label: 'Search Student',
          visible: true,
          render: () => <LecturerSearchStudentPanel />,
        },
        {
          id: 'lecturer-monthly-report',
          label: 'Make Reports',
          visible: true,
          render: () => <LecturerMonthlyReportPanel />,
        },
        {
          id: 'lecturer-scheduling',
          label: 'See Timetable',
          visible: true,
          render: () => <LecturerSchedulingPanel />,
        },
        {
          id: 'lecturer-classes',
          label: 'My Classes',
          visible: true,
          render: () => <LecturerMyClassesPanel />,
        },
        {
          id: 'lecturer-account-settings',
          label: 'Account Settings',
          visible: true,
          render: () => <LecturerAccountSettingsPanel />,
        },
      ]
    : [];

  const roleSpecificPanels: PanelConfig[] = [];

  if (isAuthenticated && isChiefExaminer) {
    roleSpecificPanels.push({
      id: 'chief-examiner-dashboard',
      label: 'Chief Examiner Dashboard',
      visible: true,
      render: () => (
        <ChiefExaminerDashboardPanel
          workflow={workflow}
          submittedPapers={submittedPapers}
          setterSubmissions={setterSubmissions}
          annotations={annotations}
        />
      ),
    });

    roleSpecificPanels.push({
      id: 'chief-examiner-track-paper',
      label: 'Track Paper',
      visible: true,
      render: () => (
        <PaperTrackingPanel workflow={workflow} submittedPapers={submittedPapers} />
      ),
    });

    roleSpecificPanels.push({
      id: 'chief-examiner-console',
      label: 'Chief Examiner Console',
      visible: true,
      render: () => (
        <ChiefExaminerConsole
          users={users}
          currentUser={currentUser}
          onAssignRole={handleAssignRole}
          onUnassignRole={handleUnassignRole}
          deadlinesActive={deadlinesActive}
          deadlineDuration={deadlineDuration}
          repositoriesActive={repositoriesActive}
          onToggleDeadlines={handleToggleDeadlines}
          onSetDeadlineDuration={handleSetDeadlineDuration}
          onToggleRepositories={handleToggleRepositories}
          lastModerationDownload={lastModerationDownload}
          onDownloadModeration={handleDownloadModeration}
          setterDeadlineActive={setterDeadlineActive}
          setterDeadlineDuration={setterDeadlineDuration}
          setterDeadlineStartTime={setterDeadlineStartTime}
          teamLeadDeadlineActive={teamLeadDeadlineActive}
          teamLeadDeadlineDuration={teamLeadDeadlineDuration}
          teamLeadDeadlineStartTime={teamLeadDeadlineStartTime}
          onSetSetterDeadline={(active: boolean, duration: { days: number; hours: number; minutes: number }) => {
            setSetterDeadlineActive(active);
            if (active) {
              setSetterDeadlineStartTime(Date.now());
            } else {
              setSetterDeadlineStartTime(null);
            }
            setSetterDeadlineDuration(duration);
            const actor = currentUser?.name ?? 'Unknown';
            const durationText = `${duration.days} day${duration.days !== 1 ? 's' : ''}, ${duration.hours} hour${duration.hours !== 1 ? 's' : ''}, ${duration.minutes} minute${duration.minutes !== 1 ? 's' : ''}`;
            pushWorkflowEvent(
              `${active ? 'Activated' : 'Deactivated'} Setter submission deadline (${durationText}).`,
              actor
            );
          }}
          onSetTeamLeadDeadline={(active: boolean, duration: { days: number; hours: number; minutes: number }) => {
            setTeamLeadDeadlineActive(active);
            if (active) {
              setTeamLeadDeadlineStartTime(Date.now());
            } else {
              setTeamLeadDeadlineStartTime(null);
            }
            setTeamLeadDeadlineDuration(duration);
            const actor = currentUser?.name ?? 'Unknown';
            const durationText = `${duration.days} day${duration.days !== 1 ? 's' : ''}, ${duration.hours} hour${duration.hours !== 1 ? 's' : ''}, ${duration.minutes} minute${duration.minutes !== 1 ? 's' : ''}`;
            pushWorkflowEvent(
              `${active ? 'Activated' : 'Deactivated'} Team Lead submission deadline (${durationText}).`,
              actor
            );
          }}
          onAddPaperToRepository={handleAddPaperToRepository}
          repositoryPapers={repositoryPapers}
        />
      ),
    });
  }

  // Setter specific panel (only for pure Setters, not Chief Examiners or Team Leads)
  if (isAuthenticated && currentUserHasRole('Setter') && !currentUserHasRole('Chief Examiner') && !currentUserHasRole('Team Lead')) {
    roleSpecificPanels.push({
      id: 'setter-panel',
      label: 'Submit Draft',
      visible: true,
      render: () => (
        <SetterPanel
          workflowStage={workflow.stage}
          onSetterSubmit={handleSetterSubmit}
          deadlineActive={setterDeadlineActive}
          deadlineStartTime={setterDeadlineStartTime}
          deadlineDuration={setterDeadlineDuration}
          currentUserCourseUnit={currentUser?.courseUnit}
          currentUserCampus={currentUser?.campus}
          mySubmissions={setterSubmissions.filter((s) => s.submittedBy === currentUser?.name)}
        />
      ),
    });
  }

  // Team Lead specific panels (only for pure Team Leads, not Chief Examiners)
  if (isAuthenticated && currentUserHasRole('Team Lead') && !currentUserHasRole('Chief Examiner')) {
    roleSpecificPanels.push({
      id: 'team-lead-dashboard',
      label: 'Team Lead Dashboard',
      visible: true,
      render: () => (
        <TeamLeadDashboardPanel
          workflow={workflow}
          submittedPapers={submittedPapers.filter((p) => p.submittedBy === currentUser?.name)}
          // Show all setter submissions relevant to this workflow so the Team Lead
          // can see the true count of drafts coming in from Setters.
          setterSubmissions={setterSubmissions}
        />
      ),
    });

    roleSpecificPanels.push({
      id: 'team-lead-panel',
      label: 'Team Lead Submission',
      visible: true,
      render: () => (
        <TeamLeadPanel
          deadlinesActive={teamLeadDeadlineActive}
          deadlineStartTime={teamLeadDeadlineStartTime}
          deadlineDuration={teamLeadDeadlineDuration}
          repositoriesActive={repositoriesActive}
          onTeamLeadCompile={handleTeamLeadCompile}
          submittedPapers={submittedPapers.filter((p) => p.submittedBy === currentUser?.name)}
          setterSubmissions={setterSubmissions}
          workflowStage={workflow.stage}
          onSubmitPDF={handleTeamLeadSubmitPDF}
        />
      ),
    });
  }

  if (isAuthenticated && showWorkflowInterfaces && !currentUserHasRole('Team Lead') && !currentUserHasRole('Setter')) {
    roleSpecificPanels.push({
      id: 'workflow-execution',
      label: 'Workflow Execution',
      visible: true,
      render: () => (
        <WorkflowOrchestration
          workflow={workflow}
          annotations={annotations}
          versionHistory={versionHistory}
          currentUser={currentUser ?? undefined}
          userHasRole={currentUserHasRole}
          onSetterSubmit={() => {
            // WorkflowOrchestration uses a simple button, so we'll just show an alert
            alert('Please use the Setter Panel to submit papers with metadata.');
          }}
          onTeamLeadCompile={handleTeamLeadCompile}
          onSanitizeAndForward={handleSanitizeAndForward}
          onRevisionIntegrated={handleRevisionComplete}
          onOpenApprovalPortal={handleOpenApprovalPortal}
          onApprove={handleApprove}
          onReject={handleReject}
          onRestartWorkflow={handleRestartWorkflow}
        />
      ),
    });
  }

  if (isAuthenticated && showVettingInterfaces) {
    roleSpecificPanels.push({
      id: 'vetting-suite',
      label: 'Vetting & Annotations',
      visible: true,
      render: () => (
        <VettingAndAnnotations
          workflowStage={workflow.stage}
          vettingSession={vettingSession}
          annotations={annotations}
          safeBrowserPolicies={safeBrowserPolicies}
          digitalChecklist={digitalChecklist}
          vettingCountdown={vettingCountdown}
          userHasRole={currentUserHasRole}
          onStartVetting={handleStartVetting}
          onCompleteVetting={handleCompleteVetting}
          onAddAnnotation={handleAddAnnotation}
        />
      ),
    });
  }

  if (isAuthenticated && showDestructionPanel) {
    roleSpecificPanels.push({
      id: 'destruction-log',
      label: 'Digital Destruction Log',
      visible: true,
      render: () => (
        <DigitalDestructionPanel
          destructionLog={destructionLog}
          lastDecision={workflow.lastDecision}
        />
      ),
    });
  }

  // Chief Examiner Privilege Elevation Panel
  const chiefExaminerPrivilegePanel: PanelConfig | null =
    isAuthenticated && currentUserHasRole('Chief Examiner')
      ? {
          id: 'chief-examiner-privileges',
          label: 'Appoint Roles',
          visible: true,
          render: () => (
            <PrivilegeElevationPanel
              currentUserId={currentUser!.id}
              isSuperAdmin={false}
              isChiefExaminer={true}
            />
          ),
        }
      : null;

  // Lecturer Dashboard with role-specific views
  const lecturerRoleDashboard: PanelConfig | null =
    isAuthenticated && currentUser && (currentUser.baseRole === 'Lecturer' || currentUserHasRole('Lecturer'))
      ? {
          id: 'lecturer-role-dashboard',
          label: 'Dashboard',
          visible: true,
          render: () => (
            <LecturerDashboard
              currentUserId={currentUser.id}
              userRoles={currentUser.roles}
              baseRole={currentUser.baseRole}
            />
          ),
        }
      : null;

  const panelConfigs: PanelConfig[] = [
    ...(overviewPanel ? [overviewPanel] : []),
    // Only add lecturerRoleDashboard if it's different from overviewPanel (for non-pure lecturers)
    ...(lecturerRoleDashboard && lecturerRoleDashboard.id !== overviewPanel?.id ? [lecturerRoleDashboard] : []),
    ...(isAdmin ? adminPanels : []),
    ...(chiefExaminerPrivilegePanel ? [chiefExaminerPrivilegePanel] : []),
    // Show lecturer panels to anyone with Lecturer role or baseRole (including Chief Examiners)
    ...(isLecturer ? lecturerPanels : []),
    ...roleSpecificPanels,
  ];

  useEffect(() => {
    if (!panelConfigs.some((panel) => panel.id === activePanelId)) {
      const fallback = panelConfigs[0]?.id ?? 'overview';
      setActivePanelId(fallback);
    }
  }, [panelConfigs, activePanelId]);

  const handlePanelSelect = (panelId: string) => {
    setActivePanelId(panelId);
    if (mainContentRef.current) {
      mainContentRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const activePanel =
    panelConfigs.find((panel) => panel.id === activePanelId) ?? panelConfigs[0];

  if (!isAuthenticated) {
    return (
      <HomePage
        users={users}
        onLogin={handleLogin}
        authError={authError}
        onClearError={() => setAuthError(null)}
      />
    );
  }

  const headingTitle = isPureLecturer
    ? 'Uganda Christian University'
    : isAdmin
    ? 'Admin Control Centre'
    : 'Control Centre';

  const headingSubtitle =
    isPureLecturer
      ? 'Faculty of Computing & Informatics'
      : isAdmin
      ? 'Manage staff accounts, system settings, and administrative functions.'
      : 'Navigate workflow checkpoints and manage elevated privileges from one command hub.';

  return (
    <div className="min-h-screen bg-white text-slate-900 flex">
      <aside className="hidden w-72 flex-col border-r border-blue-300 bg-gradient-to-b from-blue-600 to-blue-700 lg:flex shadow-lg fixed left-0 top-0 h-screen">
        <div className="px-6 py-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-100">
            {currentUserHasRole('Lecturer') && !isAdmin
              ? 'Lecturer Portal'
              : isAdmin ? 'Admin Portal' : 'Digital Moderation'}
          </p>
          <h1 className="mt-3 text-2xl font-semibold text-white">
            {headingTitle}
          </h1>
          <p className="mt-2 text-xs text-blue-100">{headingSubtitle}</p>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-4 pb-6">
          {(() => {
            // Separate panels into categories
            // Include both 'overview' and 'lecturer-role-dashboard' for Dashboard button
            // But prioritize lecturer-role-dashboard for lecturers (remove overview if lecturer-role-dashboard exists)
            const allDashboardPanels = panelConfigs.filter(p => 
              p.id === 'overview' || p.id === 'lecturer-role-dashboard'
            );
            const hasLecturerRoleDashboard = allDashboardPanels.some(p => p.id === 'lecturer-role-dashboard');
            const dashboardPanels = hasLecturerRoleDashboard && isLecturer
              ? allDashboardPanels.filter(p => p.id === 'lecturer-role-dashboard')
              : allDashboardPanels;
            const lecturerPanelsList = panelConfigs.filter(p => 
              p.id.startsWith('lecturer-') && p.id !== 'lecturer-role-dashboard'
            );
            const chiefExaminerPanels = panelConfigs.filter(p => 
              p.id === 'chief-examiner-console' || 
              p.id === 'vetting-suite' || 
              p.id === 'destruction-log' ||
              p.id === 'chief-examiner-dashboard' ||
              p.id === 'chief-examiner-track-paper'
            );
            const teamLeadPanels = panelConfigs.filter(p => p.id === 'team-lead-panel' || p.id === 'team-lead-dashboard');
            const setterPanels = panelConfigs.filter(p => p.id === 'setter-panel');
            const adminPanelsList = panelConfigs.filter(p => p.id.startsWith('super-') || p.id.startsWith('admin-'));
            const otherPanels = panelConfigs.filter(p => 
              !p.id.startsWith('lecturer-') && 
              !p.id.startsWith('super-') && 
              !p.id.startsWith('admin-') && 
              p.id !== 'overview' &&
              !chiefExaminerPanels.includes(p) &&
              !teamLeadPanels.includes(p) &&
              !setterPanels.includes(p)
            );
            
            // For Admin users, exclude Chief Examiner panels
            // For Setter users, exclude Chief Examiner panels
            const filteredChiefExaminerPanels = (isAdmin || currentUserHasRole('Setter')) ? [] : chiefExaminerPanels;

            return (
              <>
                {/* Setter Panels */}
                {setterPanels.length > 0 && (
                  <>
                    {setterPanels.map((panel) => {
                      const isActive = panel.id === activePanelId;
                      // Split "Submit Paper Draft" to animate "Submit" and "Paper" separately
                      const labelParts = panel.label.split(' ');
                      return (
                        <button
                          key={panel.id}
                          type="button"
                          onClick={() => handlePanelSelect(panel.id)}
                          className={`flex w-full items-center justify-between rounded-xl border-2 px-4 py-3 text-left text-sm font-semibold transition-all shadow-lg mb-2 ${
                            isActive
                              ? 'border-pink-500/60 bg-gradient-to-r from-pink-500/20 via-rose-500/20 to-pink-500/20 text-pink-200 shadow-pink-500/30'
                              : 'border-pink-500/40 bg-gradient-to-r from-pink-500/10 via-rose-500/10 to-pink-500/10 text-pink-300 hover:border-pink-500/60 hover:bg-gradient-to-r hover:from-pink-500/20 hover:via-rose-500/20 hover:to-pink-500/20 hover:shadow-pink-500/40 hover:text-pink-200'
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1">
                              <span className="animate-heartbeat text-pink-400 font-bold" style={{ animationDelay: '0s' }}>Submit</span>
                              <span className="animate-heartbeat text-pink-400 font-bold" style={{ animationDelay: '0.15s' }}>Draft</span>
                            </span>
                          </span>
                          <span className={`text-xs ${isActive ? 'text-pink-400' : 'text-pink-500/60'}`}>{isActive ? '•' : '↗'}</span>
                        </button>
                      );
                    })}
                  </>
                )}

                {/* Dashboard Overview */}
                {dashboardPanels
                  // Prioritize lecturer-role-dashboard for lecturers, then show others
                  .sort((a, b) => {
                    if (a.id === 'lecturer-role-dashboard') return -1;
                    if (b.id === 'lecturer-role-dashboard') return 1;
                    return 0;
                  })
                  .map((panel) => {
                  const isActive = panel.id === activePanelId;
                  return (
                    <button
                      key={panel.id}
                      type="button"
                      onClick={() => handlePanelSelect(panel.id)}
                      className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-medium transition-all ${
                        isActive
                          ? 'border-blue-300 bg-blue-500 text-white shadow-md'
                          : 'border-transparent text-blue-100 hover:border-blue-300 hover:bg-blue-500/50 hover:text-white hover:shadow-sm'
                      }`}
                    >
                      <span className={`flex-shrink-0 ${isActive ? 'text-white' : 'text-blue-200'}`}>
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                        </svg>
                      </span>
                      <span className="flex-1">{panel.label}</span>
                      <span className={`text-xs flex-shrink-0 ${isActive ? 'text-white' : 'text-blue-200'}`}>{isActive ? '•' : '↗'}</span>
                    </button>
                  );
                })}

                {/* Team Lead Panels */}
                {teamLeadPanels.length > 0 && (
                  <>
                    {teamLeadPanels.map((panel) => {
                      const isActive = panel.id === activePanelId;
                      // Split "Team Lead Submission" to animate "Team" and "Lead" separately
                      const labelParts = panel.label.split(' ');
                      const submissionText = labelParts.slice(2).join(' ');
                      return (
                        <button
                          key={panel.id}
                          type="button"
                          onClick={() => handlePanelSelect(panel.id)}
                          className={`flex w-full items-center justify-between rounded-xl border-2 px-4 py-3 text-left text-sm font-semibold transition-all shadow-lg ${
                            isActive
                              ? 'border-violet-500/60 bg-gradient-to-r from-violet-500/20 via-purple-500/20 to-violet-500/20 text-violet-200 shadow-violet-500/30'
                              : 'border-violet-500/40 bg-gradient-to-r from-violet-500/10 via-purple-500/10 to-violet-500/10 text-violet-300 hover:border-violet-500/60 hover:bg-gradient-to-r hover:from-violet-500/20 hover:via-purple-500/20 hover:to-violet-500/20 hover:shadow-violet-500/40 hover:text-violet-200'
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1">
                              <span className="animate-heartbeat text-violet-400 font-bold" style={{ animationDelay: '0s' }}>Team</span>
                              <span className="animate-heartbeat text-violet-400 font-bold" style={{ animationDelay: '0.15s' }}>Lead</span>
                            </span>
                            {submissionText && <span className="text-violet-300/90 ml-1">{submissionText}</span>}
                          </span>
                          <span className={`text-xs ${isActive ? 'text-violet-400' : 'text-violet-500/60'}`}>{isActive ? '•' : '↗'}</span>
                        </button>
                      );
                    })}
                  </>
                )}

                {/* Chief Examiner / Workflow Panels */}
                {filteredChiefExaminerPanels.length > 0 && (
                  <>
                    <div className="mt-4 mb-2 px-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-white drop-shadow-sm">
                        Chief Examiner
                      </p>
                    </div>
                    {filteredChiefExaminerPanels.map((panel) => {
                      const isActive = panel.id === activePanelId;
                      
                      // Define unique colors for each Chief Examiner panel
                      // Give these a more "AI generated" neon-glow look with higher contrast
                      let panelStyles = {
                        active: 'border-cyan-400/80 bg-gradient-to-r from-cyan-400 via-sky-500 to-indigo-500 text-slate-900 shadow-[0_0_25px_rgba(34,211,238,0.65)]',
                        inactive: 'border-cyan-300/40 bg-gradient-to-r from-cyan-500/15 via-sky-500/15 to-indigo-500/15 text-cyan-100 hover:border-cyan-300/80 hover:bg-gradient-to-r hover:from-cyan-400/25 hover:via-sky-500/25 hover:to-indigo-500/25 hover:shadow-[0_0_22px_rgba(56,189,248,0.55)] hover:text-cyan-50',
                        textColor: 'text-cyan-50',
                        iconColor: 'text-cyan-200',
                        labelParts: panel.label.split(' ')
                      };

                      if (panel.id === 'vetting-suite') {
                        panelStyles = {
                          active: 'border-emerald-400/80 bg-gradient-to-r from-emerald-400 via-teal-400 to-sky-500 text-slate-900 shadow-[0_0_25px_rgba(16,185,129,0.7)]',
                          inactive: 'border-emerald-300/40 bg-gradient-to-r from-emerald-400/15 via-teal-400/15 to-sky-500/15 text-emerald-50 hover:border-emerald-300/80 hover:bg-gradient-to-r hover:from-emerald-400/25 hover:via-teal-400/25 hover:to-sky-500/25 hover:shadow-[0_0_22px_rgba(45,212,191,0.65)] hover:text-emerald-50',
                          textColor: 'text-emerald-50',
                          iconColor: 'text-emerald-100',
                          labelParts: panel.label.split(' & ')
                        };
                      } else if (panel.id === 'destruction-log') {
                        panelStyles = {
                          active: 'border-rose-400/80 bg-gradient-to-r from-rose-400 via-fuchsia-500 to-purple-600 text-slate-900 shadow-[0_0_25px_rgba(244,63,94,0.7)]',
                          inactive: 'border-rose-300/40 bg-gradient-to-r from-rose-500/15 via-fuchsia-500/15 to-purple-600/15 text-rose-100 hover:border-rose-300/80 hover:bg-gradient-to-r hover:from-rose-400/25 hover:via-fuchsia-500/25 hover:to-purple-600/25 hover:shadow-[0_0_22px_rgba(236,72,153,0.65)] hover:text-rose-50',
                          textColor: 'text-rose-50',
                          iconColor: 'text-rose-200',
                          labelParts: panel.label.split(' ')
                        };
                      }

                      return (
                        <button
                          key={panel.id}
                          type="button"
                          onClick={() => handlePanelSelect(panel.id)}
                          className={`flex w-full items-center justify-between rounded-xl border-2 px-4 py-3 text-left text-sm font-semibold transition-all shadow-lg mb-2 ${
                            isActive
                              ? panelStyles.active
                              : panelStyles.inactive
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            {panel.id === 'chief-examiner-console' && (
                              <span className="inline-flex items-center gap-1 tracking-wide">
                                <span
                                  className={`animate-heartbeat font-semibold ${isActive ? 'text-slate-900' : 'text-slate-50'}`}
                                  style={{ animationDelay: '0s' }}
                                >
                                  Chief
                                </span>
                                <span
                                  className={`animate-heartbeat font-semibold ${isActive ? 'text-slate-900' : 'text-slate-50'}`}
                                  style={{ animationDelay: '0.15s' }}
                                >
                                  Examiner
                                </span>
                                <span className={`ml-1 font-semibold ${isActive ? 'text-slate-900' : 'text-slate-50'}`}>
                                  Console
                                </span>
                              </span>
                            )}
                            {panel.id === 'vetting-suite' && (
                              <span className="inline-flex items-center gap-1 tracking-wide">
                                <span
                                  className={`animate-heartbeat font-semibold ${isActive ? 'text-slate-900' : 'text-slate-50'}`}
                                  style={{ animationDelay: '0s' }}
                                >
                                  Vetting
                                </span>
                                <span className={`ml-1 font-semibold ${isActive ? 'text-slate-900' : 'text-slate-50'}`}>
                                  &
                                </span>
                                <span
                                  className={`animate-heartbeat font-semibold ${isActive ? 'text-slate-900' : 'text-slate-50'}`}
                                  style={{ animationDelay: '0.15s' }}
                                >
                                  Annotations
                                </span>
                              </span>
                            )}
                            {panel.id === 'destruction-log' && (
                              <span className="inline-flex items-center gap-1 tracking-wide">
                                <span
                                  className={`animate-heartbeat font-semibold ${isActive ? 'text-slate-900' : 'text-slate-50'}`}
                                  style={{ animationDelay: '0s' }}
                                >
                                  Digital
                                </span>
                                <span
                                  className={`animate-heartbeat font-semibold ${isActive ? 'text-slate-900' : 'text-slate-50'}`}
                                  style={{ animationDelay: '0.15s' }}
                                >
                                  Destruction
                                </span>
                                <span className={`ml-1 font-semibold ${isActive ? 'text-slate-900' : 'text-slate-50'}`}>
                                  Log
                                </span>
                              </span>
                            )}
                            {!['chief-examiner-console', 'vetting-suite', 'destruction-log'].includes(panel.id) && (
                              <span>{panel.label}</span>
                            )}
                          </span>
                          <span className={`text-xs ${isActive ? panelStyles.textColor : panelStyles.iconColor}`}>{isActive ? '•' : '↗'}</span>
                        </button>
                      );
                    })}
                  </>
                )}

                {/* Lecturer Panels */}
                {lecturerPanelsList.length > 0 && (
                  <>
                    <div className="mt-4 mb-2 px-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-blue-100">
                        Teaching & Classes
                      </p>
                    </div>
                    {lecturerPanelsList.map((panel, index) => {
                      const isActive = panel.id === activePanelId;
                      
                      // Define icons for each panel
                      const getIcon = () => {
                        switch (panel.id) {
                          case 'lecturer-enter-marks':
                            return (
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                            );
                          case 'lecturer-search-student':
                            return (
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                              </svg>
                            );
                          case 'lecturer-monthly-report':
                            return (
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                            );
                          case 'lecturer-scheduling':
                            return (
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            );
                          case 'lecturer-classes':
                            return (
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                              </svg>
                            );
                          case 'lecturer-account-settings':
                            return (
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                            );
                          default:
                            return null;
                        }
                      };
                      
                      return (
                        <button
                          key={panel.id}
                          type="button"
                          onClick={() => handlePanelSelect(panel.id)}
                          className={`group relative flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs font-semibold shadow-sm transition-all duration-200 ${
                            isActive
                              ? 'border-emerald-400 bg-gradient-to-r from-emerald-500/20 via-sky-500/20 to-indigo-500/20 text-emerald-50 shadow-emerald-500/40'
                              : 'border-transparent bg-blue-900/10 text-blue-100 hover:border-emerald-300 hover:bg-gradient-to-r hover:from-emerald-500/15 hover:via-sky-500/15 hover:to-indigo-500/15 hover:text-emerald-50 hover:shadow-lg'
                          }`}
                        >
                          {/* subtle glow pill behind icon */}
                          <span
                            className={`absolute inset-y-1 left-2 w-10 rounded-xl blur-xl opacity-0 group-hover:opacity-70 transition-opacity duration-300 ${
                              isActive ? 'bg-emerald-400/60' : 'bg-sky-400/40'
                            }`}
                            aria-hidden="true"
                          />
                          <span className={`relative flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-lg border ${isActive ? 'border-emerald-300 bg-emerald-500/20 text-emerald-50' : 'border-blue-300/40 bg-blue-500/10 text-blue-200 group-hover:border-emerald-300 group-hover:text-emerald-50'}`}>
                            {getIcon()}
                          </span>
                          <span className="relative flex-1">
                            <span className="block text-[0.8rem]">
                              {panel.label}
                            </span>
                            <span className="mt-0.5 block text-[0.65rem] text-blue-200/80 group-hover:text-emerald-100/90">
                              {index === 0 && 'Quickly capture marks for your enrolled classes.'}
                              {index === 1 && 'Search and inspect individual student records.'}
                              {index === 2 && 'Generate rich monthly teaching and grading reports.'}
                              {index === 3 && 'Review your AI-organised timetable for the semester.'}
                              {index === 4 && 'See all the classes you are currently teaching.'}
                              {index === 5 && 'Adjust your profile and notification preferences.'}
                            </span>
                          </span>
                          <span className={`relative text-xs flex-shrink-0 ${isActive ? 'text-emerald-100' : 'text-blue-200/80 group-hover:text-emerald-100'}`}>
                            {isActive ? 'Active' : 'Explore'}
                          </span>
                        </button>
                      );
                    })}
                  </>
                )}

                {/* Admin Panels */}
                {adminPanelsList.length > 0 && (
                  <>
                    <div className="mt-4 mb-2 px-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-blue-100">
                        Administration
                      </p>
                    </div>
                    {adminPanelsList.map((panel) => {
                      const isActive = panel.id === activePanelId;
                      return (
                        <button
                          key={panel.id}
                          type="button"
                          onClick={() => handlePanelSelect(panel.id)}
                          className={`flex w-full items-center justify-between rounded-xl border px-4 py-2 text-left text-sm font-medium transition ${
                            isActive
                              ? 'border-blue-300 bg-blue-500 text-white shadow-md'
                              : 'border-transparent text-blue-100 hover:border-blue-300 hover:bg-blue-500/50 hover:text-white'
                          }`}
                        >
                          <span>{panel.label}</span>
                          <span className={`text-xs ${isActive ? 'text-white' : 'text-blue-200'}`}>{isActive ? '•' : '↗'}</span>
                        </button>
                      );
                    })}
                  </>
                )}

                {/* Other Panels */}
                {otherPanels.map((panel) => {
                  const isActive = panel.id === activePanelId;
                  return (
                    <button
                      key={panel.id}
                      type="button"
                      onClick={() => handlePanelSelect(panel.id)}
                      className={`flex w-full items-center justify-between rounded-xl border px-4 py-2 text-left text-sm font-medium transition ${
                        isActive
                          ? 'border-blue-300 bg-blue-500 text-white shadow-md'
                          : 'border-transparent text-blue-100 hover:border-blue-300 hover:bg-blue-500/50 hover:text-white'
                      }`}
                    >
                      <span>{panel.label}</span>
                      <span className={`text-xs ${isActive ? 'text-white' : 'text-blue-200'}`}>{isActive ? '•' : '↗'}</span>
                    </button>
                  );
                })}
              </>
            );
          })()}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col lg:ml-72">
        <header className="relative border-b border-slate-200 bg-white px-4 py-5 backdrop-blur sm:px-6 lg:px-10 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-blue-600">
                {isAdmin
                  ? 'Admin Dashboard'
                  : isChiefExaminer
                  ? 'Chief Examiner Console'
                  : isTeamLead
                  ? 'Team Lead Console'
                  : isVetter
                  ? 'Vetting Console'
                  : isSetter
                  ? 'Setter Console'
                  : isPureLecturer
                  ? 'Lecturer Dashboard'
                  : 'Current Stage'}
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-blue-900 sm:text-3xl">
                {isAdmin
                  ? 'System Administration'
                  : isChiefExaminer
                  ? 'Your currently assigned Chief Examiner role'
                  : isTeamLead
                  ? 'Your currently assigned Team Lead role'
                  : isVetter
                  ? 'Your currently assigned Vetting role'
                  : isSetter
                  ? 'Your currently assigned Setter role'
                  : isPureLecturer
                  ? 'Teaching & Student Engagement'
                  : workflow.stage.replace(/-/g, ' ')}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {isAdmin
                  ? 'Manage staff accounts and system configuration'
                  : isChiefExaminer
                  ? 'You now have privileges to assign and manage the exam process.'
                  : isTeamLead
                  ? 'You now have privileges to coordinate setters, vetters and manage team submissions.'
                  : isVetter
                  ? 'You now have privileges to review and vet exam papers.'
                  : isSetter
                  ? 'You now have privileges to prepare and submit exam papers for moderation.'
                  : isPureLecturer
                  ? 'Use the dashboard below to manage your classes, students and reports.'
                  : outstandingAction}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-indigo-50 px-3 py-2 text-xs shadow-sm sm:min-w-[210px]">
                <div className="pointer-events-none absolute -right-6 -top-6 h-16 w-16 rounded-full bg-blue-200/40 blur-2xl" />
                <p className="text-[0.6rem] font-semibold uppercase tracking-[0.25em] text-blue-600">
                  Signed In
                </p>
                <p className="mt-1 text-sm font-semibold text-blue-900">
                  {currentUser?.name ?? 'Unknown user'}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {currentUser?.roles.map((role) => (
                    <RoleBadge key={`header-${role}`} role={role} />
                  )) ?? []}
                  {currentUser?.roles.includes('Chief Examiner') && currentUser?.lecturerCategory && (
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-[0.65rem] font-semibold text-emerald-700 border border-emerald-200 shadow-inner">
                      {currentUser.lecturerCategory === 'Undergraduate' ? 'UG Chief Examiner' : 'PG Chief Examiner'}
                    </span>
                  )}
                  {currentUser && (
                    <span className="inline-flex items-center rounded-full bg-yellow-50 px-2.5 py-0.5 text-[0.65rem] font-semibold text-yellow-700 border border-yellow-200 shadow-inner">
                      Semester: Advent
                    </span>
                  )}
                  {currentUser?.courseUnit &&
                    currentUser.courseUnit.toLowerCase().includes('network') && (
                      <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-[0.65rem] font-semibold text-indigo-700 border border-indigo-200 shadow-inner">
                        {currentUser.roles.includes('Team Lead')
                          ? 'Team Lead – Networking'
                          : currentUser.roles.includes('Setter')
                          ? 'Setter – Networking'
                          : 'Networking'}
                      </span>
                    )}
                </div>
              </div>
              {/* Notification bell */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setShowNotificationPanel((open) => !open);
                    setNotifications((prev) =>
                      prev.map((n) => ({ ...n, read: true }))
                    );
                  }}
                  className="relative flex h-10 w-10 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-blue-700 shadow-sm hover:bg-blue-100 hover:border-blue-300 transition"
                  aria-label="Notifications"
                >
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.8}
                      d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                    />
                  </svg>
                  {notifications.some((n) => !n.read) && (
                    <span className="absolute -top-1 -right-1 h-4 min-w-[1rem] rounded-full bg-rose-500 px-1 text-[0.65rem] font-semibold leading-4 text-white">
                      {notifications.filter((n) => !n.read).length}
                    </span>
                  )}
                </button>
              </div>

              <button
                type="button"
                onClick={handleLogout}
                className="rounded-xl border border-blue-500/40 bg-blue-500/10 px-4 py-2 text-sm font-semibold text-blue-800 transition hover:bg-blue-400/20 hover:text-emerald-100"
              >
                Sign out
              </button>
            </div>
          </div>

          {/* Notification dropdown panel - light, AI-inspired */}
          <div
            className={`absolute right-4 top-full z-50 mt-3 w-[300px] sm:w-[340px] rounded-2xl border border-blue-100 bg-white/95 shadow-xl shadow-blue-200/60 backdrop-blur-md transition-all duration-300 origin-top-right transform ${
              showNotificationPanel
                ? 'pointer-events-auto opacity-100 translate-y-0 scale-100'
                : 'pointer-events-none opacity-0 -translate-y-2 scale-95'
            }`}
          >
            <div className="relative overflow-hidden rounded-2xl">
              <div className="pointer-events-none absolute -right-10 -top-16 h-28 w-28 rounded-full bg-indigo-200/70 blur-3xl" />
              <div className="pointer-events-none absolute -left-10 -bottom-16 h-32 w-32 rounded-full bg-cyan-200/60 blur-3xl" />

              <div className="relative flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <div>
                  <p className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-indigo-500/90">
                    Activity Stream
                  </p>
                  <p className="mt-0.5 text-sm font-semibold text-slate-900">
                    Notifications
                  </p>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center rounded-full border border-blue-100 bg-blue-50/70 px-2.5 py-1 text-[0.7rem] font-medium text-blue-800 shadow-sm transition hover:border-blue-300 hover:bg-blue-100 hover:text-blue-900"
                  onClick={() => setShowNotificationPanel(false)}
                >
                  Close
                </button>
              </div>

              <div className="relative max-h-72 space-y-2 overflow-y-auto px-4 py-3">
                {notifications.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No notifications yet. Assign a role to a lecturer to see it here.
                  </p>
                ) : (
                  notifications.map((note) => (
                    <div
                      key={note.id}
                      className={`group relative overflow-hidden rounded-xl border px-3 py-2 text-xs text-slate-800 shadow-sm transition-all duration-300 ${
                        note.read
                          ? 'border-slate-100 bg-slate-50/80'
                          : 'border-blue-200 bg-gradient-to-r from-blue-50 via-indigo-50 to-cyan-50 shadow-[0_0_0_1px_rgba(129,140,248,0.35)]'
                      } hover:translate-y-[-1px] hover:shadow-md hover:shadow-blue-200/80`}
                    >
                      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-indigo-200/70 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                      <p className="relative pr-4">{note.message}</p>
                      <p className="relative mt-1 text-[0.7rem] text-slate-400">
                        {new Date(note.timestamp).toLocaleString()}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3 lg:hidden">
            {panelConfigs.map((panel) => {
              const isActive = panel.id === activePanelId;
              return (
                <button
                  key={`mobile-${panel.id}`}
                  type="button"
                  onClick={() => handlePanelSelect(panel.id)}
                  className={`rounded-xl border-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                    isActive
                      ? 'border-blue-500 bg-blue-600 text-white shadow-md'
                      : 'border-blue-200 bg-white text-blue-700 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-800'
                  }`}
                >
                  {panel.label}
                </button>
              );
            })}
          </div>
        </header>

        {/* Toast notification for latest action */}
        {activeToast && (
          <div className="fixed top-20 right-4 z-50 max-w-sm rounded-2xl border border-blue-200 bg-white/98 px-4 py-3 shadow-xl backdrop-blur-sm">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 h-6 w-6 flex items-center justify-center rounded-full bg-blue-500 text-white">
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z"
                  />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                  Role Assigned
                </p>
                <p className="mt-1 text-sm text-slate-800">{activeToast.message}</p>
              </div>
            </div>
          </div>
        )}

        <main
          ref={mainContentRef}
          className="flex-1 overflow-y-auto px-4 py-8 sm:px-6 lg:px-10"
        >
          {activePanel ? (
            <div className="space-y-6">{activePanel.render()}</div>
          ) : null}
        </main>
      </div>
    </div>
  );
}

interface SectionCardProps {
  title: string;
  kicker?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
}

function SectionCard({
  title,
  kicker,
  description,
  actions,
  children,
  id,
}: SectionCardProps) {
  return (
    <section
      id={id}
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors transition-shadow duration-200 hover:border-indigo-200 hover:bg-gradient-to-b hover:from-white hover:to-indigo-50 hover:shadow-md"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          {kicker ? (
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
              {kicker}
            </p>
          ) : null}
          <h2 className="text-xl font-semibold text-slate-900 sm:text-2xl">
            {title}
          </h2>
          {description ? (
            <p className="mt-2 text-sm text-slate-600">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

const RoleBadge = ({ role }: { role: Role }) => (
  <span
    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${roleColours[role]} shadow-inner`}
  >
    {role}
  </span>
);

interface DashboardStatProps {
  label: string;
  value: string;
  tone?: 'blue' | 'red' | 'amber';
}

const statToneClasses: Record<
  NonNullable<DashboardStatProps['tone']>,
  string
> = {
  blue: 'border-blue-300 bg-blue-50 text-blue-800',
  red: 'border-red-300 bg-red-50 text-red-800',
  amber: 'border-amber-300 bg-amber-50 text-amber-800',
};

function DashboardStat({ label, value, tone }: DashboardStatProps) {
  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${
        tone ? statToneClasses[tone] : ''
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

interface StatusPillProps {
  label: string;
  active?: boolean;
  tone?: 'blue' | 'amber' | 'slate';
}

const toneClasses: Record<NonNullable<StatusPillProps['tone']>, string> = {
  blue: 'bg-blue-100 text-blue-800 border-blue-300',
  amber: 'bg-amber-100 text-amber-800 border-amber-300',
  slate: 'bg-slate-100 text-slate-800 border-slate-300',
};

const StatusPill = ({
  label,
  active = true,
  tone = 'blue',
}: StatusPillProps) => (
  <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
        active ? toneClasses[tone] : 'bg-slate-100 text-slate-500 border-slate-300'
      }`}
  >
    <span
      className={`h-2 w-2 rounded-full ${
        active ? 'bg-current animate-pulse' : 'bg-slate-600'
      }`}
    />
    {label}
  </span>
);

interface AdminAddLecturerPanelProps {
  onAddLecturer: (name: string, category?: 'Undergraduate' | 'Postgraduate', email?: string) => Promise<void>;
}

interface AdminViewLecturersPanelProps {
  users: User[];
}

interface PrivilegeDisplayProps {
  role: Role;
  showDetails?: boolean;
}

function PrivilegeDisplay({ role, showDetails = false }: PrivilegeDisplayProps) {
  const privilegeSet = rolePrivileges[role];
  if (!privilegeSet) return null;

  const categories = Array.from(new Set(privilegeSet.privileges.map(p => p.category)));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-slate-800">{role} Privileges</h4>
          <p className="mt-1 text-xs text-slate-600">
            {privilegeSet.totalPrivileges} total privileges • {privilegeSet.panelCount} access panels
          </p>
        </div>
        <div className="rounded-lg bg-blue-500/20 px-3 py-1">
          <span className="text-lg font-bold text-blue-700">{privilegeSet.totalPrivileges}</span>
        </div>
      </div>

      {showDetails && (
        <div className="mt-4 space-y-3 max-h-96 overflow-y-auto">
          {categories.map((category) => {
            const categoryPrivileges = privilegeSet.privileges.filter(p => p.category === category);
            return (
              <div key={category} className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 mb-2">
                  {category} ({categoryPrivileges.length})
                </p>
                <div className="space-y-1.5">
                  {categoryPrivileges.map((priv) => (
                    <div key={priv.id} className="flex items-start gap-2 text-xs">
                      <span className="text-blue-600 mt-0.5">•</span>
                      <div className="flex-1">
                        <p className="text-slate-800 font-medium">{priv.name}</p>
                        <p className="text-slate-500 mt-0.5">{priv.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AdminViewLecturersPanel({
  users,
}: AdminViewLecturersPanelProps) {
  const [lecturers, setLecturers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLecturer, setSelectedLecturer] = useState<User | null>(null);
  const [filterCategory, setFilterCategory] = useState<'All' | 'Undergraduate' | 'Postgraduate'>('All');
  const [editingCategory, setEditingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState<'Undergraduate' | 'Postgraduate' | ''>('');

  useEffect(() => {
    loadLecturers();
  }, []);

  const loadLecturers = async () => {
    setLoading(true);
    try {
      const { data: profiles, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('base_role', 'Lecturer')
        .order('name', { ascending: true });

      if (error) {
        console.error('Error loading lecturers:', error);
        // Fallback to users prop if available
        const lecturerUsers = users.filter(u => u.baseRole === 'Lecturer');
        setLecturers(lecturerUsers);
      } else {
        const lecturerUsers: User[] = (profiles || []).map((profile: any) => ({
          id: profile.id,
          name: profile.name,
          baseRole: 'Lecturer' as BaseRole,
          roles: (profile.roles || []) as Role[],
          password: '',
          email: profile.email || '',
          isSuperAdmin: profile.is_super_admin || false,
          campus: profile.campus,
          department: profile.department,
          lecturerCategory: profile.lecturer_category as 'Undergraduate' | 'Postgraduate' | undefined,
        }));
        setLecturers(lecturerUsers);
      }
    } catch (error) {
      console.error('Error loading lecturers:', error);
      const lecturerUsers = users.filter(u => u.baseRole === 'Lecturer');
      setLecturers(lecturerUsers);
    } finally {
      setLoading(false);
    }
  };

  const undergraduateLecturers = lecturers.filter(l => l.lecturerCategory === 'Undergraduate');
  const postgraduateLecturers = lecturers.filter(l => l.lecturerCategory === 'Postgraduate');
  const uncategorizedLecturers = lecturers.filter(l => !l.lecturerCategory);

  const displayedLecturers = filterCategory === 'All' 
    ? lecturers 
    : lecturers.filter(lecturer => lecturer.lecturerCategory === filterCategory);
  
  const getUserTotalPrivileges = (user: User): number => {
    const uniqueRoles = Array.from(new Set(user.roles));
    return uniqueRoles.reduce((total, role) => {
      const rolePriv = rolePrivileges[role];
      return total + (rolePriv ? rolePriv.totalPrivileges : 0);
    }, 0);
  };

  const handleUpdateCategory = async (lecturerId: string, category: 'Undergraduate' | 'Postgraduate') => {
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ lecturer_category: category })
        .eq('id', lecturerId);

      if (error) {
        console.error('Error updating category:', error);
        alert(`Failed to update category: ${error.message}`);
        return;
      }

      // Update local state
      setLecturers(prev => prev.map(lec => 
        lec.id === lecturerId 
          ? { ...lec, lecturerCategory: category }
          : lec
      ));

      if (selectedLecturer?.id === lecturerId) {
        setSelectedLecturer(prev => prev ? { ...prev, lecturerCategory: category } : null);
      }

      setEditingCategory(false);
      setNewCategory('');
      alert('Category updated successfully!');
      // Reload lecturers to ensure data is in sync
      loadLecturers();
    } catch (error) {
      console.error('Error updating category:', error);
      alert('Failed to update category. Please try again.');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-blue-700">Loading lecturers...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionCard
        title="View Lecturers by Category"
        kicker="Staff Directory"
        description="View all lecturers organized by undergraduate and postgraduate categories."
      >
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="mb-4">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
              Filter by Category
            </label>
            <select
              value={filterCategory}
              onChange={(e) => {
                setFilterCategory(e.target.value as 'All' | 'Undergraduate' | 'Postgraduate');
                setSelectedLecturer(null);
              }}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            >
              <option value="All">All Lecturers</option>
              <option value="Undergraduate">Undergraduate Lecturers</option>
              <option value="Postgraduate">Postgraduate Lecturers</option>
            </select>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-center">
              <p className="text-xs font-semibold text-blue-700 mb-1">Total</p>
              <p className="text-2xl font-bold text-blue-800">{lecturers.length}</p>
            </div>
            <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-center">
              <p className="text-xs font-semibold text-green-700 mb-1">Undergraduate</p>
              <p className="text-2xl font-bold text-green-800">{undergraduateLecturers.length}</p>
            </div>
            <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 p-3 text-center">
              <p className="text-xs font-semibold text-purple-700 mb-1">Postgraduate</p>
              <p className="text-2xl font-bold text-purple-800">{postgraduateLecturers.length}</p>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Undergraduate Lecturers Section */}
      {undergraduateLecturers.length > 0 && (filterCategory === 'All' || filterCategory === 'Undergraduate') && (
        <SectionCard
          title="Undergraduate Lecturers"
          kicker="Staff List"
          description={`${undergraduateLecturers.length} undergraduate lecturer${undergraduateLecturers.length !== 1 ? 's' : ''}`}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {undergraduateLecturers.map((lecturer, index) => {
              const totalPrivs = getUserTotalPrivileges(lecturer);
              const hasVettingRole = lecturer.roles.includes('Vetter') || lecturer.roles.includes('Team Lead') || lecturer.roles.includes('Setter');
              
              return (
                <motion.button
                  key={lecturer.id}
                  type="button"
                  onClick={() => setSelectedLecturer(lecturer)}
                  className={`group relative rounded-xl border-2 p-4 text-left overflow-hidden transition-all duration-300 ${
                    selectedLecturer?.id === lecturer.id
                      ? 'border-green-500 bg-gradient-to-br from-green-50 to-white shadow-lg'
                      : 'border-green-200 bg-gradient-to-br from-white to-green-50/30 hover:border-green-400 hover:shadow-md'
                  }`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.05 }}
                  whileHover={{ scale: 1.02, y: -2 }}
                >
                  {/* Animated background gradient on hover */}
                  <motion.div
                    className="absolute inset-0 bg-gradient-to-r from-green-100/0 to-green-100/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                    initial={false}
                  />
                  
                  <div className="relative z-10">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {/* Avatar */}
                        <div className="flex-shrink-0 w-12 h-12 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center text-white font-bold text-base shadow-md">
                          {lecturer.name?.charAt(0)?.toUpperCase() || 'L'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-green-900 truncate">{lecturer.name}</p>
                          {lecturer.department && (
                            <p className="text-xs text-green-600 mt-0.5 flex items-center gap-1">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                              </svg>
                              {lecturer.department}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-green-500 to-green-600 text-white text-xs font-bold shadow-md">
                          UG
                        </span>
                        {hasVettingRole && (
                          <motion.span
                            className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-amber-500 text-white text-xs font-bold shadow-md"
                            whileHover={{ scale: 1.1 }}
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                            </svg>
                          </motion.span>
                        )}
                      </div>
                    </div>
                    
                    {/* Roles */}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {lecturer.roles.length > 0 ? (
                        lecturer.roles.map((role) => (
                          <motion.div key={role} whileHover={{ scale: 1.05 }}>
                            <RoleBadge role={role} />
                          </motion.div>
                        ))
                      ) : (
                        <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
                          No roles
                        </span>
                      )}
                    </div>
                    
                    {/* Privileges count */}
                    <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-green-600 bg-green-50 px-2.5 py-1.5 rounded-full border border-green-200 inline-flex">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                      {totalPrivs} total privileges
                    </div>
                  </div>
                </motion.button>
              );
            })}
        </div>
      </SectionCard>
      )}

      {/* Postgraduate Lecturers Section */}
      {postgraduateLecturers.length > 0 && (filterCategory === 'All' || filterCategory === 'Postgraduate') && (
        <SectionCard
          title="Postgraduate Lecturers"
          kicker="Staff List"
          description={`${postgraduateLecturers.length} postgraduate lecturer${postgraduateLecturers.length !== 1 ? 's' : ''}`}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {postgraduateLecturers.map((lecturer, index) => {
              const totalPrivs = getUserTotalPrivileges(lecturer);
              const hasVettingRole = lecturer.roles.includes('Vetter') || lecturer.roles.includes('Team Lead') || lecturer.roles.includes('Setter');
              
              return (
                <motion.button
                  key={lecturer.id}
                  type="button"
                  onClick={() => setSelectedLecturer(lecturer)}
                  className={`group relative rounded-xl border-2 p-4 text-left overflow-hidden transition-all duration-300 ${
                    selectedLecturer?.id === lecturer.id
                      ? 'border-purple-500 bg-gradient-to-br from-purple-50 to-white shadow-lg'
                      : 'border-purple-200 bg-gradient-to-br from-white to-purple-50/30 hover:border-purple-400 hover:shadow-md'
                  }`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.05 }}
                  whileHover={{ scale: 1.02, y: -2 }}
                >
                  {/* Animated background gradient on hover */}
                  <motion.div
                    className="absolute inset-0 bg-gradient-to-r from-purple-100/0 to-purple-100/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                    initial={false}
                  />
                  
                  <div className="relative z-10">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {/* Avatar */}
                        <div className="flex-shrink-0 w-12 h-12 rounded-full bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center text-white font-bold text-base shadow-md">
                          {lecturer.name?.charAt(0)?.toUpperCase() || 'L'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-purple-900 truncate">{lecturer.name}</p>
                          {lecturer.department && (
                            <p className="text-xs text-purple-600 mt-0.5 flex items-center gap-1">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                              </svg>
                              {lecturer.department}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-purple-600 text-white text-xs font-bold shadow-md">
                          PG
                        </span>
                        {hasVettingRole && (
                          <motion.span
                            className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-amber-500 text-white text-xs font-bold shadow-md"
                            whileHover={{ scale: 1.1 }}
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                            </svg>
                          </motion.span>
                        )}
                      </div>
                    </div>
                    
                    {/* Roles */}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {lecturer.roles.length > 0 ? (
                        lecturer.roles.map((role) => (
                          <motion.div key={role} whileHover={{ scale: 1.05 }}>
                            <RoleBadge role={role} />
                          </motion.div>
                        ))
                      ) : (
                        <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
                          No roles
                        </span>
                      )}
                    </div>
                    
                    {/* Privileges count */}
                    <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-purple-600 bg-purple-50 px-2.5 py-1.5 rounded-full border border-purple-200 inline-flex">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                      {totalPrivs} total privileges
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* Uncategorized Lecturers Section */}
      {uncategorizedLecturers.length > 0 && filterCategory === 'All' && (
        <SectionCard
          title="Uncategorized Lecturers"
          kicker="Staff List"
          description={`${uncategorizedLecturers.length} lecturer${uncategorizedLecturers.length !== 1 ? 's' : ''} without category assignment`}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {uncategorizedLecturers.map((lecturer) => {
              const totalPrivs = getUserTotalPrivileges(lecturer);
              const hasVettingRole = lecturer.roles.includes('Vetter') || lecturer.roles.includes('Team Lead') || lecturer.roles.includes('Setter');
              
              return (
                <button
                  key={lecturer.id}
                  type="button"
                  onClick={() => setSelectedLecturer(lecturer)}
                  className={`rounded-xl border p-4 text-left transition ${
                    selectedLecturer?.id === lecturer.id
                      ? 'border-slate-500/50 bg-slate-500/10'
                      : 'border-slate-200 bg-white hover:border-slate-500/40'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-slate-800">{lecturer.name}</p>
                      {lecturer.department && (
                        <p className="text-xs text-slate-600 mt-1">{lecturer.department}</p>
                      )}
                    </div>
                    {hasVettingRole && (
                      <span className="text-xs font-semibold text-amber-400 bg-amber-500/20 px-2 py-1 rounded">
                        Vetting
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {lecturer.roles.map((role) => (
                      <RoleBadge key={role} role={role} />
                    ))}
                  </div>
                  <div className="mt-2 text-xs text-blue-700">
                    {totalPrivs} total privileges
                  </div>
                </button>
              );
            })}
          </div>
        </SectionCard>
      )}

      {selectedLecturer && (
        <SectionCard
          title={`Lecturer Details: ${selectedLecturer.name}`}
          kicker="Profile Information"
          description="Detailed information about this lecturer's account and privileges."
        >
          <div className="relative overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-br from-slate-50 via-white to-blue-50 p-6 shadow-md space-y-5">
            {/* soft background orbs */}
            <div className="pointer-events-none absolute -left-16 -top-10 h-40 w-40 rounded-full bg-sky-300/20 blur-3xl" />
            <div className="pointer-events-none absolute -right-10 top-24 h-40 w-40 rounded-full bg-indigo-300/20 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-16 left-1/3 h-40 w-40 rounded-full bg-emerald-300/20 blur-3xl" />

            {/* main grid */}
            <div className="relative grid gap-6 sm:grid-cols-2">
              <div>
                <p className="flex items-center gap-1 text-[0.7rem] font-semibold uppercase tracking-wide text-sky-600 mb-1">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-sky-500/10 text-sky-600">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M5.121 17.804A4 4 0 017 11h10a4 4 0 011.879 6.804L17 21H7l-1.879-3.196z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </span>
                  Full Name
                </p>
                <p className="text-base font-semibold text-slate-900">{selectedLecturer.name}</p>
              </div>
              {selectedLecturer.department && (
              <div>
                <p className="flex items-center gap-1 text-[0.7rem] font-semibold uppercase tracking-wide text-violet-600 mb-1">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-violet-500/10 text-violet-600">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3 7l9-4 9 4-9 4-9-4z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3 12l9 4 9-4" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3 17l9 4 9-4" />
                    </svg>
                  </span>
                  Department
                </p>
                  <p className="text-sm font-semibold text-slate-900">{selectedLecturer.department}</p>
                </div>
              )}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-slate-600">Category</p>
                  {!editingCategory && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCategory(true);
                        setNewCategory(selectedLecturer.lecturerCategory || '');
                      }}
                      className="text-xs text-blue-600 hover:text-blue-700 underline"
                    >
                      {selectedLecturer.lecturerCategory ? 'Change' : 'Assign'}
                    </button>
                  )}
                </div>
                {editingCategory ? (
                  <div className="flex items-center gap-2">
                    <select
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value as 'Undergraduate' | 'Postgraduate' | '')}
                      className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                    >
                      <option value="">Select category...</option>
                      <option value="Undergraduate">Undergraduate</option>
                      <option value="Postgraduate">Postgraduate</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        if (newCategory && selectedLecturer) {
                          handleUpdateCategory(selectedLecturer.id, newCategory as 'Undergraduate' | 'Postgraduate');
                        }
                      }}
                      disabled={!newCategory}
                      className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-blue-300"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCategory(false);
                        setNewCategory('');
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-slate-800">
                    {selectedLecturer.lecturerCategory ? (
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold ${
                        selectedLecturer.lecturerCategory === 'Undergraduate'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-purple-100 text-purple-700'
                      }`}>
                        {selectedLecturer.lecturerCategory}
                      </span>
                    ) : (
                      <span className="text-slate-400 italic">Not assigned</span>
                    )}
                  </p>
                )}
              </div>
              <div>
                <p className="flex items-center gap-1 text-[0.7rem] font-semibold uppercase tracking-wide text-indigo-600 mb-1">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-600">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  Base Role
                </p>
                <p className="inline-flex items-center gap-2 rounded-full bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-700 shadow-inner">
                  <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
                  {selectedLecturer.baseRole}
                </p>
              </div>
              <div>
                <p className="flex items-center gap-1 text-[0.7rem] font-semibold uppercase tracking-wide text-emerald-600 mb-1">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M11 3v18m0 0l-4-4m4 4l4-4" />
                    </svg>
                  </span>
                  Total Privileges
                </p>
                <p className="text-base font-semibold text-emerald-700">
                  {getUserTotalPrivileges(selectedLecturer)}
                </p>
              </div>
              {selectedLecturer.campus && (
                <div>
                  <p className="flex items-center gap-1 text-[0.7rem] font-semibold uppercase tracking-wide text-sky-600 mb-1">
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-sky-500/10 text-sky-600">
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 11c1.657 0 3-1.343 3-3S13.657 5 12 5 9 6.343 9 8s1.343 3 3 3z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M19.5 10.5C18.194 14.357 15.457 17.5 12 19.5 8.543 17.5 5.806 14.357 4.5 10.5" />
                      </svg>
                    </span>
                    Campus
                  </p>
                  <p className="text-sm font-semibold text-slate-900">{selectedLecturer.campus}</p>
                </div>
              )}
            </div>

            {/* roles section */}
            <div className="relative">
              <p className="flex items-center gap-1 text-[0.7rem] font-semibold uppercase tracking-wide text-slate-600 mb-2">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-slate-500/10 text-slate-600">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M16 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 14c-4.418 0-8 1.79-8 4v1h16v-1c0-2.21-3.582-4-8-4z" />
                  </svg>
                </span>
                Assigned Roles
              </p>
              <div className="flex flex-wrap gap-2">
                {selectedLecturer.roles.map((role) => (
                  <RoleBadge key={role} role={role} />
                ))}
              </div>
            </div>
            {(selectedLecturer.roles.includes('Vetter') || selectedLecturer.roles.includes('Team Lead') || selectedLecturer.roles.includes('Setter')) && (
              <div className="relative rounded-xl border border-amber-400/40 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-rose-500/10 p-3.5 shadow-sm">
                <div className="pointer-events-none absolute -right-4 -top-4 h-16 w-16 rounded-full bg-amber-300/30 blur-2xl" />
                <p className="flex items-center gap-1 text-[0.7rem] font-semibold uppercase tracking-wide text-amber-200 mb-1">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-500/20 text-amber-100">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M9 12l2 2 4-4m5-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </span>
                  Vetting Staff Member
                </p>
                <p className="text-xs text-amber-100">
                  This lecturer is assigned to the moderation workflow as {selectedLecturer.roles.find(r => ['Vetter', 'Team Lead', 'Setter'].includes(r)) || 'Staff Member'}.
                </p>
              </div>
            )}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

function AdminAddLecturerPanel({
  onAddLecturer,
}: AdminAddLecturerPanelProps) {
  const [lecturerName, setLecturerName] = useState('');
  const [lecturerCategory, setLecturerCategory] = useState<'Undergraduate' | 'Postgraduate' | ''>('');
  const [lecturerEmail, setLecturerEmail] = useState('');
  const [showPrivileges, setShowPrivileges] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!lecturerName.trim() || !lecturerEmail.trim() || !lecturerCategory) {
      return;
    }

    setIsSubmitting(true);
    try {
      const category = lecturerCategory as 'Undergraduate' | 'Postgraduate';
      await onAddLecturer(lecturerName, category, lecturerEmail);
    setLecturerName('');
      setLecturerCategory('');
      setLecturerEmail('');
    } catch (error) {
      console.error('Error creating lecturer:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const lecturerPrivileges = rolePrivileges['Lecturer'];

  return (
    <div className="space-y-4">
    <SectionCard
      title="Register Lecturer Account"
      kicker="Admin Action"
      description={`Create a lecturer profile. Default password is ${DEFAULT_PASSWORD}; advise the lecturer to update it after first login.`}
    >
      <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
            Lecturer Full Name *
        </label>
        <input
          value={lecturerName}
          onChange={(event) => setLecturerName(event.target.value)}
          placeholder="e.g. Dr. Jane Mwangi"
            required
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          />
        </div>
        
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
            Email Address *
          </label>
          <input
            type="email"
            value={lecturerEmail}
            onChange={(event) => setLecturerEmail(event.target.value)}
            placeholder="e.g. jane.mwangi@university.ac.ke"
            required
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
            Category *
          </label>
          <select
            value={lecturerCategory}
            onChange={(e) => setLecturerCategory(e.target.value as 'Undergraduate' | 'Postgraduate' | '')}
            required
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          >
            <option value="">Select category...</option>
            <option value="Undergraduate">Undergraduate</option>
            <option value="Postgraduate">Postgraduate</option>
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Select whether this lecturer teaches undergraduate or postgraduate courses.
          </p>
        </div>
        <button
          type="submit"
          disabled={!lecturerName.trim() || !lecturerEmail.trim() || !lecturerCategory || isSubmitting}
          className="w-full rounded-xl bg-blue-500/90 px-4 py-2 text-sm font-semibold text-emerald-950 shadow transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:bg-blue-500/30 disabled:text-emerald-900"
        >
          {isSubmitting ? 'Creating...' : 'Create Lecturer'}
        </button>
      </form>
    </SectionCard>

      <SectionCard
        title="Lecturer Privileges Overview"
        kicker="Access Rights"
        description="This lecturer will have the following privileges in the system:"
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-500/20 px-4 py-2">
              <p className="text-xs text-slate-600">Total Privileges</p>
              <p className="text-2xl font-bold text-blue-700">{lecturerPrivileges.totalPrivileges}</p>
            </div>
            <div className="rounded-lg bg-blue-500/20 px-4 py-2">
              <p className="text-xs text-slate-600">Access Panels</p>
              <p className="text-2xl font-bold text-blue-700">{lecturerPrivileges.panelCount}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowPrivileges(!showPrivileges)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            {showPrivileges ? 'Hide Details' : 'Show Details'}
          </button>
        </div>
        <PrivilegeDisplay role="Lecturer" showDetails={showPrivileges} />
      </SectionCard>
    </div>
  );
}

interface AdminAddAdminPanelProps {
  onAddAdmin: (name: string, email: string, isSuperAdmin: boolean) => Promise<void>;
}

function AdminAddAdminPanel({ onAddAdmin }: AdminAddAdminPanelProps) {
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [isSuperAdminFlag, setIsSuperAdminFlag] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!adminName.trim() || !adminEmail.trim()) return;

    setIsSubmitting(true);
    try {
      await onAddAdmin(adminName, adminEmail, isSuperAdminFlag);
      setAdminName('');
      setAdminEmail('');
      setIsSuperAdminFlag(false);
    } catch (error) {
      console.error('Error creating admin:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SectionCard
      title="Register Additional Admin"
      kicker="Admin Action"
      description={`Provision another administrator account. Default password is ${DEFAULT_PASSWORD}.`}
    >
      <form
        onSubmit={handleSubmit}
        className="relative overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-br from-slate-50 via-white to-indigo-50 p-5 space-y-5 shadow-md"
      >
        {/* background accents */}
        <div className="pointer-events-none absolute -left-16 -top-10 h-32 w-32 rounded-full bg-sky-300/25 blur-3xl" />
        <div className="pointer-events-none absolute -right-12 top-10 h-32 w-32 rounded-full bg-indigo-300/25 blur-3xl" />
        <div className="pointer-events-none absolute left-1/3 -bottom-14 h-32 w-32 rounded-full bg-emerald-300/25 blur-3xl" />

        <div className="relative grid gap-4 md:grid-cols-2">
          <div>
            <label className="flex items-center gap-1 text-[0.7rem] font-semibold uppercase tracking-wide text-sky-600">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-sky-500/10 text-sky-600">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M5.121 17.804A4 4 0 017 11h10a4 4 0 011.879 6.804L17 21H7l-1.879-3.196z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </span>
              Admin full name *
            </label>
            <input
              value={adminName}
              onChange={(event) => setAdminName(event.target.value)}
              placeholder="e.g. Prof. Samuel Otieno"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white/95 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-500 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-400/40"
              required
            />
          </div>

          <div>
            <label className="flex items-center gap-1 text-[0.7rem] font-semibold uppercase tracking-wide text-violet-600">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-violet-500/10 text-violet-600">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M16 12a4 4 0 01-8 0" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 8a4 4 0 014-4h8a4 4 0 014 4v1a9 9 0 01-9 9 9 9 0 01-9-9V8z" />
                </svg>
              </span>
              Admin email *
            </label>
            <input
              type="email"
              value={adminEmail}
              onChange={(event) => setAdminEmail(event.target.value)}
              placeholder="e.g. admin@university.ac.ke"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white/95 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-500 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-400/40"
              required
            />
          </div>
        </div>

        <div className="relative flex items-center gap-3 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50/80 via-amber-50 to-rose-50 px-3 py-2.5 shadow-sm">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.97a1 1 0 00.95.69h4.178c.969 0 1.371 1.24.588 1.81l-3.384 2.46a1 1 0 00-.364 1.118l1.287 3.97c.3.921-.755 1.688-1.54 1.118l-3.385-2.46a1 1 0 00-1.176 0l-3.385 2.46c-.784.57-1.838-.197-1.539-1.118l1.287-3.97a1 1 0 00-.364-1.118l-3.384-2.46c-.783-.57-.38-1.81.588-1.81h4.178a1 1 0 00.95-.69l1.286-3.97z" />
            </svg>
          </span>
          <div className="flex-1">
            <label htmlFor="isSuperAdmin" className="text-xs font-semibold text-amber-900 flex items-center gap-1">
              Grant Super Admin privileges
            </label>
            <p className="text-[0.7rem] text-amber-700/90">
              Super Admins can manage system-wide settings and staff accounts. Use this carefully.
            </p>
          </div>
          <input
            id="isSuperAdmin"
            type="checkbox"
            checked={isSuperAdminFlag}
            onChange={(e) => setIsSuperAdminFlag(e.target.checked)}
            className="h-4 w-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
          />
        </div>

        <button
          type="submit"
          disabled={!adminName.trim() || !adminEmail.trim() || isSubmitting}
          className="relative mt-1 w-full overflow-hidden rounded-2xl bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition hover:from-blue-400 hover:via-indigo-400 hover:to-purple-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="absolute inset-0 bg-white/10 opacity-0 blur-3xl transition-opacity duration-200 hover:opacity-40" />
          <span className="relative">
            {isSubmitting ? 'Creating...' : 'Create Admin Account'}
          </span>
        </button>
      </form>
    </SectionCard>
  );
}

interface SuperUserChiefExaminerPanelProps {
  users: User[];
  chiefExaminerRoleEnabled: boolean;
  onEnableChiefExaminerRole: () => void;
  onPromoteToChiefExaminer: (userId: string) => void;
  onUnassignChiefExaminer: (userId: string) => void;
}

function SuperUserChiefExaminerPanel({
  users,
  chiefExaminerRoleEnabled,
  onEnableChiefExaminerRole,
  onPromoteToChiefExaminer,
  onUnassignChiefExaminer,
}: SuperUserChiefExaminerPanelProps) {
  const [promotionTarget, setPromotionTarget] = useState('');
  const [removalTarget, setRemovalTarget] = useState('');
  const [showPrivilegeGain, setShowPrivilegeGain] = useState(true);
  const [activeTab, setActiveTab] = useState<'activate' | 'promote' | 'remove'>('activate');

  const eligibleLecturers = useMemo(
    () =>
      users.filter(
        (user) =>
          user.baseRole === 'Lecturer' &&
          !user.roles.includes('Chief Examiner')
      ),
    [users]
  );

  const currentChiefExaminers = useMemo(
    () => users.filter((user) => user.roles.includes('Chief Examiner')),
    [users]
  );

  const handlePromotion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (promotionTarget) {
      onPromoteToChiefExaminer(promotionTarget);
      setPromotionTarget('');
      setActiveTab('activate');
    }
  };

  const handleRemoval = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (removalTarget) {
      onUnassignChiefExaminer(removalTarget);
      setRemovalTarget('');
    }
  };

  const selectedLecturer = users.find(u => u.id === promotionTarget);
  const lecturerPrivileges = rolePrivileges['Lecturer'];
  const chiefExaminerPrivileges = rolePrivileges['Chief Examiner'];
  const privilegeGain = chiefExaminerPrivileges.totalPrivileges - lecturerPrivileges.totalPrivileges;

  return (
    <div className="space-y-6">
      {/* Status Banner */}
      <div className={`rounded-xl border p-4 ${
        chiefExaminerRoleEnabled
          ? 'border-blue-500/50 bg-blue-500/10'
          : 'border-amber-500/50 bg-amber-500/10'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`h-3 w-3 rounded-full ${
              chiefExaminerRoleEnabled ? 'bg-blue-500' : 'bg-amber-500'
            }`} />
            <div>
              <p className="text-sm font-semibold text-slate-800">
                {chiefExaminerRoleEnabled ? 'Chief Examiner Role Active' : 'Chief Examiner Role Locked'}
              </p>
              <p className="text-xs text-slate-600 mt-0.5">
                {chiefExaminerRoleEnabled
                  ? 'Role template is enabled. You can now assign Chief Examiner privileges to lecturers.'
                  : 'Enable the role template to begin assigning Chief Examiner privileges.'}
              </p>
            </div>
          </div>
          <StatusPill
            label={chiefExaminerRoleEnabled ? 'Active' : 'Locked'}
            active={chiefExaminerRoleEnabled}
            tone={chiefExaminerRoleEnabled ? 'blue' : 'amber'}
          />
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveTab('activate')}
          className={`px-4 py-2 text-sm font-medium transition ${
            activeTab === 'activate'
              ? 'border-b-2 border-blue-500 text-blue-700'
              : 'text-slate-600 hover:text-slate-700'
          }`}
        >
          Activate Role
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('promote')}
          className={`px-4 py-2 text-sm font-medium transition ${
            activeTab === 'promote'
              ? 'border-b-2 border-blue-500 text-blue-700'
              : 'text-slate-600 hover:text-slate-700'
          }`}
        >
          Assign Role
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('remove')}
          className={`px-4 py-2 text-sm font-medium transition ${
            activeTab === 'remove'
              ? 'border-b-2 border-rose-500 text-rose-300'
              : 'text-slate-600 hover:text-slate-700'
          }`}
        >
          Remove Role
        </button>
      </div>

      {/* Tab Content */}
      <div className="space-y-6">
        {/* Activate Role Tab */}
        {activeTab === 'activate' && (
          <SectionCard
            title="Activate Chief Examiner Role Template"
            kicker="Step 1: Enable Role"
            description="Unlock the Chief Examiner role template to enable assignment of elevated moderation privileges."
          >
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <div className="mb-6">
                <h3 className="text-base font-semibold text-slate-800 mb-2">
                  What This Enables
                </h3>
                <ul className="space-y-2 text-sm text-slate-600">
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 mt-0.5">•</span>
                    <span>Orchestration privileges for workflow management</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 mt-0.5">•</span>
                    <span>Ability to award roles (Team Lead, Vetter, Setter)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 mt-0.5">•</span>
                    <span>Repository and deadline management controls</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 mt-0.5">•</span>
                    <span>Final approval authority for exam submissions</span>
                  </li>
                </ul>
              </div>
              <button
                type="button"
                onClick={onEnableChiefExaminerRole}
                disabled={chiefExaminerRoleEnabled}
                className={`w-full rounded-xl px-6 py-3 text-sm font-semibold transition ${
                  chiefExaminerRoleEnabled
                    ? 'bg-blue-500/30 text-blue-700 cursor-not-allowed'
                    : 'bg-blue-500/90 text-emerald-950 hover:bg-blue-400'
                }`}
              >
                {chiefExaminerRoleEnabled
                  ? '✓ Role Template Enabled'
                  : 'Enable Chief Examiner Role Template'}
              </button>
            </div>
          </SectionCard>
        )}

        {/* Promote Tab */}
        {activeTab === 'promote' && (
          <div className="space-y-6">
            <SectionCard
              title="Assign Chief Examiner Role"
              kicker="Step 2: Promote Lecturer"
              description="Select a lecturer to elevate to Chief Examiner. They will gain additional privileges while retaining all lecturer access."
            >
              <form onSubmit={handlePromotion} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
                    Select Lecturer to Promote
                  </label>
                  <select
                    value={promotionTarget}
                    onChange={(event) => {
                      setPromotionTarget(event.target.value);
                      setShowPrivilegeGain(true);
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={!chiefExaminerRoleEnabled || eligibleLecturers.length === 0}
                  >
                    <option value="">
                      {eligibleLecturers.length === 0
                        ? 'No eligible lecturers available'
                        : 'Choose a lecturer...'}
                    </option>
                    {eligibleLecturers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                  </select>
                  {!chiefExaminerRoleEnabled && (
                    <p className="mt-2 text-xs text-amber-400">
                      ⚠️ Please activate the role template first
                    </p>
                  )}
                </div>

                {promotionTarget && selectedLecturer && (
                  <div className="rounded-xl border border-blue-500/50 bg-blue-500/10 p-5">
                    <div className="mb-4 flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-semibold text-indigo-200">
                          Privilege Preview: {selectedLecturer.name}
                        </h4>
                        <p className="mt-1 text-xs text-blue-600">
                          Review the privileges that will be granted
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowPrivilegeGain(!showPrivilegeGain)}
                        className="rounded-lg border border-blue-500/40 bg-blue-500/20 px-3 py-1 text-xs font-semibold text-blue-700 transition hover:bg-blue-500/30"
                      >
                        {showPrivilegeGain ? 'Hide' : 'Show'} Details
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-3 mb-4">
                      <div className="rounded-lg bg-white border border-slate-200 p-4 text-center">
                        <p className="text-xs text-slate-600 mb-1">Current</p>
                        <p className="text-3xl font-bold text-slate-700">{lecturerPrivileges.totalPrivileges}</p>
                        <p className="text-xs text-slate-500 mt-1">Lecturer</p>
                      </div>
                      <div className="rounded-lg bg-blue-500/20 border border-blue-500/40 p-4 text-center">
                        <p className="text-xs text-blue-600 mb-1">Additional</p>
                        <p className="text-3xl font-bold text-blue-700">+{privilegeGain}</p>
                        <p className="text-xs text-blue-600 mt-1">Chief Examiner</p>
                      </div>
                      <div className="rounded-lg bg-blue-500/20 border border-blue-500/40 p-4 text-center">
                        <p className="text-xs text-blue-600 mb-1">Total</p>
                        <p className="text-3xl font-bold text-blue-700">{chiefExaminerPrivileges.totalPrivileges}</p>
                        <p className="text-xs text-blue-600 mt-1">Combined</p>
                      </div>
                    </div>

                    {showPrivilegeGain && (
                      <div className="mt-4 space-y-3">
                        <div className="rounded-lg border border-blue-500/30 bg-slate-50 p-4">
                          <p className="text-xs font-semibold text-blue-700 mb-3">
                            New Privileges ({privilegeGain} additional)
                          </p>
                          <div className="space-y-2 max-h-48 overflow-y-auto">
                            {chiefExaminerPrivileges.privileges
                              .filter(priv => !lecturerPrivileges.privileges.some(lp => lp.id === priv.id || lp.name === priv.name))
                              .map((priv) => (
                                <div key={priv.id} className="flex items-start gap-2 text-xs">
                                  <span className="text-blue-600 mt-0.5">+</span>
                                  <div className="flex-1">
                                    <p className="text-slate-800 font-medium">{priv.name}</p>
                                    <p className="text-slate-500 mt-0.5">{priv.description}</p>
                                  </div>
                                </div>
                              ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!chiefExaminerRoleEnabled || !promotionTarget}
                  className="w-full rounded-xl bg-blue-500/90 px-6 py-3 text-sm font-semibold text-indigo-950 transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-blue-500/30 disabled:text-indigo-900"
                >
                  Promote to Chief Examiner
                </button>
              </form>
            </SectionCard>
          </div>
        )}

        {/* Remove Tab */}
        {activeTab === 'remove' && (
          <SectionCard
            title="Remove Chief Examiner Role"
            kicker="Step 3: Revoke Privileges"
            description="Select a current Chief Examiner to revoke their elevated privileges. They will retain their base Lecturer role."
          >
            {currentChiefExaminers.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
                <p className="text-sm text-slate-600">
                  No Chief Examiners currently assigned
                </p>
              </div>
            ) : (
              <form onSubmit={handleRemoval} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
                    Select Chief Examiner to Remove
                  </label>
                  <select
                    value={removalTarget}
                    onChange={(event) => setRemovalTarget(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/40"
                  >
                    <option value="">Choose a Chief Examiner...</option>
                    {currentChiefExaminers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                  </select>
                </div>

                {removalTarget && (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
                    <p className="text-xs text-rose-300">
                      ⚠️ This will remove Chief Examiner privileges. The user will retain their Lecturer role and all associated privileges.
                    </p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!removalTarget}
                  className="w-full rounded-xl bg-rose-500/90 px-6 py-3 text-sm font-semibold text-rose-950 transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:bg-rose-500/30 disabled:text-rose-900"
                >
                  Remove Chief Examiner Role
                </button>
              </form>
            )}
          </SectionCard>
        )}
      </div>
    </div>
  );
}

interface SuperUserAccountsPanelProps {
  users: User[];
}

function SuperUserAccountsPanel({ users }: SuperUserAccountsPanelProps) {
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showPrivileges, setShowPrivileges] = useState(false);

  const getUserTotalPrivileges = (user: User): number => {
    const uniqueRoles = Array.from(new Set(user.roles));
    const totalPrivileges = uniqueRoles.reduce((total, role) => {
      const rolePriv = rolePrivileges[role];
      return total + (rolePriv ? rolePriv.totalPrivileges : 0);
    }, 0);
    return totalPrivileges;
  };

  return (
    <div className="space-y-4">
    <SectionCard
      title="Registered Accounts Overview"
      kicker="Super User Insights"
      description="Reference all provisioned accounts. Each user signs in separately to perform their responsibilities."
    >
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {users
          .filter((user) => user.baseRole === 'Admin')
            .map((user) => {
              const totalPrivs = getUserTotalPrivileges(user);
              return (
                <button
              key={user.id}
                  type="button"
                  onClick={() => {
                    setSelectedUser(user);
                    setShowPrivileges(true);
                  }}
                  className="rounded-2xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-left text-sm transition hover:border-blue-500/50 hover:bg-blue-500/20"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-emerald-100">{user.name}</span>
                <span className="text-xs uppercase tracking-wide text-blue-800">
                  Base: Admin
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {user.roles.map((role) => (
                  <RoleBadge key={`${user.id}-${role}`} role={role} />
                ))}
              </div>
                  <div className="mt-2 text-xs text-blue-700">
                    {totalPrivs} total privileges
            </div>
                </button>
              );
            })}
      </div>

      <SectionCard
        title="Lecturer Accounts"
        description="All lecturers currently provisioned in the system."
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {users
            .filter((user) => user.baseRole === 'Lecturer')
              .map((user) => {
                const totalPrivs = getUserTotalPrivileges(user);
                return (
                  <button
                key={user.id}
                    type="button"
                    onClick={() => {
                      setSelectedUser(user);
                      setShowPrivileges(true);
                    }}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm transition hover:border-blue-500/40 hover:bg-blue-50"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">{user.name}</span>
                  <span className="text-xs uppercase tracking-wide text-slate-500">
                    Base: Lecturer
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {user.roles.map((role) => (
                    <RoleBadge key={`${user.id}-${role}`} role={role} />
                  ))}
                </div>
                    <div className="mt-2 text-xs text-blue-700">
                      {totalPrivs} total privileges
                    </div>
                  </button>
                );
              })}
          </div>
        </SectionCard>
      </SectionCard>

      {selectedUser && showPrivileges && (
        <SectionCard
          title={`Privileges for ${selectedUser.name}`}
          kicker="Access Rights Breakdown"
          description="Complete privilege breakdown for this user based on assigned roles."
        >
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-500/20 px-4 py-2">
                <p className="text-xs text-slate-600">Total Privileges</p>
                <p className="text-2xl font-bold text-blue-700">{getUserTotalPrivileges(selectedUser)}</p>
              </div>
              <div className="rounded-lg bg-blue-500/20 px-4 py-2">
                <p className="text-xs text-slate-600">Roles</p>
                <p className="text-2xl font-bold text-blue-700">{selectedUser.roles.length}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowPrivileges(false)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
            >
              Close
            </button>
          </div>
          <div className="space-y-3">
            {selectedUser.roles.map((role) => {
              const rolePriv = rolePrivileges[role];
              if (!rolePriv) return null;
              return (
                <div key={role} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-800">{role}</h4>
                    <span className="text-xs text-slate-600">{rolePriv.totalPrivileges} privileges</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {rolePriv.privileges.slice(0, 6).map((priv) => (
                      <div key={priv.id} className="text-xs">
                        <span className="text-blue-600">•</span> {priv.name}
              </div>
            ))}
                    {rolePriv.privileges.length > 6 && (
                      <div className="text-xs text-slate-500">
                        +{rolePriv.privileges.length - 6} more privileges
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      </SectionCard>
      )}
    </div>
  );
}

interface SuperUserSystemStatsPanelProps {
  users: User[];
  workflow: WorkflowState;
}

function SuperUserSystemStatsPanel({ users, workflow }: SuperUserSystemStatsPanelProps) {
  const admins = users.filter(u => u.baseRole === 'Admin').length;
  const lecturers = users.filter(u => u.baseRole === 'Lecturer').length;
  const chiefExaminers = users.filter(u => u.roles.includes('Chief Examiner')).length;
  const teamLeads = users.filter(u => u.roles.includes('Team Lead')).length;
  const vetters = users.filter(u => u.roles.includes('Vetter')).length;
  const setters = users.filter(u => u.roles.includes('Setter')).length;

  const totalPrivileges = Object.values(rolePrivileges).reduce((sum, role) => sum + role.totalPrivileges, 0);
  const activeUsers = users.length;
  const totalRoleAssignments = chiefExaminers + teamLeads + vetters + setters;


  return (
    <SectionCard
      title="System Statistics"
      kicker="Admin Dashboard"
      description="Comprehensive overview of system users, roles, and privileges."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Users Card with Thick Line Graph */}
        <div className="relative rounded-xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-4 shadow-lg overflow-hidden group hover:shadow-xl transition-all duration-300">
          <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-blue-400/20 to-indigo-400/20 rounded-bl-full"></div>
          <p className="text-xs uppercase tracking-wide text-blue-600 font-bold relative z-10">Total Users</p>
          <p className="mt-2 text-3xl font-bold text-blue-700 relative z-10">{activeUsers}</p>
          
          {/* Thin Donut Chart */}
          <div className="mt-4 h-16 relative z-10 flex items-center justify-center">
            <svg width="64" height="64" viewBox="0 0 64 64" className="transform -rotate-90">
              <defs>
                <linearGradient id="usersDonutGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#3b82f6" />
                  <stop offset="100%" stopColor="#6366f1" />
                </linearGradient>
              </defs>
              {/* Background circle */}
              <circle cx="32" cy="32" r="14" fill="none" stroke="#e0e7ff" strokeWidth="3" />
              {/* Active segment - Admins */}
              {activeUsers > 0 && (
                <circle
                  cx="32"
                  cy="32"
                  r="14"
                  fill="none"
                  stroke="url(#usersDonutGradient)"
                  strokeWidth="3"
                  strokeDasharray={`${(admins / activeUsers) * 87.96} 87.96`}
                  strokeLinecap="round"
                />
              )}
              {/* Active segment - Lecturers */}
              {activeUsers > 0 && lecturers > 0 && (
                <circle
                  cx="32"
                  cy="32"
                  r="14"
                  fill="none"
                  stroke="#a78bfa"
                  strokeWidth="3"
                  strokeDasharray={`${(lecturers / activeUsers) * 87.96} 87.96`}
                  strokeDashoffset={`-${(admins / activeUsers) * 87.96}`}
                  strokeLinecap="round"
                />
              )}
            </svg>
          </div>
          
          <div className="mt-3 space-y-1 text-xs text-slate-600 relative z-10">
            <p>Admins: {admins}</p>
            <p>Lecturers: {lecturers}</p>
          </div>
        </div>

        {/* Role Assignments Card with Thick Line Graph */}
        <div className="relative rounded-xl border-2 border-purple-200 bg-gradient-to-br from-purple-50 via-white to-pink-50 p-4 shadow-lg overflow-hidden group hover:shadow-xl transition-all duration-300">
          <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-purple-400/20 to-pink-400/20 rounded-bl-full"></div>
          <p className="text-xs uppercase tracking-wide text-purple-600 font-bold relative z-10">Role Assignments</p>
          <p className="mt-2 text-3xl font-bold text-purple-700 relative z-10">{totalRoleAssignments}</p>
          
          {/* Thin Donut Chart */}
          <div className="mt-4 h-16 relative z-10 flex items-center justify-center">
            <svg width="64" height="64" viewBox="0 0 64 64" className="transform -rotate-90">
              <defs>
                <linearGradient id="rolesDonutGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#a855f7" />
                  <stop offset="100%" stopColor="#ec4899" />
                </linearGradient>
              </defs>
              {/* Background circle */}
              <circle cx="32" cy="32" r="14" fill="none" stroke="#f3e8ff" strokeWidth="3" />
              {/* Active segments */}
              {totalRoleAssignments > 0 && (
                <>
                  <circle
                    cx="32"
                    cy="32"
                    r="14"
                    fill="none"
                    stroke="url(#rolesDonutGradient)"
                    strokeWidth="3"
                    strokeDasharray={`${(chiefExaminers / Math.max(totalRoleAssignments, 1)) * 87.96} 87.96`}
                    strokeLinecap="round"
                  />
                  {teamLeads > 0 && (
                    <circle
                      cx="32"
                      cy="32"
                      r="14"
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth="3"
                      strokeDasharray={`${(teamLeads / Math.max(totalRoleAssignments, 1)) * 87.96} 87.96`}
                      strokeDashoffset={`-${(chiefExaminers / Math.max(totalRoleAssignments, 1)) * 87.96}`}
                      strokeLinecap="round"
                    />
                  )}
                  {vetters > 0 && (
                    <circle
                      cx="32"
                      cy="32"
                      r="14"
                      fill="none"
                      stroke="#ec4899"
                      strokeWidth="3"
                      strokeDasharray={`${(vetters / Math.max(totalRoleAssignments, 1)) * 87.96} 87.96`}
                      strokeDashoffset={`-${((chiefExaminers + teamLeads) / Math.max(totalRoleAssignments, 1)) * 87.96}`}
                      strokeLinecap="round"
                    />
                  )}
                  {setters > 0 && (
                    <circle
                      cx="32"
                      cy="32"
                      r="14"
                      fill="none"
                      stroke="#06b6d4"
                      strokeWidth="3"
                      strokeDasharray={`${(setters / Math.max(totalRoleAssignments, 1)) * 87.96} 87.96`}
                      strokeDashoffset={`-${((chiefExaminers + teamLeads + vetters) / Math.max(totalRoleAssignments, 1)) * 87.96}`}
                      strokeLinecap="round"
                    />
                  )}
                </>
              )}
            </svg>
          </div>
          
          <div className="mt-3 space-y-1 text-xs text-slate-600 relative z-10">
            <p>Chief Examiners: {chiefExaminers}</p>
            <p>Team Leads: {teamLeads}</p>
            <p>Vetters: {vetters}</p>
            <p>Setters: {setters}</p>
          </div>
        </div>

        {/* System Privileges Card with Thick Line Graph */}
        <div className="relative rounded-xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-4 shadow-lg overflow-hidden group hover:shadow-xl transition-all duration-300">
          <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-emerald-400/20 to-teal-400/20 rounded-bl-full"></div>
          <p className="text-xs uppercase tracking-wide text-emerald-600 font-bold relative z-10">System Privileges</p>
          <p className="mt-2 text-3xl font-bold text-emerald-700 relative z-10">{totalPrivileges}</p>
          
          {/* Thin Donut Chart */}
          <div className="mt-4 h-16 relative z-10 flex items-center justify-center">
            <svg width="64" height="64" viewBox="0 0 64 64" className="transform -rotate-90">
              <defs>
                <linearGradient id="privilegesDonutGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="100%" stopColor="#14b8a6" />
                </linearGradient>
              </defs>
              {/* Background circle */}
              <circle cx="32" cy="32" r="14" fill="none" stroke="#d1fae5" strokeWidth="3" />
              {/* Active segment - showing distribution across roles */}
              <circle
                cx="32"
                cy="32"
                r="14"
                fill="none"
                stroke="url(#privilegesDonutGradient)"
                strokeWidth="3"
                strokeDasharray="87.96 87.96"
                strokeDashoffset={`${(1 - Object.keys(rolePrivileges).length / 10) * 87.96}`}
                strokeLinecap="round"
              />
            </svg>
          </div>
          
          <p className="mt-3 text-xs text-slate-600 relative z-10">
            Across {Object.keys(rolePrivileges).length} roles
          </p>
        </div>

        {/* Workflow Stage Card with Thick Line Graph */}
        <div className="relative rounded-xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-4 shadow-lg overflow-hidden group hover:shadow-xl transition-all duration-300">
          <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-amber-400/20 to-orange-400/20 rounded-bl-full"></div>
          <p className="text-xs uppercase tracking-wide text-amber-600 font-bold relative z-10">Workflow Stage</p>
          <p className="mt-2 text-lg font-bold text-amber-700 relative z-10">{workflow.stage.replace(/-/g, ' ')}</p>
          
          {/* Thin Donut Chart */}
          <div className="mt-4 h-16 relative z-10 flex items-center justify-center">
            <svg width="64" height="64" viewBox="0 0 64 64" className="transform -rotate-90">
              <defs>
                <linearGradient id="workflowDonutGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#f59e0b" />
                  <stop offset="100%" stopColor="#f97316" />
                </linearGradient>
              </defs>
              {/* Background circle */}
              <circle cx="32" cy="32" r="14" fill="none" stroke="#fed7aa" strokeWidth="3" />
              {/* Active segment - based on timeline entries */}
              <circle
                cx="32"
                cy="32"
                r="14"
                fill="none"
                stroke="url(#workflowDonutGradient)"
                strokeWidth="3"
                strokeDasharray={`${Math.min((workflow.timeline.length / 10) * 87.96, 87.96)} 87.96`}
                strokeLinecap="round"
              />
            </svg>
          </div>
          
          <p className="mt-3 text-xs text-slate-600 relative z-10">
            Timeline: {workflow.timeline.length} entries
          </p>
        </div>
      </div>

      {/* Privilege Distribution with Single Bar Graph */}
      <div className="mt-6 rounded-xl border-2 border-slate-300 bg-gradient-to-br from-slate-50 via-white to-blue-50 p-5 shadow-lg">
        <div className="flex items-center gap-2 mb-6">
          <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <h3 className="text-sm font-bold text-slate-800">Privilege Distribution by Role</h3>
        </div>
        
        {/* Single Bar Graph Container */}
        <div className="bg-white rounded-lg p-6 border border-slate-200 shadow-sm">
          <div className="flex items-end gap-4 h-64 relative">
            {Object.values(rolePrivileges).map((rolePriv, index) => {
              const roleCount = users.filter(u => u.roles.includes(rolePriv.role)).length;
              const percentage = (rolePriv.totalPrivileges / totalPrivileges) * 100;
              const maxBarHeight = 220; // Maximum height in pixels
              const barHeight = Math.max(30, (percentage / 100) * maxBarHeight);
              
              const colors = [
                { from: '#3b82f6', to: '#2563eb' }, // Blue
                { from: '#8b5cf6', to: '#7c3aed' }, // Purple
                { from: '#10b981', to: '#059669' }, // Emerald
                { from: '#f59e0b', to: '#d97706' }, // Amber
                { from: '#ec4899', to: '#db2777' }, // Pink
                { from: '#06b6d4', to: '#0891b2' }, // Cyan
              ];
              const color = colors[index % colors.length];

              return (
                <div key={rolePriv.role} className="flex-1 flex flex-col items-center group">
                  {/* Value label above bar */}
                  <div className="mb-2 text-xs font-bold text-slate-700 text-center">
                    {rolePriv.totalPrivileges}
                  </div>
                  
                  {/* Bar */}
                  <div className="w-full flex flex-col items-center relative">
                    <div
                      className="w-full rounded-t-lg shadow-md group-hover:shadow-xl transition-all duration-300 relative overflow-hidden group-hover:scale-105"
                      style={{
                        height: `${barHeight}px`,
                        minHeight: '30px',
                        background: `linear-gradient(180deg, ${color.from} 0%, ${color.to} 100%)`,
                      }}
                    >
                      {/* Shine overlay */}
                      <div className="absolute inset-0 bg-gradient-to-t from-transparent via-white/20 to-white/40 rounded-t-lg"></div>
                    </div>
                  </div>
                  
                  {/* Role label below bar */}
                  <div className="mt-3 text-center">
                    <p className="text-xs font-bold text-slate-800 mb-1">{rolePriv.role}</p>
                    <p className="text-xs text-slate-500">{roleCount} users</p>
                    <p className="text-xs text-slate-500">{percentage.toFixed(1)}%</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

interface SuperUserManageUsersPanelProps {
  users: User[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
}

function SuperUserManageUsersPanel({ users, setUsers }: SuperUserManageUsersPanelProps) {
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [action, setAction] = useState<'view' | 'edit' | 'delete'>('view');

  const selectedUser = users.find(u => u.id === selectedUserId);

  const handleDeleteUser = () => {
    if (selectedUserId && window.confirm(`Are you sure you want to delete ${selectedUser?.name}? This action cannot be undone.`)) {
      setUsers(prev => {
        const updated = prev.filter(u => u.id !== selectedUserId);
        // Persist immediately
        try {
          localStorage.setItem('ucu-moderation-users', JSON.stringify(updated));
        } catch (error) {
          console.error('Error saving users to localStorage:', error);
        }
        return updated;
      });
      setSelectedUserId('');
      alert('User deleted successfully');
    }
  };

  const getUserTotalPrivileges = (user: User): number => {
    const uniqueRoles = Array.from(new Set(user.roles));
    return uniqueRoles.reduce((total, role) => {
      const rolePriv = rolePrivileges[role];
      return total + (rolePriv ? rolePriv.totalPrivileges : 0);
    }, 0);
  };

  return (
    <SectionCard
      title="User Management"
      kicker="Admin Control"
      description="View, edit, and manage user accounts in the system."
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
            Select User
          </label>
          <select
            value={selectedUserId}
            onChange={(e) => {
              setSelectedUserId(e.target.value);
              setAction('view');
            }}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
          >
            <option value="">Choose a user...</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} ({user.baseRole})
              </option>
            ))}
          </select>
        </div>

        {selectedUser && (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">{selectedUser.name}</h3>
                  <p className="mt-1 text-sm text-slate-600">ID: {selectedUser.id}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">Base Role</p>
                  <p className="text-sm font-semibold text-blue-700">{selectedUser.baseRole}</p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3 mb-4">
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-xs text-slate-600">Total Privileges</p>
                  <p className="mt-1 text-2xl font-bold text-blue-700">{getUserTotalPrivileges(selectedUser)}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-xs text-slate-600">Assigned Roles</p>
                  <p className="mt-1 text-2xl font-bold text-blue-700">{selectedUser.roles.length}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-xs text-slate-600">Account Status</p>
                  <p className="mt-1 text-sm font-semibold text-blue-700">Active</p>
                </div>
              </div>

              <div className="mb-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Roles</p>
                <div className="flex flex-wrap gap-2">
                  {selectedUser.roles.map((role) => (
                    <RoleBadge key={role} role={role} />
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setAction('view')}
                  className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                    action === 'view'
                      ? 'bg-blue-500/20 text-blue-700 border border-blue-500/40'
                      : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  View Details
                </button>
                <button
                  type="button"
                  onClick={() => setAction('edit')}
                  className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                    action === 'edit'
                      ? 'bg-blue-500/20 text-blue-700 border border-blue-500/40'
                      : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  Edit User
                </button>
                <button
                  type="button"
                  onClick={handleDeleteUser}
                  className="flex-1 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 px-4 py-2 text-sm font-semibold transition hover:bg-rose-500/30"
                >
                  Delete User
                </button>
              </div>

              {action === 'view' && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
                  <p className="text-xs font-semibold text-slate-700 mb-2">Privilege Summary</p>
                  <div className="space-y-2">
                    {selectedUser.roles.map((role) => {
                      const rolePriv = rolePrivileges[role];
                      if (!rolePriv) return null;
                      return (
                        <div key={role} className="text-xs">
                          <span className="font-semibold text-blue-600">{role}:</span>{' '}
                          <span className="text-slate-600">{rolePriv.totalPrivileges} privileges</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

interface AdminSystemSettingsPanelProps {}

function AdminSystemSettingsPanel({}: AdminSystemSettingsPanelProps) {
  const [settings, setSettings] = useState({
    systemName: 'UCU Digital Paper Moderation System',
    sessionTimeout: 30,
    passwordPolicy: 'medium',
    emailNotifications: true,
    smsNotifications: false,
    maintenanceMode: false,
  });

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    alert('System settings saved successfully!');
  };

  return (
    <SectionCard
      title="System Settings"
      kicker="Configuration"
      description="Configure system-wide settings and preferences."
    >
      <form onSubmit={handleSave} className="space-y-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="text-sm font-semibold text-slate-800 mb-4">General Settings</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
                System Name
              </label>
              <input
                type="text"
                value={settings.systemName}
                onChange={(e) => setSettings({ ...settings, systemName: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
                Session Timeout (minutes)
              </label>
              <input
                type="number"
                min="5"
                max="120"
                value={settings.sessionTimeout}
                onChange={(e) => setSettings({ ...settings, sessionTimeout: parseInt(e.target.value) || 30 })}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
                Password Policy
              </label>
              <select
                value={settings.passwordPolicy}
                onChange={(e) => setSettings({ ...settings, passwordPolicy: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
              >
                <option value="low">Low (6+ characters)</option>
                <option value="medium">Medium (8+ characters, mixed case)</option>
                <option value="high">High (10+ characters, mixed case, numbers, symbols)</option>
              </select>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="text-sm font-semibold text-slate-800 mb-4">Notification Settings</h3>
          <div className="space-y-3">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm text-slate-700">Email Notifications</span>
              <input
                type="checkbox"
                checked={settings.emailNotifications}
                onChange={(e) => setSettings({ ...settings, emailNotifications: e.target.checked })}
                className="h-5 w-5 rounded border-slate-200 bg-slate-100 text-purple-600 focus:ring-purple-500"
              />
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm text-slate-700">SMS Notifications</span>
              <input
                type="checkbox"
                checked={settings.smsNotifications}
                onChange={(e) => setSettings({ ...settings, smsNotifications: e.target.checked })}
                className="h-5 w-5 rounded border-slate-200 bg-slate-100 text-purple-600 focus:ring-purple-500"
              />
            </label>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="text-sm font-semibold text-slate-800 mb-4">System Status</h3>
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm text-slate-700">Maintenance Mode</span>
            <input
              type="checkbox"
              checked={settings.maintenanceMode}
              onChange={(e) => setSettings({ ...settings, maintenanceMode: e.target.checked })}
              className="h-5 w-5 rounded border-slate-200 bg-slate-100 text-amber-600 focus:ring-amber-500"
            />
          </label>
          {settings.maintenanceMode && (
            <p className="mt-2 text-xs text-amber-400">System will be unavailable to non-admin users.</p>
          )}
        </div>

        <button
          type="submit"
          className="w-full rounded-xl bg-blue-500/90 px-6 py-3 text-sm font-semibold text-purple-950 transition hover:bg-purple-400"
        >
          Save Settings
        </button>
      </form>
    </SectionCard>
  );
}

interface AdminAuditLogPanelProps {
  workflow: WorkflowState;
}

function AdminAuditLogPanel({ workflow }: AdminAuditLogPanelProps) {
  return (
    <SectionCard
      title="Audit Log"
      kicker="System Activity"
      description="Complete audit trail of all system activities and user actions."
    >
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">Activity Timeline</h3>
          <button
            type="button"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            Export Log
          </button>
        </div>
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {workflow.timeline.map((event) => (
            <div
              key={event.id}
              className="rounded-lg border border-slate-200 bg-white p-3 text-sm"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="font-semibold text-blue-700">{event.actor}</p>
                  <p className="text-slate-700 mt-1">{event.message}</p>
                  <p className="text-xs text-slate-500 mt-1">{event.stage}</p>
                </div>
                <span className="text-xs text-slate-500 whitespace-nowrap ml-4">
                  {formatTimestamp(event.timestamp)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}

interface AdminStaffManagementPanelProps {
  users: User[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
}

function AdminStaffManagementPanel({ users, setUsers }: AdminStaffManagementPanelProps) {
  const [selectedUser, setSelectedUser] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');

  const filteredUsers = users.filter(user =>
    user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.baseRole.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedUserData = users.find(u => u.id === selectedUser);

  const handleDeleteUser = (userId: string) => {
    if (confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
      setUsers(prev => {
        const updated = prev.filter(u => u.id !== userId);
        // Persist immediately
        try {
          localStorage.setItem('ucu-moderation-users', JSON.stringify(updated));
        } catch (error) {
          console.error('Error saving users to localStorage:', error);
        }
        return updated;
      });
      setSelectedUser('');
      alert('User deleted successfully');
    }
  };

  return (
    <SectionCard
      title="Staff Management"
      kicker="Account Administration"
      description="Comprehensive staff account management with search, view, and edit capabilities."
    >
      <div className="space-y-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="mb-4">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
              Search Staff
            </label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by name or role..."
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 max-h-96 overflow-y-auto">
            {filteredUsers.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => setSelectedUser(user.id)}
                className={`rounded-xl border p-4 text-left transition ${
                  selectedUser === user.id
                    ? 'border-blue-500/50 bg-blue-500/10'
                    : 'border-slate-200 bg-white hover:border-blue-500/40'
                }`}
              >
                <p className="text-sm font-semibold text-slate-800">{user.name}</p>
                <p className="text-xs text-slate-600 mt-1">{user.baseRole}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {user.roles.map((role) => (
                    <RoleBadge key={role} role={role} />
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>

        {selectedUserData && (
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-slate-800">User Details</h3>
              <button
                type="button"
                onClick={() => setSelectedUser('')}
                className="text-xs text-slate-600 hover:text-slate-700"
              >
                Close
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-xs text-slate-600">Full Name</p>
                <p className="text-sm font-semibold text-slate-800">{selectedUserData.name}</p>
              </div>
              <div>
                <p className="text-xs text-slate-600">Base Role</p>
                <p className="text-sm font-semibold text-slate-800">{selectedUserData.baseRole}</p>
              </div>
              <div>
                <p className="text-xs text-slate-600">Assigned Roles</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedUserData.roles.map((role) => (
                    <RoleBadge key={role} role={role} />
                  ))}
                </div>
              </div>
              <div className="pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => handleDeleteUser(selectedUserData.id)}
                  className="w-full rounded-xl bg-rose-500/90 px-4 py-2 text-sm font-semibold text-rose-950 transition hover:bg-rose-400"
                >
                  Delete User Account
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

interface AddPaperToRepositoryFormProps {
  onAddPaper: (file: File, courseUnit: string, courseCode: string, semester: string, year: string) => void;
}

function AddPaperToRepositoryForm({ onAddPaper }: AddPaperToRepositoryFormProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [courseUnit, setCourseUnit] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [semester, setSemester] = useState('');
  const [year, setYear] = useState('');

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        setSelectedFile(file);
      } else {
        alert('Please select a PDF file only.');
        e.target.value = '';
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      alert('Please select a PDF file.');
      return;
    }
    if (!courseUnit || !courseCode || !semester || !year) {
      alert('Please fill in all fields.');
      return;
    }

    onAddPaper(selectedFile, courseUnit, courseCode, semester, year);
    
    // Reset form
    setSelectedFile(null);
    setCourseUnit('');
    setCourseCode('');
    setSemester('');
    setYear('');
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
    
    alert('Paper added to repository successfully!');
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
          Select PDF File
        </label>
        <input
          type="file"
          accept=".pdf"
          onChange={handleFileSelect}
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 file:mr-4 file:rounded-lg file:border-0 file:bg-blue-500/90 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-indigo-950 file:cursor-pointer hover:file:bg-indigo-400"
        />
        {selectedFile && (
          <p className="mt-2 text-xs text-blue-700">
            Selected: {selectedFile.name}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
            Course Code
          </label>
          <input
            type="text"
            value={courseCode}
            onChange={(e) => setCourseCode(e.target.value)}
            placeholder="e.g., CSC 302"
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
            Course Unit
          </label>
          <input
            type="text"
            value={courseUnit}
            onChange={(e) => setCourseUnit(e.target.value)}
            placeholder="e.g., Advanced Algorithms"
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
            Semester
          </label>
          <select
            value={semester}
            onChange={(e) => setSemester(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          >
            <option value="">Select semester...</option>
            <option value="Advent">Advent</option>
            <option value="Easter">Easter</option>
            <option value="Trinity">Trinity</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
            Year
          </label>
          <input
            type="text"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            placeholder="e.g., 2024"
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={!selectedFile || !courseUnit || !courseCode || !semester || !year}
        className="w-full rounded-xl bg-blue-500/90 px-6 py-3 text-sm font-semibold text-indigo-950 transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-blue-500/40 disabled:text-indigo-900"
      >
        Add Paper to Repository
      </button>
    </form>
  );
}

interface ChiefExaminerConsoleProps {
  users: User[];
  currentUser: User | null;
  onAssignRole: (userId: string, role: Role) => void;
  onUnassignRole: (userId: string, role: Role) => void;
  deadlinesActive: boolean;
  deadlineDuration: { days: number; hours: number; minutes: number };
  repositoriesActive: boolean;
  onToggleDeadlines: (nextValue: boolean) => void;
  onSetDeadlineDuration: (duration: { days: number; hours: number; minutes: number }) => void;
  onToggleRepositories: (nextValue: boolean) => void;
  lastModerationDownload: string | null;
  onDownloadModeration: () => void;
  setterDeadlineActive: boolean;
  setterDeadlineDuration: { days: number; hours: number; minutes: number };
  setterDeadlineStartTime: number | null;
  teamLeadDeadlineActive: boolean;
  teamLeadDeadlineDuration: { days: number; hours: number; minutes: number };
  teamLeadDeadlineStartTime: number | null;
  onSetSetterDeadline: (active: boolean, duration: { days: number; hours: number; minutes: number }) => void;
  onSetTeamLeadDeadline: (active: boolean, duration: { days: number; hours: number; minutes: number }) => void;
  onAddPaperToRepository: (file: File, courseUnit: string, courseCode: string, semester: string, year: string) => void;
  repositoryPapers: Array<{
    id: string;
    courseUnit: string;
    courseCode: string;
    semester: string;
    year: string;
    submittedBy: string;
    submittedAt: string;
    fileName: string;
    content: string;
    fileSize?: number;
  }>;
  sectionId?: string;
}

interface CountdownPillProps {
  startTime: number;
  duration: { days: number; hours: number; minutes: number };
}

function CountdownPill({ startTime, duration }: CountdownPillProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  const totalMs =
    duration.days * 24 * 60 * 60 * 1000 +
    duration.hours * 60 * 60 * 1000 +
    duration.minutes * 60 * 1000;
  const remaining = Math.max(totalMs - (now - startTime), 0);

  const hours = Math.floor(remaining / (60 * 60 * 1000));
  const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
  const seconds = Math.floor((remaining % (60 * 1000)) / 1000);

  const expired = remaining <= 0;

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full px-3 py-1 text-xs font-semibold ${
        expired
          ? 'bg-rose-100 text-rose-700'
          : 'bg-emerald-100 text-emerald-700'
      }`}
    >
      {expired ? 'Deadline expired' : `${hours.toString().padStart(2, '0')}:${minutes
        .toString()
        .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`}
    </span>
  );
}

function ChiefExaminerConsole({
  users,
  currentUser,
  onAssignRole,
  onUnassignRole,
  deadlinesActive,
  deadlineDuration,
  repositoriesActive,
  onToggleDeadlines,
  onSetDeadlineDuration,
  onToggleRepositories,
  lastModerationDownload,
  onDownloadModeration,
  setterDeadlineActive,
  setterDeadlineDuration,
  setterDeadlineStartTime,
  teamLeadDeadlineActive,
  teamLeadDeadlineDuration,
  teamLeadDeadlineStartTime,
  onSetSetterDeadline,
  onSetTeamLeadDeadline,
  onAddPaperToRepository,
  repositoryPapers,
  sectionId,
}: ChiefExaminerConsoleProps) {
  const [awardUserId, setAwardUserId] = useState('');
  const [selectedCourseUnit, setSelectedCourseUnit] = useState('');
  const [awardRole, setAwardRole] = useState<Role>('Team Lead');
  const [showDurationSettings, setShowDurationSettings] = useState(false);
  const [durationForm, setDurationForm] = useState(deadlineDuration);
  const [showSetterDurationSettings, setShowSetterDurationSettings] = useState(false);
  const [setterDurationForm, setSetterDurationForm] = useState(setterDeadlineDuration);
  const [showTeamLeadDurationSettings, setShowTeamLeadDurationSettings] = useState(false);
  const [teamLeadDurationForm, setTeamLeadDurationForm] = useState(teamLeadDeadlineDuration);

  const awardableRoles: Role[] = ['Team Lead', 'Vetter', 'Setter', 'Lecturer'];

  // Helper to decorate lecturer options with campus icons when needed
  const getCampusBadgeForLecturer = (campus?: string) => {
    if (!campus) return '';
    const lowered = campus.toLowerCase();
    if (lowered.includes('main')) {
      return '🏛 Main campus';
    }
    return `📍 ${campus}`;
  };

  // Available course units from user profiles (non-empty, unique)
  const courseUnits = useMemo(() => {
    const units = users
      .map((u) => u.courseUnit)
      .filter((u): u is string => !!u && u.trim().length > 0);
    return Array.from(new Set(units));
  }, [users]);

  // Only show lecturers in the same category (Undergraduate/Postgraduate) as the Chief Examiner.
  // Also filter by selected course unit (if chosen).
  // If the Chief's category is not set, fall back to showing all lecturers for that course unit.
  const eligibleUsers = useMemo(() => {
    const chiefCategory = currentUser?.lecturerCategory;

    return users.filter((user) => {
      const isLecturer =
        user.baseRole === 'Lecturer' || user.roles.includes('Lecturer');

      if (!isLecturer) return false;

       // If a course unit is chosen, user must belong to that course
       if (selectedCourseUnit && user.courseUnit !== selectedCourseUnit) {
         return false;
       }

      if (!chiefCategory) return true;

      return user.lecturerCategory === chiefCategory;
    });
  }, [users, currentUser, selectedCourseUnit]);

  const handleAward = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (awardUserId && awardRole) {
      onAssignRole(awardUserId, awardRole);
      setAwardUserId('');
      setAwardRole('Team Lead');
    }
  };

  const handleDurationSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSetDeadlineDuration(durationForm);
    setShowDurationSettings(false);
    alert(`Deadline duration set to ${durationForm.days} days, ${durationForm.hours} hours, ${durationForm.minutes} minutes`);
  };

  const formatDuration = () => {
    const parts = [];
    if (deadlineDuration.days > 0) parts.push(`${deadlineDuration.days} day${deadlineDuration.days !== 1 ? 's' : ''}`);
    if (deadlineDuration.hours > 0) parts.push(`${deadlineDuration.hours} hour${deadlineDuration.hours !== 1 ? 's' : ''}`);
    if (deadlineDuration.minutes > 0) parts.push(`${deadlineDuration.minutes} minute${deadlineDuration.minutes !== 1 ? 's' : ''}`);
    return parts.length > 0 ? parts.join(', ') : 'Not set';
  };

  return (
    <div className="space-y-6">
      {/* Role Management Section */}
      <SectionCard
        id={sectionId}
        title="Role Management"
        kicker="Operational Roles"
        description="Assign operational roles to lecturers to activate the moderation workflow pipeline."
      >
        <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-indigo-50 via-white to-sky-50 p-6 transition-colors transition-shadow duration-200 hover:border-indigo-200 hover:from-white hover:via-sky-50 hover:to-indigo-50 hover:shadow-lg">
          <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-indigo-200/40 blur-3xl" />
          <div className="pointer-events-none absolute -left-10 bottom-0 h-24 w-24 rounded-full bg-sky-200/40 blur-3xl" />

          <div className="relative z-10 mb-4 flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-sky-500 to-cyan-400 text-white shadow-md">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m-9 8h10a2 2 0 002-2V7a2 2 0 00-2-2h-3.172a2 2 0 01-1.414-.586L9.586 3.586A2 2 0 008.172 3H6a2 2 0 00-2 2v13a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Award Operational Roles
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Elevate lecturers into Team Leads, Vetters, or Setters to activate the moderation pipeline.
                </p>
              </div>
            </div>
          </div>
          <form onSubmit={handleAward} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-700 mb-2">
                  Select Course Unit
                </label>
                <select
                  value={selectedCourseUnit}
                  onChange={(event) => {
                    setSelectedCourseUnit(event.target.value);
                    // Reset lecturer selection when course changes
                    setAwardUserId('');
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 hover:border-indigo-400"
                >
                  <option value="">Choose a course unit...</option>
                  {courseUnits.length === 0 && (
                    <option value="" disabled>
                      No course units found
                    </option>
                  )}
                  {courseUnits.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-700 mb-2">
                  Select Lecturer
                </label>
                <select
                  value={awardUserId}
                  onChange={(event) => setAwardUserId(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 hover:border-indigo-400"
                  disabled={!selectedCourseUnit}
                >
                  <option value="">
                    {selectedCourseUnit ? 'Choose a lecturer...' : 'Select a course unit first'}
                  </option>
                  {eligibleUsers.map((user) => {
                    const isNetworkingCourse =
                      typeof selectedCourseUnit === 'string' &&
                      selectedCourseUnit.toLowerCase().includes('network');
                    const label =
                      isNetworkingCourse && user.campus
                        ? `${user.name} • ${getCampusBadgeForLecturer(user.campus)}`
                        : user.name;
                    return (
                      <option key={user.id} value={user.id}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-700 mb-2">
                  Select Role
                </label>
                <select
                  value={awardRole}
                  onChange={(event) => setAwardRole(event.target.value as Role)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 hover:border-indigo-400"
                >
                  {awardableRoles.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="submit"
              disabled={!selectedCourseUnit || !awardUserId}
              className="w-full rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300 disabled:text-slate-200"
            >
              Assign Role
            </button>
          </form>
        </div>

        {/* Assigned Roles Display */}
        <div className="mt-6 relative overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-indigo-50 p-6 transition-colors transition-shadow duration-200 hover:border-indigo-200 hover:from-white hover:via-indigo-50 hover:to-slate-50 hover:shadow-lg">
          <div className="pointer-events-none absolute -left-12 -top-8 h-28 w-28 rounded-full bg-emerald-200/40 blur-3xl" />
          <div className="pointer-events-none absolute right-0 bottom-0 h-24 w-24 rounded-full bg-violet-200/40 blur-3xl" />

          <div className="relative z-10 mb-4 flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500 text-white shadow-md">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 20h5V4H2v16h5m10 0v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5m10 0H7"
                  />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Currently Assigned Roles
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  View all lecturers who have been assigned operational roles in the moderation workflow.
                </p>
              </div>
            </div>
            <span className="rounded-full bg-emerald-600/10 px-3 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
              Live overview
            </span>
          </div>
          
          {(() => {
            const operationalRoles: Role[] = ['Team Lead', 'Vetter', 'Setter'];
            const assignedUsers = users.filter(user => 
              user.baseRole === 'Lecturer' && 
              user.roles.some(role => operationalRoles.includes(role))
            );

            if (assignedUsers.length === 0) {
              return (
                <div className="text-center py-8">
                  <p className="text-sm text-slate-600">No operational roles assigned yet.</p>
                  <p className="text-xs text-slate-500 mt-2">Assign roles using the form above.</p>
                </div>
              );
            }

            // Group users by role
            const roleGroups: Record<Role, User[]> = {
              'Team Lead': [],
              'Vetter': [],
              'Setter': [],
              'Lecturer': [],
              'Chief Examiner': [],
              'Admin': [],
            };

            assignedUsers.forEach(user => {
              user.roles.forEach(role => {
                if (operationalRoles.includes(role) && roleGroups[role]) {
                  roleGroups[role].push(user);
                }
              });
            });

            return (
              <div className="space-y-4">
                {operationalRoles.map(role => {
                  const usersWithRole = roleGroups[role];
                  if (usersWithRole.length === 0) return null;

                  const getRoleStyles = (r: Role) => {
                    switch (r) {
                      case 'Team Lead':
                        return {
                          title: 'text-indigo-800',
                          badge: 'bg-indigo-50 text-indigo-700 border-indigo-200',
                          active: 'bg-indigo-600 text-white border-indigo-600',
                        };
                      case 'Vetter':
                        return {
                          title: 'text-emerald-800',
                          badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                          active: 'bg-emerald-600 text-white border-emerald-600',
                        };
                      case 'Setter':
                        return {
                          title: 'text-amber-800',
                          badge: 'bg-amber-50 text-amber-700 border-amber-200',
                          active: 'bg-amber-500 text-white border-amber-500',
                        };
                      default:
                        return {
                          title: 'text-slate-800',
                          badge: 'bg-slate-50 text-slate-700 border-slate-200',
                          active: 'bg-slate-700 text-white border-slate-700',
                        };
                    }
                  };

                  const roleStyles = getRoleStyles(role);

                  return (
                    <div key={role} className="rounded-lg border border-slate-200 bg-white/80 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className={`text-sm font-semibold ${roleStyles.title}`}>
                          {role}
                        </h4>
                        <span className={`px-2 py-0.5 rounded-lg text-xs font-medium border ${roleStyles.badge}`}>
                          {usersWithRole.length} {usersWithRole.length === 1 ? 'person' : 'people'}
                        </span>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {usersWithRole.map((user) => (
                          <div
                            key={user.id}
                            className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-sky-50 p-3 shadow-sm"
                          >
                            <div className="pointer-events-none absolute -right-6 -top-6 h-16 w-16 rounded-full bg-sky-200/60 blur-2xl" />
                            <div className="pointer-events-none absolute -left-10 -bottom-8 h-20 w-20 rounded-full bg-emerald-200/40 blur-2xl" />

                            <div className="relative flex items-start justify-between gap-3 mb-2">
                              <div>
                                <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-slate-500">
                                  {role} assigned
                                </p>
                                <p className="mt-0.5 text-sm font-semibold text-slate-900">
                                  {user.name}
                                </p>
                                {user.email && (
                                  <p className="text-[0.7rem] text-slate-500 truncate">
                                    {user.email}
                                  </p>
                                )}
                              </div>
                              <div className="flex flex-col items-end gap-1">
                                <span
                                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.7rem] font-semibold border ${roleStyles.active}`}
                                >
                                  {role}
                                </span>
                                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/80 shadow-sm text-indigo-600">
                                  <svg
                                    className="h-4 w-4"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M12 11c1.657 0 3-1.343 3-3S13.657 5 12 5 9 6.343 9 8s1.343 3 3 3z"
                                    />
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M4 21v-1a7 7 0 0114 0v1"
                                    />
                                  </svg>
                                </span>
                              </div>
                            </div>

                            <div className="relative mt-1 rounded-xl bg-white/90 border border-slate-100 px-3 py-2">
                              <p className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wide text-slate-500">
                                Assignment details
                              </p>
                              <div className="space-y-1.5 text-[0.75rem]">
                                {user.lecturerCategory && (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-emerald-500 text-base leading-none">🎓</span>
                                    <span className="font-semibold text-slate-600">
                                      Category:
                                    </span>
                                    <span className="truncate text-slate-800">
                                      {user.lecturerCategory}
                                    </span>
                                  </div>
                                )}
                                {user.department && (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-blue-500 text-base leading-none">🏫</span>
                                    <span className="font-semibold text-slate-600">
                                      Dept:
                                    </span>
                                    <span className="truncate text-slate-800">
                                      {user.department}
                                    </span>
                                  </div>
                                )}
                                {user.courseUnit && (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-indigo-500 text-base leading-none">
                                      📘
                                    </span>
                                    <span className="font-semibold text-slate-600">
                                      Course:
                                    </span>
                                    <span className="truncate text-slate-800">
                                      {user.courseUnit}
                                    </span>
                                  </div>
                                )}
                                {user.campus && (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-pink-500 text-base leading-none">
                                      📍
                                    </span>
                                    <span className="font-semibold text-slate-600">
                                      Campus:
                                    </span>
                                    <span className="truncate text-slate-800">
                                      {user.campus}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => onUnassignRole(user.id, role)}
                              className="relative mt-3 w-full overflow-hidden rounded-xl bg-gradient-to-r from-rose-500 to-rose-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:from-rose-600 hover:to-red-500"
                              title={`Remove ${role} role from ${user.name}`}
                            >
                              <span className="absolute inset-0 bg-white/10 opacity-0 blur-3xl transition-opacity duration-200 hover:opacity-40" />
                              <span className="relative flex items-center justify-center gap-1">
                                <svg
                                  className="h-3 w-3"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M6 18L18 6M6 6l12 12"
                                  />
                                </svg>
                                <span>Revoke</span>
                              </span>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      </SectionCard>

      {/* Deadline & Repository Management */}
      <SectionCard
        title="Deadline & Repository Management"
        kicker="Semester Controls"
        description="Configure submission deadlines for Setters and Team Leads. Setter deadline starts first, then Team Lead deadline starts automatically when Setter deadline expires."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Setter Deadline Configuration */}
          <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-rose-50 via-white to-pink-50 p-6">
            <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-pink-200/40 blur-3xl" />
            <div className="pointer-events-none absolute -left-10 bottom-0 h-24 w-24 rounded-full bg-rose-200/40 blur-3xl" />
            <div className="relative flex items-center justify-between mb-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500 via-rose-500 to-amber-400 text-white shadow-md">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4l2 2m6-2a8 8 0 11-16 0 8 8 0 0116 0z"
                    />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-semibold text-pink-700">
                    Setter Submission Deadline
                  </h3>
                  <p className="text-sm text-slate-700 mt-1">
                    Set duration for Setter paper submissions
                  </p>
                </div>
              </div>
              <StatusPill
                label={setterDeadlineActive ? 'Active' : 'Inactive'}
                active={setterDeadlineActive}
                tone={setterDeadlineActive ? 'blue' : 'amber'}
              />
            </div>

            {setterDeadlineActive && setterDeadlineStartTime && (
              <div className="mb-4 rounded-lg border border-pink-200 bg-pink-50 p-4 flex flex-col gap-1">
                <p className="text-xs font-semibold text-pink-700">Current Deadline Duration</p>
                <p className="text-sm text-pink-800 font-medium">
                  {setterDeadlineDuration.days} day{setterDeadlineDuration.days !== 1 ? 's' : ''}, {setterDeadlineDuration.hours} hour{setterDeadlineDuration.hours !== 1 ? 's' : ''}, {setterDeadlineDuration.minutes} minute{setterDeadlineDuration.minutes !== 1 ? 's' : ''}
                </p>
                <p className="text-xs font-semibold text-pink-700 mt-2">Time Remaining</p>
                <CountdownPill
                  startTime={setterDeadlineStartTime}
                  duration={setterDeadlineDuration}
                />
              </div>
            )}

            <div className="space-y-4">
              {!showSetterDurationSettings ? (
                <>
                  <button
                    type="button"
                    onClick={() => setShowSetterDurationSettings(true)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                  >
                    {setterDeadlineActive ? 'Update Deadline Duration' : 'Set Deadline Duration'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onSetSetterDeadline(!setterDeadlineActive, setterDeadlineDuration)}
                    className={`w-full rounded-xl px-6 py-3 text-sm font-semibold transition ${
                      setterDeadlineActive
                        ? 'bg-amber-500/90 text-amber-950 hover:bg-amber-400'
                        : 'bg-pink-500/90 text-pink-950 hover:bg-pink-400'
                    }`}
                  >
                    {setterDeadlineActive ? 'Disable Setter Deadline' : 'Activate Setter Deadline'}
                  </button>
                </>
              ) : (
                <form onSubmit={(e) => {
                  e.preventDefault();
                  onSetSetterDeadline(setterDeadlineActive, setterDurationForm);
                  setShowSetterDurationSettings(false);
                }} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-3">
                      Set Deadline Duration for Setter Submissions
                    </label>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <label className="block text-xs font-medium text-slate-700">Days</label>
                        <input
                          type="number"
                          min="0"
                          max="30"
                          value={setterDurationForm.days}
                          onChange={(e) => setSetterDurationForm({ ...setterDurationForm, days: parseInt(e.target.value) || 0 })}
                          className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-lg font-semibold text-slate-800 text-center focus:border-pink-500 focus:outline-none focus:ring-2 focus:ring-pink-500/40"
                          placeholder="0"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="block text-xs font-medium text-slate-700">Hours</label>
                        <input
                          type="number"
                          min="0"
                          max="23"
                          value={setterDurationForm.hours}
                          onChange={(e) => setSetterDurationForm({ ...setterDurationForm, hours: parseInt(e.target.value) || 0 })}
                          className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-lg font-semibold text-slate-800 text-center focus:border-pink-500 focus:outline-none focus:ring-2 focus:ring-pink-500/40"
                          placeholder="0"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="block text-xs font-medium text-slate-700">Minutes</label>
                        <input
                          type="number"
                          min="0"
                          max="59"
                          value={setterDurationForm.minutes}
                          onChange={(e) => setSetterDurationForm({ ...setterDurationForm, minutes: parseInt(e.target.value) || 0 })}
                          className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-lg font-semibold text-slate-800 text-center focus:border-pink-500 focus:outline-none focus:ring-2 focus:ring-pink-500/40"
                          placeholder="0"
                        />
                      </div>
                    </div>
                    <div className="mt-4 rounded-lg border border-pink-200 bg-pink-50 p-3">
                      <p className="text-xs font-semibold text-pink-700 mb-1">Duration Preview</p>
                      <p className="text-sm font-semibold text-pink-900">
                        {setterDurationForm.days} day{setterDurationForm.days !== 1 ? 's' : ''}, {setterDurationForm.hours} hour{setterDurationForm.hours !== 1 ? 's' : ''}, {setterDurationForm.minutes} minute{setterDurationForm.minutes !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <p className="mt-3 text-xs text-slate-500">
                      Setters will have this duration to submit papers. When this expires, Team Lead deadline starts automatically.
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="submit"
                      className="flex-1 rounded-xl bg-pink-500/90 px-4 py-3 text-sm font-semibold text-pink-950 transition hover:bg-pink-400"
                    >
                      Save Duration
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowSetterDurationSettings(false);
                        setSetterDurationForm(setterDeadlineDuration);
                      }}
                      className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>

          {/* Team Lead Deadline Configuration */}
          <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-violet-50 via-white to-indigo-50 p-6">
            <div className="pointer-events-none absolute -left-10 -top-10 h-28 w-28 rounded-full bg-violet-200/40 blur-3xl" />
            <div className="pointer-events-none absolute right-0 bottom-0 h-24 w-24 rounded-full bg-indigo-200/40 blur-3xl" />
            <div className="relative flex items-center justify-between mb-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-sky-400 text-white shadow-md">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-semibold text-violet-700">
                    Team Lead Submission Deadline
                  </h3>
                  <p className="text-sm text-slate-700 mt-1">
                    Set duration for Team Lead paper submissions
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Starts automatically when Setter deadline expires
                  </p>
                </div>
              </div>
              <StatusPill
                label={teamLeadDeadlineActive ? 'Active' : 'Inactive'}
                active={teamLeadDeadlineActive}
                tone={teamLeadDeadlineActive ? 'blue' : 'amber'}
              />
            </div>

            {teamLeadDeadlineActive && teamLeadDeadlineStartTime && (
              <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50 p-4 flex flex-col gap-1">
                <p className="text-xs font-semibold text-violet-700">Current Deadline Duration</p>
                <p className="text-sm text-violet-800 font-medium">
                  {teamLeadDeadlineDuration.days} day{teamLeadDeadlineDuration.days !== 1 ? 's' : ''}, {teamLeadDeadlineDuration.hours} hour{teamLeadDeadlineDuration.hours !== 1 ? 's' : ''}, {teamLeadDeadlineDuration.minutes} minute{teamLeadDeadlineDuration.minutes !== 1 ? 's' : ''}
                </p>
                <p className="text-xs font-semibold text-violet-700 mt-2">Time Remaining</p>
                <CountdownPill
                  startTime={teamLeadDeadlineStartTime}
                  duration={teamLeadDeadlineDuration}
                />
              </div>
            )}

            <div className="space-y-4">
              {!showTeamLeadDurationSettings ? (
                <>
                  <button
                    type="button"
                    onClick={() => setShowTeamLeadDurationSettings(true)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                  >
                    {teamLeadDeadlineActive ? 'Update Deadline Duration' : 'Set Deadline Duration'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onSetTeamLeadDeadline(!teamLeadDeadlineActive, teamLeadDeadlineDuration)}
                    disabled={Boolean(setterDeadlineActive && setterDeadlineStartTime)}
                    className={`w-full rounded-xl px-6 py-3 text-sm font-semibold transition ${
                      teamLeadDeadlineActive
                        ? 'bg-amber-500/90 text-amber-950 hover:bg-amber-400'
                        : setterDeadlineActive && setterDeadlineStartTime
                        ? 'bg-slate-500/40 text-slate-700 cursor-not-allowed'
                        : 'bg-violet-500/90 text-violet-950 hover:bg-violet-400'
                    }`}
                  >
                    {teamLeadDeadlineActive ? 'Disable Team Lead Deadline' : setterDeadlineActive && setterDeadlineStartTime ? 'Will Start When Setter Deadline Expires' : 'Activate Team Lead Deadline'}
                  </button>
                  {setterDeadlineActive && setterDeadlineStartTime && (
                    <p className="text-xs text-amber-400 text-center">
                      ⚠️ Team Lead deadline will start automatically when Setter deadline expires
                    </p>
                  )}
                </>
              ) : (
                <form onSubmit={(e) => {
                  e.preventDefault();
                  onSetTeamLeadDeadline(teamLeadDeadlineActive, teamLeadDurationForm);
                  setShowTeamLeadDurationSettings(false);
                }} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-3">
                      Set Deadline Duration for Team Lead Submissions
                    </label>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <label className="block text-xs font-medium text-slate-700">Days</label>
                        <input
                          type="number"
                          min="0"
                          max="30"
                          value={teamLeadDurationForm.days}
                          onChange={(e) => setTeamLeadDurationForm({ ...teamLeadDurationForm, days: parseInt(e.target.value) || 0 })}
                          className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-lg font-semibold text-slate-800 text-center focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                          placeholder="0"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="block text-xs font-medium text-slate-700">Hours</label>
                        <input
                          type="number"
                          min="0"
                          max="23"
                          value={teamLeadDurationForm.hours}
                          onChange={(e) => setTeamLeadDurationForm({ ...teamLeadDurationForm, hours: parseInt(e.target.value) || 0 })}
                          className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-lg font-semibold text-slate-800 text-center focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                          placeholder="0"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="block text-xs font-medium text-slate-700">Minutes</label>
                        <input
                          type="number"
                          min="0"
                          max="59"
                          value={teamLeadDurationForm.minutes}
                          onChange={(e) => setTeamLeadDurationForm({ ...teamLeadDurationForm, minutes: parseInt(e.target.value) || 0 })}
                          className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-lg font-semibold text-slate-800 text-center focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                          placeholder="0"
                        />
                      </div>
                    </div>
                    <div className="mt-4 rounded-lg border border-violet-200 bg-violet-50 p-3">
                      <p className="text-xs font-semibold text-violet-700 mb-1">Duration Preview</p>
                      <p className="text-sm font-semibold text-violet-900">
                        {teamLeadDurationForm.days} day{teamLeadDurationForm.days !== 1 ? 's' : ''}, {teamLeadDurationForm.hours} hour{teamLeadDurationForm.hours !== 1 ? 's' : ''}, {teamLeadDurationForm.minutes} minute{teamLeadDurationForm.minutes !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <p className="mt-3 text-xs text-slate-500">
                      Team Leads will have this duration to submit papers. This deadline starts automatically when Setter deadline expires.
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="submit"
                      className="flex-1 rounded-xl bg-violet-500/90 px-4 py-3 text-sm font-semibold text-violet-950 transition hover:bg-violet-400"
                    >
                      Save Duration
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowTeamLeadDurationSettings(false);
                        setTeamLeadDurationForm(teamLeadDeadlineDuration);
                      }}
                      className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>

          {/* Repository Management */}
          <div className="space-y-6">
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-800">
                    Semester Repositories
                  </h3>
                  <p className="text-sm text-slate-600 mt-1">
                    Open or close repositories for submissions
                  </p>
                </div>
                <StatusPill
                  label={repositoriesActive ? 'Open' : 'Closed'}
                  active={repositoriesActive}
                  tone={repositoriesActive ? 'blue' : 'amber'}
                />
              </div>

              <div className="space-y-4">
                <button
                  type="button"
                  onClick={() => onToggleRepositories(!repositoriesActive)}
                  className={`w-full rounded-xl px-6 py-3 text-sm font-semibold transition ${
                    repositoriesActive
                      ? 'bg-emerald-500/90 text-emerald-950 hover:bg-emerald-400'
                      : 'bg-blue-500/90 text-emerald-950 hover:bg-blue-400'
                  }`}
                >
                  {repositoriesActive ? 'Close Repositories' : 'Open Repositories'}
                </button>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="text-xs font-semibold text-slate-600 mb-2">Status</p>
                  <p className="text-sm text-slate-700">
                    {repositoriesActive
                      ? 'Repositories are open. Team Leads can submit papers.'
                      : 'Repositories are closed. No submissions accepted.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Add Paper to Repository */}
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <div className="mb-4">
                <h3 className="text-base font-semibold text-slate-800">
                  Add Paper to Repository
                </h3>
                <p className="text-sm text-slate-600 mt-1">
                  Upload papers to the repository for AI similarity analysis
                </p>
              </div>

              <AddPaperToRepositoryForm onAddPaper={onAddPaperToRepository} />
            </div>

            {/* Repository Papers List */}
            {repositoryPapers.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-6">
                <div className="mb-4">
                  <h3 className="text-base font-semibold text-slate-800">
                    Repository Papers
                  </h3>
                  <p className="text-sm text-slate-600 mt-1">
                    View and manage papers in the repository
                  </p>
                </div>

                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {repositoryPapers.map((paper) => (
                    <div
                      key={paper.id}
                      className="rounded-lg border border-slate-200 bg-white p-4"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h4 className="text-sm font-semibold text-slate-800">{paper.fileName}</h4>
                            <span className="px-2 py-0.5 rounded-lg text-xs font-medium border bg-cyan-500/20 text-cyan-300 border-cyan-500/30">
                              {paper.courseCode}
                            </span>
                          </div>
                          <div className="space-y-1 text-xs text-slate-600">
                            <p>Course: <span className="text-slate-700">{paper.courseUnit}</span></p>
                            <p>Submitted by: <span className="text-slate-700">{paper.submittedBy}</span></p>
                            <p>Semester: <span className="text-slate-700">{paper.semester} {paper.year}</span></p>
                            <p>Added: {new Date(paper.submittedAt).toLocaleString()}</p>
                          </div>
                        </div>
                        <div className="flex flex-col gap-2 ml-4">
                          <button
                            type="button"
                            className="px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-xs font-medium text-cyan-300 border border-cyan-500/30 transition"
                            onClick={() => {
                              // Create a view window/modal for the paper
                              const blob = new Blob([paper.content], { type: 'application/pdf' });
                              const url = URL.createObjectURL(blob);
                              window.open(url, '_blank');
                              // Clean up after a delay
                              setTimeout(() => URL.revokeObjectURL(url), 100);
                            }}
                          >
                            View
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </SectionCard>

      {/* Moderation Export */}
      <SectionCard
        title="Moderation Export"
        kicker="Package Management"
        description="Download moderated exam packages and view export history."
      >
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold text-slate-800">
                Download Moderation Results
              </h3>
              <p className="text-sm text-slate-600 mt-1">
                Package and export moderated exam papers
              </p>
            </div>
            <StatusPill
              label={lastModerationDownload ? 'Exported' : 'Not Exported'}
              active={Boolean(lastModerationDownload)}
              tone={lastModerationDownload ? 'blue' : 'amber'}
            />
          </div>
          <button
            type="button"
            onClick={onDownloadModeration}
            className="w-full rounded-xl bg-amber-400/90 px-6 py-3 text-sm font-semibold text-amber-950 transition hover:bg-amber-300"
          >
            Download Moderation Results
          </button>
          {lastModerationDownload && (
            <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
              <p className="text-xs font-semibold text-amber-300 mb-1">Last Export</p>
              <p className="text-sm text-amber-200">
                {formatTimestamp(lastModerationDownload)}
              </p>
            </div>
          )}
        </div>
      </SectionCard>

      {/* AI Similarity Detection */}
      <AISimilarityDetectionPanel repositoryPapers={repositoryPapers} />
    </div>
  );
}

interface SetterSubmissionFormProps {
  onSubmit: (
    file: File,
    courseCode: string,
    courseName: string,
    semester: string,
    academicYear: string,
    campus: string
  ) => void;
  canSubmit: boolean;
  workflowStage: WorkflowStage;
  timeRemaining: { days: number; hours: number; minutes: number; seconds: number; expired: boolean } | null;
  deadlineActive: boolean;
  defaultCourseUnit?: string | null;
  defaultCampus?: string | null;
}

function SetterSubmissionForm({
  onSubmit,
  canSubmit,
  workflowStage,
  timeRemaining,
  deadlineActive,
  defaultCourseUnit,
  defaultCampus,
}: SetterSubmissionFormProps) {
  const currentYear = new Date().getFullYear().toString();
  const currentSemester = 'Advent'; // default liturgical semester; adjust if you track this elsewhere

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [courseUnit, setCourseUnit] = useState(defaultCourseUnit ?? '');
  const [courseCode, setCourseCode] = useState('');
  const [semester, setSemester] = useState(currentSemester);
  const [year, setYear] = useState(currentYear);
  const [campus, setCampus] = useState(defaultCampus ?? '');

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        setSelectedFile(file);
      } else {
        alert('Please select a PDF file only.');
        e.target.value = '';
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      alert('Please select a PDF file.');
      return;
    }
    if (!courseCode || !courseUnit || !semester || !year || !campus) {
      alert('Please fill in Course Code, Course Name, Semester, Academic Year and Campus.');
      return;
    }

    onSubmit(selectedFile, courseCode, courseUnit, semester, year, campus);
    
    // Reset form
    setSelectedFile(null);
    setCourseUnit(defaultCourseUnit ?? '');
    setCourseCode('');
    setSemester(currentSemester);
    setYear(currentYear);
    setCampus(defaultCampus ?? '');
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Current workflow stage banner - high contrast, AI-inspired card */}
      <div className="relative overflow-hidden rounded-2xl border border-pink-200 bg-gradient-to-r from-white via-pink-50 to-rose-50 p-4 sm:p-5 shadow-sm">
        <div className="pointer-events-none absolute -right-12 -top-12 h-24 w-24 rounded-full bg-pink-300/20 blur-2xl" />
        <div className="pointer-events-none absolute -left-10 bottom-0 h-16 w-16 rounded-full bg-rose-200/40 blur-2xl" />

        <div className="relative z-10 flex items-start gap-3">
          <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500 to-rose-500 text-white shadow-md">
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l3 3" />
            </svg>
          </div>

          <div className="flex-1 space-y-1">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-pink-700">
              Current Workflow Stage
            </p>
            <p className="text-base font-semibold text-slate-900">
              {workflowStage}
            </p>
            <p className="text-xs text-slate-500">
              This tells you exactly where your paper is in the moderation journey right now.
            </p>
          </div>
        </div>
      </div>
      
      {!canSubmit && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-xs font-semibold text-amber-300 mb-1">Submission Not Available</p>
          <p className="text-sm text-amber-200">
            {workflowStage !== 'Awaiting Setter' 
              ? `Paper submission is only available when the workflow stage is "Awaiting Setter". Current stage: ${workflowStage}`
              : timeRemaining?.expired
              ? 'The submission deadline has expired. Team Lead deadline has started.'
              : !deadlineActive
              ? 'Deadline has not been activated by Chief Examiner yet.'
              : 'Submission is not available at this time.'}
          </p>
        </div>
      )}

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
          Select PDF File
        </label>
        <input
          type="file"
          accept=".pdf"
          onChange={handleFileSelect}
          disabled={!canSubmit}
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 file:mr-4 file:rounded-lg file:border-0 file:bg-pink-500/90 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-pink-950 file:cursor-pointer hover:file:bg-pink-400 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        {selectedFile && (
          <p className="mt-2 text-xs text-blue-700">
            Selected: {selectedFile.name}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
            Course Code
          </label>
          <input
            type="text"
            value={courseCode}
            onChange={(e) => setCourseCode(e.target.value)}
            placeholder="e.g., CSC2101"
            disabled={!canSubmit}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:border-pink-500 focus:outline-none focus:ring-2 focus:ring-pink-500/40 disabled:opacity-50"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
            Course Name
          </label>
          {defaultCourseUnit ? (
            <div className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              {defaultCourseUnit}
            </div>
          ) : (
            <input
              type="text"
              value={courseUnit}
              onChange={(e) => setCourseUnit(e.target.value)}
              placeholder="e.g., Advanced Algorithms"
              disabled={!canSubmit}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:border-pink-500 focus:outline-none focus:ring-2 focus:ring-pink-500/40 disabled:opacity-50"
            />
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
            Semester
          </label>
          <select
            value={semester}
            onChange={(e) => setSemester(e.target.value)}
            disabled={!canSubmit}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:border-pink-500 focus:outline-none focus:ring-2 focus:ring-pink-500/40 disabled:opacity-50"
          >
            <option value="">Select semester...</option>
            <option value="Advent">Advent</option>
            <option value="Easter">Easter</option>
            <option value="Trinity">Trinity</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
            Academic Year
          </label>
          <input
            type="text"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            placeholder="e.g., 2024"
            disabled={!canSubmit}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:border-pink-500 focus:outline-none focus:ring-2 focus:ring-pink-500/40 disabled:opacity-50"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
          Campus
        </label>
        <input
          type="text"
          value={campus}
          onChange={(e) => setCampus(e.target.value)}
          placeholder="e.g., Main Campus"
          disabled={!canSubmit}
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:border-pink-500 focus:outline-none focus:ring-2 focus:ring-pink-500/40 disabled:opacity-50"
        />
      </div>

      <button
        type="submit"
        disabled={!canSubmit || !selectedFile || !courseCode || !courseUnit || !semester || !year || !campus}
        className={`w-full rounded-xl px-6 py-4 text-sm font-semibold transition-all shadow-lg ${
          canSubmit && selectedFile && courseCode && courseUnit && semester && year && campus
            ? 'bg-pink-500/90 text-pink-950 hover:bg-pink-400 shadow-pink-500/30'
            : 'bg-pink-500/40 text-pink-900 cursor-not-allowed'
        }`}
      >
        {canSubmit ? 'Submit' : 'Submission Not Available'}
      </button>

      {canSubmit && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold text-slate-700 mb-2">What happens next?</p>
          <ul className="space-y-1 text-xs text-slate-600">
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span>Your paper will be sent to the Team Lead for compilation</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span>A copy will be automatically shared with the Chief Examiner</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span>Paper will be added to repository for AI analysis</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span>The workflow will progress to "Submitted to Team Lead" stage</span>
            </li>
          </ul>
        </div>
      )}
    </form>
  );
}

interface SetterPanelProps {
  workflowStage: WorkflowStage;
  onSetterSubmit: (
    file: File,
    courseCode: string,
    courseName: string,
    semester: string,
    academicYear: string,
    campus: string
  ) => void;
  deadlineActive: boolean;
  deadlineStartTime: number | null;
  deadlineDuration: { days: number; hours: number; minutes: number };
  currentUserCourseUnit?: string;
  currentUserCampus?: string;
  mySubmissions: SetterSubmission[];
}

function SetterPanel({
  workflowStage,
  onSetterSubmit,
  deadlineActive,
  deadlineStartTime,
  deadlineDuration,
  currentUserCourseUnit,
  currentUserCampus,
  mySubmissions,
}: SetterPanelProps) {
  const [currentTime, setCurrentTime] = useState(Date.now());

  useEffect(() => {
    if (deadlineActive && deadlineStartTime) {
      const timer = setInterval(() => {
        setCurrentTime(Date.now());
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [deadlineActive, deadlineStartTime]);

  const calculateTimeRemaining = () => {
    if (!deadlineActive || !deadlineStartTime) {
      return null;
    }

    const totalDurationMs =
      deadlineDuration.days * 24 * 60 * 60 * 1000 +
      deadlineDuration.hours * 60 * 60 * 1000 +
      deadlineDuration.minutes * 60 * 1000;

    const elapsed = currentTime - deadlineStartTime;
    const remaining = totalDurationMs - elapsed;

    if (remaining <= 0) {
      return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
    }

    const days = Math.floor(remaining / (24 * 60 * 60 * 1000));
    const hours = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
    const seconds = Math.floor((remaining % (60 * 1000)) / 1000);

    return { days, hours, minutes, seconds, expired: false };
  };

  const timeRemaining = calculateTimeRemaining();
  const canSubmit = workflowStage === 'Awaiting Setter' && deadlineActive && !timeRemaining?.expired;

  return (
    <div className="space-y-6">
      {/* Countdown Timer */}
      <SectionCard
        title="Submission Deadline"
        kicker="Time Remaining"
        description="Countdown timer showing the time remaining to submit your paper draft."
      >
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          {!deadlineActive ? (
            <div className="text-center py-8">
              <p className="text-sm text-slate-600">Deadlines are not currently active.</p>
              <p className="text-xs text-slate-500 mt-2">Waiting for Chief Examiner to activate deadlines.</p>
            </div>
          ) : !deadlineStartTime ? (
            <div className="text-center py-8">
              <p className="text-sm text-slate-600">Deadline timer will start when activated.</p>
            </div>
          ) : timeRemaining?.expired ? (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-rose-500/20 border-2 border-rose-500/50 mb-4">
                <span className="text-2xl">⏰</span>
              </div>
              <p className="text-lg font-semibold text-rose-300">Deadline Expired</p>
              <p className="text-sm text-slate-600 mt-2">The submission deadline has passed. Team Lead deadline has started.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-3xl font-bold text-pink-300">{String(timeRemaining?.days ?? 0).padStart(2, '0')}</p>
                    <p className="text-xs text-slate-600 mt-1 uppercase tracking-wide">Days</p>
                  </div>
                </div>
                <div className="text-center">
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-3xl font-bold text-pink-300">{String(timeRemaining?.hours ?? 0).padStart(2, '0')}</p>
                    <p className="text-xs text-slate-600 mt-1 uppercase tracking-wide">Hours</p>
                  </div>
                </div>
                <div className="text-center">
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-3xl font-bold text-pink-300">{String(timeRemaining?.minutes ?? 0).padStart(2, '0')}</p>
                    <p className="text-xs text-slate-600 mt-1 uppercase tracking-wide">Minutes</p>
                  </div>
                </div>
                <div className="text-center">
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-3xl font-bold text-pink-300">{String(timeRemaining?.seconds ?? 0).padStart(2, '0')}</p>
                    <p className="text-xs text-slate-600 mt-1 uppercase tracking-wide">Seconds</p>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-pink-500/30 bg-pink-500/10 p-4">
                <p className="text-xs font-semibold text-pink-300 mb-1">Deadline Duration</p>
                <p className="text-sm text-pink-200">
                  {deadlineDuration.days} day{deadlineDuration.days !== 1 ? 's' : ''}, {deadlineDuration.hours} hour{deadlineDuration.hours !== 1 ? 's' : ''}, {deadlineDuration.minutes} minute{deadlineDuration.minutes !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Submit Draft"
        kicker="Paper Submission"
        description="Submit your exam paper draft to the Team Lead. A copy will be automatically shared with the Chief Examiner and added to repository."
      >
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-6">
          <SetterSubmissionForm
            onSubmit={onSetterSubmit}
            canSubmit={canSubmit}
            workflowStage={workflowStage}
            timeRemaining={timeRemaining}
            deadlineActive={deadlineActive}
            defaultCourseUnit={currentUserCourseUnit}
            defaultCampus={currentUserCampus}
          />
        </div>
      </SectionCard>

      {/* Setter's own submission copy/history */}
      {mySubmissions.length > 0 && (
        <SectionCard
          title="My Submitted Drafts"
          kicker="Personal Copy"
          description="A quick history of drafts you have submitted for this paper. You can always download a copy from here."
        >
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {mySubmissions.map((submission) => (
              <div
                key={submission.id}
                className="group relative overflow-hidden rounded-2xl border border-pink-100 bg-gradient-to-br from-pink-50 via-white to-slate-50 p-4 shadow-sm"
              >
                <div className="pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full bg-pink-200/40 blur-2xl" />
                <div className="relative z-10 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="truncate text-sm font-semibold text-slate-900">
                      {submission.fileName}
                    </h4>
                    <span className="rounded-full bg-pink-100 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-pink-700">
                      My copy
                    </span>
                  </div>
                  <p className="text-[0.7rem] text-slate-600">
                    Submitted on{' '}
                    <span className="font-medium text-slate-800">
                      {new Date(submission.submittedAt).toLocaleString()}
                    </span>
                  </p>
                  <button
                    type="button"
                    className="mt-2 inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-pink-500 to-pink-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:from-pink-400 hover:to-pink-500"
                    onClick={() => {
                      const blob = new Blob(['Draft paper content'], { type: 'application/pdf' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = submission.fileName;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    }}
                  >
                    Download my draft
                  </button>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

interface TeamLeadPanelProps {
  deadlinesActive: boolean;
  deadlineStartTime: number | null;
  deadlineDuration: { days: number; hours: number; minutes: number };
  repositoriesActive: boolean;
  onTeamLeadCompile: () => void;
  submittedPapers: Array<{
    id: string;
    fileName: string;
    submittedBy: string;
    submittedAt: string;
    fileSize?: number;
    status: 'submitted' | 'in-vetting' | 'vetted' | 'approved';
  }>;
  setterSubmissions: Array<{
    id: string;
    fileName: string;
    submittedBy: string;
    submittedAt: string;
    fileContent?: string;
  }>;
  workflowStage: WorkflowStage;
  onSubmitPDF: (file: File, courseUnit: string, courseCode: string, semester: string, year: string) => void;
}

function TeamLeadPanel({
  deadlinesActive,
  deadlineStartTime,
  deadlineDuration,
  repositoriesActive,
  onTeamLeadCompile,
  submittedPapers,
  setterSubmissions,
  workflowStage,
  onSubmitPDF,
}: TeamLeadPanelProps) {
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [courseUnit, setCourseUnit] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [semester, setSemester] = useState('');
  const [year, setYear] = useState('');

  useEffect(() => {
    if (deadlinesActive && deadlineStartTime) {
      const timer = setInterval(() => {
        setCurrentTime(Date.now());
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [deadlinesActive, deadlineStartTime]);

  const calculateTimeRemaining = () => {
    if (!deadlinesActive || !deadlineStartTime) {
      return null;
    }

    const totalDurationMs =
      deadlineDuration.days * 24 * 60 * 60 * 1000 +
      deadlineDuration.hours * 60 * 60 * 1000 +
      deadlineDuration.minutes * 60 * 1000;

    const elapsed = currentTime - deadlineStartTime;
    const remaining = totalDurationMs - elapsed;

    if (remaining <= 0) {
      return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
    }

    const days = Math.floor(remaining / (24 * 60 * 60 * 1000));
    const hours = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
    const seconds = Math.floor((remaining % (60 * 1000)) / 1000);

    return { days, hours, minutes, seconds, expired: false };
  };

  const timeRemaining = calculateTimeRemaining();
  const canSubmit = deadlinesActive && repositoriesActive && !timeRemaining?.expired;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      // Only accept PDF files
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        setSelectedFile(file);
      } else {
        alert('Please select a PDF file only.');
        e.target.value = ''; // Clear the input
      }
    }
  };

  const handleSubmitPDF = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      alert('Please select a PDF file to submit.');
      return;
    }
    if (!courseUnit || !courseCode || !semester || !year) {
      alert('Please fill in all fields.');
      return;
    }

    onSubmitPDF(selectedFile, courseUnit, courseCode, semester, year);
    
    // Reset form
    setSelectedFile(null);
    setCourseUnit('');
    setCourseCode('');
    setSemester('');
    setYear('');
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'submitted':
        return 'text-violet-400 bg-violet-500/10 border-violet-500/30';
      case 'in-vetting':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
      case 'vetted':
        return 'text-blue-600 bg-blue-500/10 border-blue-500/30';
      case 'approved':
        return 'text-blue-600 bg-blue-500/10 border-blue-500/30';
      default:
        return 'text-slate-600 bg-slate-500/10 border-slate-500/30';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'submitted':
        return 'Submitted';
      case 'in-vetting':
        return 'In Vetting';
      case 'vetted':
        return 'Vetted';
      case 'approved':
        return 'Approved';
      default:
        return status;
    }
  };

  const handleDownloadModerationChecklist = () => {
    // Download moderation checklist with comments from vetting
    alert('Downloading moderation checklist with vetting comments...');
    // In a real app, this would trigger a download of the checklist PDF
  };

  return (
    <div className="space-y-6">
      {/* Countdown Timer */}
      <SectionCard
        title="Submission Deadline"
        kicker="Time Remaining"
        description="Countdown timer showing the time remaining to submit papers as set by the Chief Examiner."
      >
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          {!deadlinesActive ? (
            <div className="text-center py-8">
              <p className="text-sm text-slate-600">Deadlines are not currently active.</p>
              <p className="text-xs text-slate-500 mt-2">Waiting for Chief Examiner to activate deadlines.</p>
            </div>
          ) : !deadlineStartTime ? (
            <div className="text-center py-8">
              <p className="text-sm text-slate-600">Deadline timer will start when activated.</p>
            </div>
          ) : timeRemaining?.expired ? (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-rose-500/20 border-2 border-rose-500/50 mb-4">
                <span className="text-2xl">⏰</span>
              </div>
              <p className="text-lg font-semibold text-rose-300">Deadline Expired</p>
              <p className="text-sm text-slate-600 mt-2">The submission deadline has passed.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-3xl font-bold text-blue-700">{String(timeRemaining?.days ?? 0).padStart(2, '0')}</p>
                    <p className="text-xs text-slate-600 mt-1 uppercase tracking-wide">Days</p>
                  </div>
                </div>
                <div className="text-center">
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-3xl font-bold text-blue-700">{String(timeRemaining?.hours ?? 0).padStart(2, '0')}</p>
                    <p className="text-xs text-slate-600 mt-1 uppercase tracking-wide">Hours</p>
                  </div>
                </div>
                <div className="text-center">
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-3xl font-bold text-blue-700">{String(timeRemaining?.minutes ?? 0).padStart(2, '0')}</p>
                    <p className="text-xs text-slate-600 mt-1 uppercase tracking-wide">Minutes</p>
                  </div>
                </div>
                <div className="text-center">
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-3xl font-bold text-blue-700">{String(timeRemaining?.seconds ?? 0).padStart(2, '0')}</p>
                    <p className="text-xs text-slate-600 mt-1 uppercase tracking-wide">Seconds</p>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
                <p className="text-xs font-semibold text-blue-700 mb-1">Deadline Duration</p>
                <p className="text-sm text-blue-800">
                  {deadlineDuration.days} day{deadlineDuration.days !== 1 ? 's' : ''}, {deadlineDuration.hours} hour{deadlineDuration.hours !== 1 ? 's' : ''}, {deadlineDuration.minutes} minute{deadlineDuration.minutes !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          )}
        </div>
      </SectionCard>

      {/* Team Lead Actions */}
      <SectionCard
        title="Team Lead Actions"
        kicker="Submission & Review"
        description="Upload PDF to Chief Examiner and download moderation checklist with vetting comments."
      >
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-6">
          {/* Upload PDF Form */}
          <form onSubmit={handleSubmitPDF} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
                Upload PDF to Chief Examiner
              </label>
              <input
                type="file"
                accept=".pdf"
                onChange={handleFileSelect}
                disabled={!canSubmit}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 file:mr-4 file:rounded-lg file:border-0 file:bg-blue-500/90 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-indigo-950 file:cursor-pointer hover:file:bg-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              {selectedFile && (
                <p className="mt-2 text-xs text-blue-700">
                  Selected: {selectedFile.name}
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
                  Course Code
                </label>
                <input
                  type="text"
                  value={courseCode}
                  onChange={(e) => setCourseCode(e.target.value)}
                  placeholder="e.g., CSC 302"
                  disabled={!canSubmit}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
                  Course Unit
                </label>
                <input
                  type="text"
                  value={courseUnit}
                  onChange={(e) => setCourseUnit(e.target.value)}
                  placeholder="e.g., Advanced Algorithms"
                  disabled={!canSubmit}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
                  Semester
                </label>
                <select
                  value={semester}
                  onChange={(e) => setSemester(e.target.value)}
                  disabled={!canSubmit}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50"
                >
                  <option value="">Select semester...</option>
                  <option value="Advent">Advent</option>
                  <option value="Easter">Easter</option>
                  <option value="Trinity">Trinity</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
                  Year
                </label>
                <input
                  type="text"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="e.g., 2024"
                  disabled={!canSubmit}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={!canSubmit || !selectedFile || !courseUnit || !courseCode || !semester || !year}
              className="w-full rounded-xl bg-blue-500/90 px-6 py-4 text-sm font-semibold text-indigo-950 transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-blue-500/40 disabled:text-indigo-900"
            >
              Submit PDF to Chief Examiner
            </button>
            {!repositoriesActive && (
              <p className="text-xs text-amber-400">Repositories are closed. Cannot submit at this time.</p>
            )}
          </form>

          {/* Divider */}
          <div className="border-t border-slate-200"></div>

          {/* Download Moderation Checklist Button */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
                Download Moderation Checklist
              </label>
              <p className="text-xs text-slate-600 mb-3">
                Download the moderation checklist with comments and feedback from the vetting process.
              </p>
            </div>
            <button
              type="button"
              onClick={handleDownloadModerationChecklist}
              className="w-full rounded-xl bg-amber-400/90 px-6 py-4 text-sm font-semibold text-amber-950 transition hover:bg-amber-300"
            >
              Download Moderation Checklist
            </button>
          </div>
        </div>
      </SectionCard>

      {/* Setter Submissions Section */}
      {setterSubmissions.length > 0 && (
        <SectionCard
          title="Setter Submissions"
          kicker="Download Papers from Setters"
          description="Highly visible overview of drafts coming in from Setters for compilation and review."
        >
          <div className="space-y-4">
            {/* Header summary strip */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-sky-900 via-indigo-900 to-slate-900 px-5 py-4 shadow-sm">
              <div>
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-sky-200">
                  Incoming Drafts
                </p>
                <p className="text-xs text-sky-100/80">
                  {setterSubmissions.length === 1
                    ? '1 draft ready for compilation.'
                    : `${setterSubmissions.length} drafts ready for compilation.`}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 rounded-xl bg-sky-800/80 px-3 py-1.5 text-xs text-sky-100 shadow-inner">
                  <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="font-semibold">Live queue</span>
                </div>
              </div>
            </div>

            {/* Draft cards */}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {setterSubmissions.map((submission, index) => (
                <div
                  key={submission.id}
                  className="group relative overflow-hidden rounded-2xl border border-sky-100 bg-gradient-to-br from-slate-50 via-white to-sky-50 p-4 shadow-sm transition-transform hover:-translate-y-1 hover:shadow-xl"
                >
                  <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-sky-200/40 blur-3xl" />
                  <div className="pointer-events-none absolute bottom-0 left-0 h-16 w-16 rounded-full bg-amber-200/50 blur-2xl" />

                  <div className="relative z-10 flex items-start justify-between gap-3">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-md">
                          <span className="text-xs font-semibold">{index + 1}</span>
                        </span>
                        <div className="min-w-0">
                          <h4 className="truncate text-sm font-semibold text-slate-900">
                            {submission.fileName}
                          </h4>
                          <p className="text-[0.7rem] text-slate-500">
                            From Setter •{' '}
                            <span className="font-medium text-slate-700">
                              {submission.submittedBy}
                            </span>
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[0.7rem] text-slate-600">
                        <div className="space-y-0.5">
                          <p className="font-semibold uppercase tracking-wide text-slate-500">
                            Submitted
                          </p>
                          <p className="text-slate-700">
                            {new Date(submission.submittedAt).toLocaleString()}
                          </p>
                        </div>
                        <div className="space-y-0.5">
                          <p className="font-semibold uppercase tracking-wide text-slate-500">
                            Status
                          </p>
                          <p className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[0.65rem] font-semibold text-emerald-700 ring-1 ring-emerald-100">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Awaiting compilation
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-amber-400 to-amber-500 px-3 py-1.5 text-xs font-semibold text-amber-950 shadow-sm transition hover:from-amber-300 hover:to-amber-400"
                        onClick={() => {
                          const blob = new Blob(['Draft paper content'], { type: 'application/pdf' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = submission.fileName;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          URL.revokeObjectURL(url);
                        }}
                      >
                        <span>Download</span>
                      </button>

                      <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[0.6rem] font-medium uppercase tracking-wide text-sky-700">
                        Setter draft
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>
      )}

      {/* Submitted Papers Section */}
      {submittedPapers.length > 0 && (
        <SectionCard
          title="My Submitted Papers"
          kicker="Submission History"
          description="View all papers you have submitted and track their status through the vetting process."
        >
          <div className="space-y-3">
            {submittedPapers.map((paper) => (
              <div
                key={paper.id}
                className={`rounded-xl border p-4 transition ${getStatusColor(paper.status)}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="text-sm font-semibold text-slate-800">{paper.fileName}</h4>
                      <span className={`px-2 py-0.5 rounded-lg text-xs font-medium border ${getStatusColor(paper.status)}`}>
                        {getStatusLabel(paper.status)}
                      </span>
                    </div>
                    <div className="space-y-1 text-xs text-slate-600">
                      <p>Submitted: {new Date(paper.submittedAt).toLocaleString()}</p>
                      {paper.fileSize && (
                        <p>Size: {(paper.fileSize / 1024).toFixed(2)} KB</p>
                      )}
                      <p>Current Workflow Stage: <span className="text-slate-700">{workflowStage}</span></p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 ml-4">
                    <button
                      type="button"
                      className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-xs font-medium text-slate-700 transition"
                      onClick={() => {
                        // In a real app, this would download or view the paper
                        alert(`Viewing paper: ${paper.fileName}`);
                      }}
                    >
                      View
                    </button>
                    {paper.status === 'vetted' && (
                      <button
                        type="button"
                        className="px-3 py-1.5 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-xs font-medium text-blue-700 transition"
                        onClick={handleDownloadModerationChecklist}
                      >
                        Download Report
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

interface TeamLeadDashboardPanelProps {
  workflow: WorkflowState;
  submittedPapers: SubmittedPaper[];
  setterSubmissions: SetterSubmission[];
}

function TeamLeadDashboardPanel({
  workflow,
  submittedPapers,
  setterSubmissions,
}: TeamLeadDashboardPanelProps) {
  const timelineData = useMemo(
    () =>
      workflow.timeline.map((event, index) => ({
        step: index + 1,
        label: event.stage,
        stageIndex: index + 1,
      })),
    [workflow.timeline]
  );

  const compiledCount = submittedPapers.length;
  const setterDrafts = setterSubmissions.length;

  return (
    <SectionCard
      title="Team Lead Dashboard"
      kicker="Coordination & Submission Flow"
      description="Soft overview of drafts coming from setters and compiled packages forwarded to the Chief Examiner."
    >
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-sky-50 to-blue-50 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-600">
            Role Snapshot
          </p>
          <p className="text-sm text-slate-700">
            Current workflow stage:{' '}
            <span className="font-semibold text-indigo-700">
              {workflow.stage}
            </span>
          </p>
          <div className="grid grid-cols-2 gap-3 pt-2 text-xs text-slate-700">
            <div className="rounded-xl bg-white/80 p-3 shadow-sm">
              <p className="text-[0.65rem] uppercase tracking-wide text-slate-500">
                Setter drafts
              </p>
              <p className="mt-1 text-lg font-semibold text-indigo-700">
                {setterDrafts}
              </p>
            </div>
            <div className="rounded-xl bg-white/80 p-3 shadow-sm">
              <p className="text-[0.65rem] uppercase tracking-wide text-slate-500">
                Compiled packages
              </p>
              <p className="mt-1 text-lg font-semibold text-emerald-600">
                {compiledCount}
              </p>
            </div>
          </div>
        </div>

        <div className="col-span-1 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-sm">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-indigo-500">
            Journey Line
          </p>
          <p className="text-xs text-slate-500">
            Light line view of how this paper has moved through the stages.
          </p>
          <div className="mt-3 h-44">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={timelineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="step" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="stageIndex"
                  stroke="#22c55e"
                  strokeWidth={2}
                  dot={{ r: 3, strokeWidth: 1, stroke: '#166534', fill: '#4ade80' }}
                  isAnimationActive
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-sm">
          <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-slate-500">
            Next Coordination Step
          </p>
          <p className="text-sm text-slate-700">
            {setterDrafts === 0
              ? 'Remind setters to upload their drafts into the workflow.'
              : compiledCount === 0
              ? 'Compile received drafts into a single package for vetting.'
              : 'Forward compiled package to the Chief Examiner and monitor vetting feedback.'}
          </p>
        </div>
      </div>
    </SectionCard>
  );
}

interface Paper {
  id: string;
  courseUnit: string;
  courseCode: string;
  semester: string;
  year: string;
  submittedBy: string;
  submittedAt: string;
  fileName: string;
  content: string;
}

interface SimilarityResult {
  paperId: string;
  historicalPaperId: string;
  similarityScore: number;
  matchedSections: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

interface AISimilarityDetectionPanelProps {
  repositoryPapers: Array<{
    id: string;
    courseUnit: string;
    courseCode: string;
    semester: string;
    year: string;
    submittedBy: string;
    submittedAt: string;
    fileName: string;
    content: string;
    fileSize?: number;
  }>;
}

function AISimilarityDetectionPanel({ repositoryPapers }: AISimilarityDetectionPanelProps) {
  const [selectedCourse, setSelectedCourse] = useState<string>('');
  const [isScanning, setIsScanning] = useState(false);
  const [similarityResults, setSimilarityResults] = useState<SimilarityResult[]>([]);
  const [showDetails, setShowDetails] = useState<string | null>(null);

  // Use repository papers - convert to Paper format
  const allRepositoryPapers: Paper[] = repositoryPapers.map(paper => ({
    id: paper.id,
    courseUnit: paper.courseUnit,
    courseCode: paper.courseCode,
    semester: paper.semester,
    year: paper.year,
    submittedBy: paper.submittedBy,
    submittedAt: paper.submittedAt,
    fileName: paper.fileName,
    content: paper.content,
  }));

  // Separate current semester papers from historical papers
  const currentYear = new Date().getFullYear().toString();
  const currentSemester = 'Advent'; // Match liturgical semesters (Advent, Easter, Trinity)
  const submittedPapers = allRepositoryPapers.filter(p => p.year === currentYear && p.semester === currentSemester);
  const historicalPapers = allRepositoryPapers.filter(p => !(p.year === currentYear && p.semester === currentSemester));

  const courseUnits = Array.from(new Set(allRepositoryPapers.map(p => `${p.courseCode} - ${p.courseUnit}`)));

  // AI Similarity Detection Algorithm (simulated)
  const detectSimilarity = (currentPaper: Paper, historicalPaper: Paper): SimilarityResult | null => {
    // Simple text similarity simulation
    const currentWords = currentPaper.content.toLowerCase().split(/\s+/);
    const historicalWords = historicalPaper.content.toLowerCase().split(/\s+/);
    
    const commonWords = currentWords.filter(word => historicalWords.includes(word));
    const similarityScore = (commonWords.length / Math.max(currentWords.length, historicalWords.length)) * 100;

    if (similarityScore < 30) return null; // Only return if similarity is significant

    const matchedSections: string[] = [];
    if (similarityScore > 70) matchedSections.push('Question Structure');
    if (similarityScore > 60) matchedSections.push('Key Concepts');
    if (similarityScore > 50) matchedSections.push('Terminology');

    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (similarityScore >= 85) riskLevel = 'critical';
    else if (similarityScore >= 70) riskLevel = 'high';
    else if (similarityScore >= 50) riskLevel = 'medium';

    return {
      paperId: currentPaper.id,
      historicalPaperId: historicalPaper.id,
      similarityScore: Math.round(similarityScore),
      matchedSections,
      riskLevel,
    };
  };

  const handleScan = () => {
    if (!selectedCourse) {
      alert('Please select a course unit first');
      return;
    }

    setIsScanning(true);
    setSimilarityResults([]);

    // Simulate AI processing delay
    setTimeout(() => {
      const [courseCode, courseUnit] = selectedCourse.split(' - ');
      const currentPapers = submittedPapers.filter(p => p.courseCode === courseCode);
      const historicalPapersForCourse = historicalPapers.filter(p => p.courseCode === courseCode);

      const results: SimilarityResult[] = [];

      currentPapers.forEach(currentPaper => {
        historicalPapersForCourse.forEach(historicalPaper => {
          const result = detectSimilarity(currentPaper, historicalPaper);
          if (result) {
            results.push(result);
          }
        });
      });

      setSimilarityResults(results);
      setIsScanning(false);
    }, 2000);
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'critical': return 'bg-rose-500/20 text-rose-300 border-rose-500/40';
      case 'high': return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      case 'medium': return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40';
      case 'low': return 'bg-blue-500/20 text-blue-700 border-blue-500/40';
      default: return 'bg-white text-slate-700 border-slate-300';
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 85) return 'text-rose-400';
    if (score >= 70) return 'text-amber-400';
    if (score >= 50) return 'text-yellow-400';
    return 'text-blue-600';
  };

  return (
    <SectionCard
      title="AI Similarity Detection"
      kicker="Academic Integrity Check"
      description="Compare submitted exam papers with historical papers from previous semesters to detect potential similarities and ensure academic integrity."
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-4">Course Unit Selection</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-slate-600 mb-2">Select Course Unit</label>
              <select
                value={selectedCourse}
                onChange={(e) => {
                  setSelectedCourse(e.target.value);
                  setSimilarityResults([]);
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
              >
                <option value="">Choose a course unit...</option>
                {courseUnits.map((course) => (
                  <option key={course} value={course}>
                    {course}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={handleScan}
                disabled={!selectedCourse || isScanning}
                className="w-full rounded-lg bg-blue-500/20 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isScanning ? 'Scanning...' : 'Run AI Similarity Scan'}
              </button>
            </div>
          </div>
        </div>

        {selectedCourse && (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-4">Submitted Papers (Current Semester)</h3>
            <div className="space-y-3">
              {submittedPapers
                .filter(p => selectedCourse.includes(p.courseCode))
                .map((paper) => (
                  <div key={paper.id} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-slate-800">{paper.courseCode}</p>
                        <p className="text-xs text-slate-600 mt-1">{paper.fileName}</p>
                        <p className="text-xs text-slate-500 mt-1">Submitted by: {paper.submittedBy}</p>
                        <p className="text-xs text-slate-500">
                          {new Date(paper.submittedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <span className="text-xs text-blue-600">Ready for Scan</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {similarityResults.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">Similarity Detection Results</h3>
              <span className="text-xs text-slate-600">
                {similarityResults.length} match{similarityResults.length !== 1 ? 'es' : ''} found
              </span>
            </div>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {similarityResults.map((result, idx) => {
                const currentPaper = submittedPapers.find(p => p.id === result.paperId);
                const historicalPaper = historicalPapers.find(p => p.id === result.historicalPaperId);
                
                return (
                  <div
                    key={idx}
                    className={`rounded-lg border p-4 ${getRiskColor(result.riskLevel)}`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`text-2xl font-bold ${getScoreColor(result.similarityScore)}`}>
                            {result.similarityScore}%
                          </span>
                          <span className={`px-2 py-1 rounded text-xs font-semibold uppercase ${getRiskColor(result.riskLevel)}`}>
                            {result.riskLevel} Risk
                          </span>
                        </div>
                        <p className="text-xs text-slate-700 mb-1">
                          <span className="font-semibold">Current:</span> {currentPaper?.fileName}
                        </p>
                        <p className="text-xs text-slate-700">
                          <span className="font-semibold">Historical:</span> {historicalPaper?.fileName} ({historicalPaper?.semester} {historicalPaper?.year})
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowDetails(showDetails === `${idx}` ? null : `${idx}`)}
                        className="text-xs text-slate-600 hover:text-slate-800"
                      >
                        {showDetails === `${idx}` ? 'Hide' : 'Show'} Details
                      </button>
                    </div>
                    
                    {showDetails === `${idx}` && (
                      <div className="mt-3 pt-3 border-t border-slate-200 space-y-2">
                        <div>
                          <p className="text-xs font-semibold text-slate-700 mb-1">Matched Sections:</p>
                          <div className="flex flex-wrap gap-2">
                            {result.matchedSections.map((section, sIdx) => (
                              <span key={sIdx} className="px-2 py-1 rounded bg-white text-xs text-slate-700">
                                {section}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <p className="text-slate-600">Current Paper</p>
                            <p className="text-slate-800">{currentPaper?.courseCode} - {currentPaper?.semester} {currentPaper?.year}</p>
                          </div>
                          <div>
                            <p className="text-slate-600">Historical Paper</p>
                            <p className="text-slate-800">{historicalPaper?.courseCode} - {historicalPaper?.semester} {historicalPaper?.year}</p>
                          </div>
                        </div>
                        {result.similarityScore >= 70 && (
                          <div className="mt-2 p-2 rounded bg-amber-500/10 border border-amber-500/30">
                            <p className="text-xs text-amber-300">
                              ⚠️ High similarity detected. Review recommended before approval.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!isScanning && similarityResults.length === 0 && selectedCourse && (
          <div className="rounded-xl border border-slate-200 bg-white p-5 text-center">
            <p className="text-sm text-slate-600">
              Click "Run AI Similarity Scan" to compare submitted papers with historical papers.
            </p>
          </div>
        )}

        {isScanning && (
          <div className="rounded-xl border border-slate-200 bg-white p-5 text-center">
            <div className="flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              <p className="text-sm text-slate-600">AI is analyzing papers for similarities...</p>
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

interface LecturerDashboardPanelProps {
  user: User;
  deadlinesActive: boolean;
  repositoriesActive: boolean;
  workflowStage: WorkflowStage;
  isPureLecturer: boolean;
}

function LecturerDashboardPanel({
  user,
  deadlinesActive,
  repositoriesActive,
  workflowStage,
  isPureLecturer,
}: LecturerDashboardPanelProps) {
  const guidance: string[] = [];

  if (user.roles.includes('Team Lead')) {
    guidance.push(
      'Collect sets from branch setters, integrate them, and push compiled drafts forward.'
    );
  }
  if (user.roles.includes('Vetter')) {
    guidance.push(
      'Join safe-browser vetting sessions, annotate collaboratively, and return sanitized comments.'
    );
  }
  if (user.roles.includes('Setter')) {
    guidance.push(
      'Prepare exam drafts and submit within the timed deadline window.'
    );
  }
  if (user.roles.includes('Chief Examiner')) {
    guidance.push(
      'Activate semester controls, mask moderator footprints, and issue final approvals.'
    );
  }
  if (guidance.length === 0) {
    guidance.push(
      isPureLecturer
        ? 'Align lesson objectives with the departmental syllabus, update the LMS, and share weekly feedback with students.'
        : 'Coordinate with the Chief Examiner to confirm upcoming moderation checkpoints.'
    );
  }

  return (
    <SectionCard
      title={isPureLecturer ? 'Faculty Teaching Dashboard' : 'Lecturer & Role-Specific Dashboard'}
      kicker={isPureLecturer ? 'Classroom Toolkit' : 'Individual Sign-In'}
      description={
        isPureLecturer
          ? 'Manage classes, resources, and student engagement from a single hub.'
          : 'Lecturers authenticate with their personal credentials to access tasks aligned to their elevated roles.'
      }
    >
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-800">Your Roles</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {user.roles.map((role) => (
            <RoleBadge key={`landing-${role}`} role={role} />
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              {isPureLecturer ? 'Current Academic Week' : 'Current Workflow Stage'}
            </p>
            <p className="mt-1 text-lg font-semibold text-blue-700">
              {isPureLecturer ? 'Week 7 — Deep Learning Modules' : workflowStage.replace(/-/g, ' ')}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              {isPureLecturer ? 'Teaching Resources' : 'Semester Status'}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {isPureLecturer ? (
                <>
                  <StatusPill
                    label="Course Materials Published"
                    active={repositoriesActive}
                    tone="blue"
                  />
                  <StatusPill
                    label="Assessment Planning"
                    active={deadlinesActive}
                    tone="blue"
                  />
                </>
              ) : (
                <>
                  <StatusPill
                    label="Deadlines Active"
                    active={deadlinesActive}
                    tone="blue"
                  />
                  <StatusPill
                    label="Repositories Open"
                    active={repositoriesActive}
                    tone="blue"
                  />
                </>
              )}
            </div>
          </div>
        </div>
        <div className="mt-5 space-y-2 text-sm text-slate-700">
          {guidance.map((item, index) => (
            <p key={item}>
              <span className="font-semibold text-blue-700">
                Step {index + 1}:
              </span>{' '}
              {item}
            </p>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}

interface ChiefExaminerDashboardPanelProps {
  workflow: WorkflowState;
  submittedPapers: SubmittedPaper[];
  setterSubmissions: SetterSubmission[];
  annotations: Annotation[];
}

function ChiefExaminerDashboardPanel({
  workflow,
  submittedPapers,
  setterSubmissions,
  annotations,
}: ChiefExaminerDashboardPanelProps) {
  const paperStatusData = useMemo(() => {
    const statusCounts: Record<SubmittedPaper['status'], number> = {
      'submitted': 0,
      'in-vetting': 0,
      'vetted': 0,
      'approved': 0,
    };

    submittedPapers.forEach((paper) => {
      statusCounts[paper.status] += 1;
    });

    return Object.entries(statusCounts).map(([name, value]) => ({
      name,
      value,
    }));
  }, [submittedPapers]);

  const timelineData = useMemo(
    () =>
      workflow.timeline.map((event, index) => ({
        step: index + 1,
        label: event.stage,
        stageIndex: index + 1,
      })),
    [workflow.timeline]
  );

  const totalSubmissions = setterSubmissions.length;
  const totalAnnotations = annotations.length;

  const pieColours = ['#6366f1', '#22c55e', '#eab308', '#f97316'];
  const lastEvent = workflow.timeline[workflow.timeline.length - 1];

  const nextSuggestedStep = (() => {
    switch (workflow.stage) {
      case 'Awaiting Setter':
        return 'Nudge the setter to upload the draft paper into the workflow.';
      case 'Submitted to Team Lead':
        return 'Ask the Team Lead to compile drafts and forward them for vetting.';
      case 'Compiled for Vetting':
        return 'Schedule or launch a vetting session with your moderation team.';
      case 'Vetting in Progress':
        return 'Monitor vetting annotations and prepare guidance for revisions.';
      case 'Revision Complete':
        return 'Review the revised paper and move it to final approval.';
      case 'Approved':
        return 'Trigger secure printing and confirm destruction rules for draft versions.';
      default:
        return 'Review the latest timeline event and confirm the next checkpoint.';
    }
  })();

  return (
    <SectionCard
      title="Chief Examiner Dashboard"
      kicker="Exam Processes & Overview"
      description="AI-styled cockpit showing how papers move through setting, vetting, approval and secure print preparation."
    >
      <div className="space-y-5">
        {/* AI status strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50 via-sky-50 to-cyan-50 px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-slate-700">
            <span className="relative inline-flex h-2.5 w-2.5 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="font-semibold uppercase tracking-[0.25em] text-indigo-600">
              AI Insights Online
            </span>
          </div>
          {lastEvent && (
            <p className="text-xs text-slate-600">
              Latest event:{' '}
              <span className="font-medium text-slate-800">{lastEvent.message}</span>
            </p>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Workflow pulse */}
          <div className="space-y-4 rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 via-sky-50 to-indigo-50 p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-600">
              Workflow Pulse
            </p>
            <p className="text-sm text-slate-700">
              Current stage:{' '}
              <span className="font-semibold text-indigo-700">
                {workflow.stage}
              </span>
            </p>
            <div className="grid grid-cols-2 gap-3 pt-2 text-xs text-slate-700">
              <div className="rounded-xl bg-white/80 p-3 shadow-sm">
                <p className="text-[0.65rem] uppercase tracking-wide text-slate-500">
                  Setter submissions
                </p>
                <p className="mt-1 text-lg font-semibold text-indigo-700">
                  {totalSubmissions}
                </p>
              </div>
              <div className="rounded-xl bg-white/80 p-3 shadow-sm">
                <p className="text-[0.65rem] uppercase tracking-wide text-slate-500">
                  Vetting notes
                </p>
                <p className="mt-1 text-lg font-semibold text-emerald-600">
                  {totalAnnotations}
                </p>
              </div>
            </div>
          </div>

          {/* Spinning pie chart */}
          <div className="relative col-span-1 rounded-2xl border border-blue-100 bg-white/90 p-4 shadow-sm">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-indigo-300/10 via-sky-300/10 to-cyan-300/10" />
            <div className="relative flex items-center justify-between pb-2">
              <div>
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-indigo-500">
                  Paper Pipeline
                </p>
                <p className="text-xs text-slate-500">
                  Spinning distribution by workflow status
                </p>
              </div>
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
            </div>
            <div className="relative h-44">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    dataKey="value"
                    data={paperStatusData}
                    innerRadius={40}
                    outerRadius={70}
                    paddingAngle={4}
                    isAnimationActive
                  >
                    {paperStatusData.map((entry, index) => (
                      <Cell key={entry.name} fill={pieColours[index % pieColours.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {/* Legend for statuses */}
            <div className="relative mt-3 grid grid-cols-2 gap-2 text-[0.7rem] text-slate-600">
              {paperStatusData.map((entry, index) => (
                <div key={entry.name} className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: pieColours[index % pieColours.length] }}
                  />
                  <span className="capitalize">{entry.name}</span>
                  <span className="ml-auto font-semibold text-slate-800">
                    {entry.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Line chart */}
          <div className="col-span-1 rounded-2xl border border-indigo-100 bg-white/90 p-4 shadow-sm">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-indigo-500">
              Journey Line
            </p>
            <p className="text-xs text-slate-500">
              Line graph of how the paper has progressed across stages.
            </p>
            <div className="mt-3 h-44">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timelineData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="step" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="stageIndex"
                    stroke="#6366f1"
                    strokeWidth={2}
                    dot={{ r: 3, strokeWidth: 1, stroke: '#312e81', fill: '#818cf8' }}
                    isAnimationActive
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Extra AI guidance row */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2 rounded-2xl border border-slate-100 bg-white/95 p-4 shadow-sm">
            <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-slate-500">
              Recommended Next Action
            </p>
            <p className="mt-2 text-sm text-slate-700">{nextSuggestedStep}</p>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-gradient-to-br from-indigo-500/10 via-sky-500/10 to-cyan-500/10 p-4 text-xs text-slate-700">
            <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-indigo-600">
              Snapshot
            </p>
            <ul className="mt-2 space-y-1">
              <li>
                <span className="font-semibold text-slate-800">
                  {workflow.timeline.length}
                </span>{' '}
                timeline checkpoints
              </li>
              <li>
                <span className="font-semibold text-slate-800">
                  {submittedPapers.length}
                </span>{' '}
                papers in this cycle
              </li>
              <li>
                <span className="font-semibold text-slate-800">
                  {paperStatusData.find((p) => p.name === 'approved')?.value ?? 0}
                </span>{' '}
                approved &amp; ready for print
              </li>
            </ul>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

interface PaperTrackingPanelProps {
  workflow: WorkflowState;
  submittedPapers: SubmittedPaper[];
}

function PaperTrackingPanel({
  workflow,
  submittedPapers,
}: PaperTrackingPanelProps) {
  const stages: Array<{ id: WorkflowStage | 'Printing'; label: string }> = [
    { id: 'Awaiting Setter', label: 'Paper is being set' },
    { id: 'Submitted to Team Lead', label: 'Team Lead collecting drafts' },
    { id: 'Compiled for Vetting', label: 'Compiled for moderation' },
    { id: 'Vetting in Progress', label: 'Vetting & annotations' },
    { id: 'Revision Complete', label: 'Revised & sanitized' },
    { id: 'Approved', label: 'Approved by Chief Examiner' },
    { id: 'Printing', label: 'Released for secure printing' },
  ];

  const currentIndex = stages.findIndex((s) => s.id === workflow.stage);
  const effectiveIndex =
    currentIndex === -1 && workflow.stage === 'Vetted & Returned to Chief Examiner'
      ? 4
      : currentIndex;

  const totalApproved = submittedPapers.filter(
    (p) => p.status === 'approved'
  ).length;

  return (
    <SectionCard
      title="Track Paper Journey"
      kicker="From Setting to Printing"
      description="Visual trace of where the current semester paper is in the moderation pipeline."
    >
      <div className="space-y-6">
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 via-indigo-50 to-sky-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-600">
            Current Position
          </p>
          <p className="mt-1 text-sm text-slate-700">
            The paper is currently in{' '}
            <span className="font-semibold text-indigo-700">{workflow.stage}</span>
          </p>
        </div>

        <div className="relative">
          <div className="absolute inset-x-4 top-5 h-0.5 bg-gradient-to-r from-blue-200 via-indigo-300 to-sky-300" />
          <div className="relative flex justify-between gap-2 px-2">
            {stages.map((stage, index) => {
              const isCompleted = effectiveIndex > index;
              const isActive = effectiveIndex === index;
              return (
                <div key={stage.id} className="flex flex-col items-center text-center">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full border-2 text-xs font-semibold transition-all ${
                      isActive
                        ? 'border-indigo-500 bg-indigo-500 text-white shadow-[0_0_18px_rgba(79,70,229,0.6)]'
                        : isCompleted
                        ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 bg-white text-slate-500'
                    }`}
                  >
                    {index + 1}
                  </div>
                  <p className="mt-2 text-[0.7rem] font-medium text-slate-700">
                    {stage.id}
                  </p>
                  <p className="mt-1 text-[0.65rem] text-slate-500">{stage.label}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-100 bg-white p-4">
            <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-slate-500">
              Approved and Ready
            </p>
            <p className="mt-1 text-2xl font-bold text-indigo-600">{totalApproved}</p>
            <p className="mt-1 text-xs text-slate-500">
              papers marked as ready for secure printing.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-white p-4">
            <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-slate-500">
              Timeline Events
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-800">
              {workflow.timeline.length}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              recorded checkpoints for this paper&apos;s journey.
            </p>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

function LecturerMyClassesPanel() {
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  
  const classes = [
    { id: '1', code: 'CSC 302', name: 'Advanced Algorithms', schedule: 'Mon • 10:00 — 12:00 • Lab 4', students: 45 },
    { id: '2', code: 'CSC 301', name: 'Data Structures', schedule: 'Wed • 14:00 — 16:00 • Lab 2', students: 38 },
    { id: '3', code: 'CSC 303', name: 'Database Systems', schedule: 'Fri • 09:00 — 11:00 • Lab 1', students: 42 },
  ];

  const selectedClassData = classes.find(c => c.id === selectedClass);

  return (
    <SectionCard
      title="My Classes"
      kicker="Teaching Schedule"
      description="Overview of courses assigned to you this semester."
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-3">
          {classes.map((classItem) => (
            <button
              key={classItem.id}
              type="button"
              onClick={() => setSelectedClass(classItem.id)}
              className={`w-full rounded-xl border p-4 text-left transition ${
                selectedClass === classItem.id
                  ? 'border-blue-500/50 bg-blue-500/10'
                  : 'border-slate-200 bg-white hover:border-blue-500/40 hover:bg-blue-50'
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold text-blue-700">{classItem.code}</p>
                  <p className="mt-1 text-sm text-slate-700">{classItem.name}</p>
                  <p className="mt-2 text-xs text-slate-500">{classItem.schedule}</p>
                </div>
                <span className="text-xs text-slate-500">{classItem.students} students</span>
              </div>
            </button>
          ))}
        </div>
        <div className="space-y-3">
          {selectedClassData ? (
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
              <p className="text-xs uppercase tracking-wide text-slate-500">Class Details</p>
          <p className="mt-2 text-base font-semibold text-blue-700">
                {selectedClassData.code} — {selectedClassData.name}
              </p>
              <p className="mt-2 text-xs text-slate-600">{selectedClassData.schedule}</p>
              <p className="mt-3 text-xs text-slate-500">Total Enrollment: {selectedClassData.students}</p>
              <button
                type="button"
                className="mt-4 w-full rounded-lg bg-blue-500/20 px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-500/30"
              >
                View Class Roster
              </button>
        </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
              <p className="text-xs uppercase tracking-wide text-slate-500">Upcoming Session</p>
              <p className="mt-2 text-base font-semibold text-blue-700">
                {classes[0].code} — {classes[0].name}
              </p>
              <p className="mt-1 text-xs text-slate-500">{classes[0].schedule}</p>
            </div>
          )}
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
            <p className="text-xs uppercase tracking-wide text-slate-500">Preparation Notes</p>
            <p className="mt-2 text-xs">
            Upload revised lecture slides and share reading list with students 48 hours before class.
          </p>
            <button
              type="button"
              className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
            >
              Upload Materials
            </button>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

function LecturerSchedulingPanel() {
  const [scheduleType, setScheduleType] = useState<'classes' | 'office-hours' | 'deadlines'>('classes');
  const [newEvent, setNewEvent] = useState({ title: '', date: '', time: '', location: '' });

  const handleAddEvent = (e: FormEvent) => {
    e.preventDefault();
    if (newEvent.title && newEvent.date) {
      alert(`Event "${newEvent.title}" scheduled for ${newEvent.date} ${newEvent.time || ''} ${newEvent.location ? `at ${newEvent.location}` : ''}`);
      setNewEvent({ title: '', date: '', time: '', location: '' });
    }
  };

  const events = {
    classes: [
      { title: 'CSC 302 - Advanced Algorithms', date: '2024-01-15', time: '10:00 - 12:00', location: 'Lab 4' },
      { title: 'CSC 301 - Data Structures', date: '2024-01-17', time: '14:00 - 16:00', location: 'Lab 2' },
    ],
    'office-hours': [
      { title: 'Office Hours', date: '2024-01-16', time: '13:00 - 15:00', location: 'Office 205' },
    ],
    deadlines: [
      { title: 'Assignment 1 Due', date: '2024-01-20', time: '23:59', location: 'Online' },
    ],
  };

  return (
    <SectionCard
      title="Scheduling"
      kicker="Lesson Planning"
      description="Coordinate teaching times, office hours, and assessment deadlines."
    >
      <div className="space-y-4">
        <div className="flex gap-2 border-b border-slate-200">
          {(['classes', 'office-hours', 'deadlines'] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setScheduleType(type)}
              className={`px-4 py-2 text-sm font-medium transition ${
                scheduleType === type
                  ? 'border-b-2 border-blue-500 text-blue-700'
                  : 'text-slate-600 hover:text-slate-700'
              }`}
            >
              {type === 'classes' ? 'Classes' : type === 'office-hours' ? 'Office Hours' : 'Deadlines'}
            </button>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-800">Scheduled Events</h3>
            {events[scheduleType].map((event, idx) => (
              <div key={idx} className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
                <p className="font-semibold text-blue-700">{event.title}</p>
                <p className="mt-1 text-xs text-slate-600">{event.date} • {event.time}</p>
                <p className="mt-1 text-xs text-slate-500">{event.location}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">Add New Event</h3>
            <form onSubmit={handleAddEvent} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-600 mb-1">Title</label>
                <input
                  type="text"
                  value={newEvent.title}
                  onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
                  placeholder="Event title"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-600 mb-1">Date</label>
                  <input
                    type="date"
                    value={newEvent.date}
                    onChange={(e) => setNewEvent({ ...newEvent, date: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-600 mb-1">Time</label>
                  <input
                    type="time"
                    value={newEvent.time}
                    onChange={(e) => setNewEvent({ ...newEvent, time: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Location</label>
                <input
                  type="text"
                  value={newEvent.location}
                  onChange={(e) => setNewEvent({ ...newEvent, location: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
                  placeholder="Location"
                />
              </div>
              <button
                type="submit"
                className="w-full rounded-lg bg-blue-500/20 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-500/30"
              >
                Schedule Event
              </button>
            </form>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

function LecturerEnterMarksPanel() {
  const [selectedClass, setSelectedClass] = useState<string>('csc302');
  const [assessmentType, setAssessmentType] = useState<string>('assignment');
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const students = [
    { id: '1', name: 'John Doe', accessNumber: 'a001' },
    { id: '2', name: 'Jane Smith', accessNumber: 'a002' },
    { id: '3', name: 'Bob Johnson', accessNumber: 'a003' },
    { id: '4', name: 'Alice Williams', accessNumber: 'a004' },
  ];

  const classes = [
    { id: 'csc302', name: 'CSC 302 - Advanced Algorithms' },
    { id: 'csc301', name: 'CSC 301 - Data Structures' },
    { id: 'csc303', name: 'CSC 303 - Database Systems' },
  ];

  const handleMarkChange = (studentId: string, value: string) => {
    setMarks({ ...marks, [studentId]: value });
    setSubmitted(false);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const allMarksEntered = students.every(s => marks[s.id] && marks[s.id] !== '');
    if (allMarksEntered) {
      setSubmitted(true);
      alert('Marks submitted successfully!');
    } else {
      alert('Please enter marks for all students.');
    }
  };

  return (
    <SectionCard
      title="Enter Marks"
      kicker="Assessment Centre"
      description="Record continuous assessment tests, assignments, and final exam marks."
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs text-slate-600 mb-2">Select Class</label>
            <select
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
            >
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>{cls.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-2">Assessment Type</label>
            <select
              value={assessmentType}
              onChange={(e) => setAssessmentType(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
            >
              <option value="assignment">Assignment</option>
              <option value="test">Test</option>
              <option value="exam">Final Exam</option>
              <option value="project">Project</option>
            </select>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="grid grid-cols-12 gap-4 p-4 text-xs font-semibold text-slate-600 border-b border-slate-200">
              <div className="col-span-5">Student Name</div>
              <div className="col-span-3">Access Number</div>
              <div className="col-span-4">Marks (0-100)</div>
            </div>
            {students.map((student) => (
              <div key={student.id} className="grid grid-cols-12 gap-4 p-4 border-b border-slate-200 last:border-0">
                <div className="col-span-5 text-sm text-slate-700">{student.name}</div>
                <div className="col-span-3 text-sm text-slate-600">{student.accessNumber}</div>
                <div className="col-span-4">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={marks[student.id] || ''}
                    onChange={(e) => handleMarkChange(student.id, e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
                    placeholder="0-100"
                    required
                  />
                </div>
              </div>
            ))}
          </div>

          {submitted && (
            <div className="rounded-lg border border-blue-500/50 bg-blue-500/10 p-3 text-sm text-blue-700">
              Marks submitted successfully! Grade distribution and moderation flags will appear after review.
            </div>
          )}

          <button
            type="submit"
            className="w-full rounded-lg bg-blue-500/20 px-4 py-3 text-sm font-semibold text-blue-700 transition hover:bg-blue-500/30"
          >
            Submit Marks
          </button>
        </form>
      </div>
    </SectionCard>
  );
}

function LecturerSearchStudentPanel() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState<'name' | 'regNo'>('regNo');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<any | null>(null);

  const allStudents = [
    { id: '1', name: 'John Doe', accessNumber: 'a001', email: 'john.doe@student.ucu.ac.ug', phone: '+256 700 000001', courses: ['CSC 302', 'CSC 301'], gpa: 3.8 },
    { id: '2', name: 'Jane Smith', accessNumber: 'a002', email: 'jane.smith@student.ucu.ac.ug', phone: '+256 700 000002', courses: ['CSC 302', 'CSC 303'], gpa: 3.9 },
    { id: '3', name: 'Bob Johnson', accessNumber: 'a003', email: 'bob.johnson@student.ucu.ac.ug', phone: '+256 700 000003', courses: ['CSC 301'], gpa: 3.5 },
    { id: '4', name: 'Alice Williams', accessNumber: 'a004', email: 'alice.williams@student.ucu.ac.ug', phone: '+256 700 000004', courses: ['CSC 302', 'CSC 301', 'CSC 303'], gpa: 4.0 },
  ];

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const query = searchQuery.toLowerCase().trim();
    const results = allStudents.filter(student => {
      if (searchType === 'name') {
        return student.name.toLowerCase().includes(query);
      } else {
        return student.accessNumber.toLowerCase().includes(query);
      }
    });
    setSearchResults(results);
    if (results.length === 1) {
      setSelectedStudent(results[0]);
    } else {
      setSelectedStudent(null);
    }
  };

  return (
    <SectionCard
      title="Search Student"
      kicker="Student Records"
      description="Lookup student profiles, enrollment status, and prior performance."
    >
      <div className="space-y-4">
        <form onSubmit={handleSearch} className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
                placeholder={searchType === 'name' ? 'Enter student name...' : 'Enter registration number...'}
              />
            </div>
            <select
              value={searchType}
              onChange={(e) => setSearchType(e.target.value as 'name' | 'regNo')}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
            >
              <option value="regNo">Registration Number</option>
              <option value="name">Name</option>
            </select>
            <button
              type="submit"
              className="rounded-lg bg-blue-500/20 px-6 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-500/30"
            >
              Search
            </button>
          </div>
        </form>

        {searchResults.length > 0 && !selectedStudent && (
          <div className="space-y-2">
            <p className="text-xs text-slate-600">Found {searchResults.length} result(s)</p>
            {searchResults.map((student) => (
              <button
                key={student.id}
                type="button"
                onClick={() => setSelectedStudent(student)}
                className="w-full rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-blue-500/40 hover:bg-blue-50"
              >
                <p className="text-sm font-semibold text-blue-700">{student.name}</p>
                <p className="mt-1 text-xs text-slate-600">Access: {student.accessNumber}</p>
              </button>
            ))}
          </div>
        )}

        {selectedStudent && (
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-blue-700">{selectedStudent.name}</h3>
                <p className="mt-1 text-sm text-slate-600">Access Number: {selectedStudent.accessNumber}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedStudent(null);
                  setSearchResults([]);
                }}
                className="text-slate-500 hover:text-slate-700"
              >
                ×
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Contact Information</p>
                <p className="mt-2 text-sm text-slate-700">{selectedStudent.email}</p>
                <p className="mt-1 text-sm text-slate-700">{selectedStudent.phone}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Academic Performance</p>
                <p className="mt-2 text-sm font-semibold text-blue-700">GPA: {selectedStudent.gpa}</p>
              </div>
            </div>

            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">Enrolled Courses</p>
              <div className="flex flex-wrap gap-2">
                {selectedStudent.courses.map((course: string) => (
                  <span key={course} className="rounded-lg bg-slate-100 px-3 py-1 text-xs text-slate-700">
                    {course}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {searchQuery && searchResults.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-5 text-center text-sm text-slate-600">
            No students found matching your search.
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function LecturerMonthlyReportPanel() {
  const [reportType, setReportType] = useState<'attendance' | 'grading' | 'curriculum'>('attendance');
  const [month, setMonth] = useState<string>(new Date().toISOString().slice(0, 7));
  const [generated, setGenerated] = useState(false);

  const handleGenerateReport = () => {
    setGenerated(true);
    setTimeout(() => {
      alert(`Report generated successfully for ${new Date(month + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`);
    }, 500);
  };

  const handleDownload = () => {
    alert('Downloading report...');
  };

  const reportData = {
    attendance: {
      title: 'Attendance Summary',
      stats: [
        { label: 'Total Sessions', value: '24' },
        { label: 'Average Attendance', value: '87%' },
        { label: 'Students Present', value: '42/48' },
      ],
    },
    grading: {
      title: 'Grading Progress',
      stats: [
        { label: 'Assignments Graded', value: '3/4' },
        { label: 'Tests Completed', value: '2/2' },
        { label: 'Pending Reviews', value: '1' },
      ],
    },
    curriculum: {
      title: 'Curriculum Coverage',
      stats: [
        { label: 'Topics Covered', value: '18/20' },
        { label: 'Completion Rate', value: '90%' },
        { label: 'Remaining Weeks', value: '2' },
      ],
    },
  };

  return (
    <SectionCard
      title="Monthly Reports"
      kicker="Analytics"
      description="Generate summaries of attendance, grading progress, and curriculum coverage."
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs text-slate-600 mb-2">Report Type</label>
            <select
              value={reportType}
              onChange={(e) => {
                setReportType(e.target.value as 'attendance' | 'grading' | 'curriculum');
                setGenerated(false);
              }}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
            >
              <option value="attendance">Attendance Summary</option>
              <option value="grading">Grading Progress</option>
              <option value="curriculum">Curriculum Coverage</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-2">Month</label>
            <input
              type="month"
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                setGenerated(false);
              }}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-4">{reportData[reportType].title}</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            {reportData[reportType].stats.map((stat, idx) => (
              <div key={idx} className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">{stat.label}</p>
                <p className="mt-2 text-2xl font-semibold text-blue-700">{stat.value}</p>
              </div>
            ))}
          </div>
        </div>

        {generated && (
          <div className="rounded-lg border border-blue-500/50 bg-blue-500/10 p-4">
            <p className="text-sm text-blue-700 mb-3">
              Report generated for {new Date(month + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleDownload}
                className="rounded-lg bg-blue-500/20 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-500/30"
              >
                Download PDF
              </button>
              <button
                type="button"
                onClick={handleDownload}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                Export Excel
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={handleGenerateReport}
          className="w-full rounded-lg bg-blue-500/20 px-4 py-3 text-sm font-semibold text-blue-700 transition hover:bg-blue-500/30"
        >
          Generate Report
        </button>
      </div>
    </SectionCard>
  );
}

function LecturerAccountSettingsPanel() {
  const [activeTab, setActiveTab] = useState<'password' | 'profile' | 'notifications'>('password');
  const [passwordForm, setPasswordForm] = useState({ current: '', new: '', confirm: '' });
  const [profileForm, setProfileForm] = useState({ email: 'lecturer@ucu.ac.ug', phone: '+256 700 000000' });
  const [notifications, setNotifications] = useState({
    email: true,
    sms: false,
    deadlineReminders: true,
    gradeUpdates: true,
  });
  const [saved, setSaved] = useState(false);

  const handlePasswordChange = (e: FormEvent) => {
    e.preventDefault();
    if (passwordForm.new !== passwordForm.confirm) {
      alert('New passwords do not match!');
      return;
    }
    if (passwordForm.new.length < 6) {
      alert('Password must be at least 6 characters long!');
      return;
    }
    alert('Password changed successfully!');
    setPasswordForm({ current: '', new: '', confirm: '' });
  };

  const handleProfileSave = (e: FormEvent) => {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    alert('Profile updated successfully!');
  };

  const handleNotificationToggle = (key: keyof typeof notifications) => {
    setNotifications({ ...notifications, [key]: !notifications[key] });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <SectionCard
      title="Account Settings"
      kicker="Profile Management"
      description="Update your credentials, notification preferences, and recovery information."
    >
      <div className="space-y-4">
        <div className="flex gap-2 border-b border-slate-200">
          {(['password', 'profile', 'notifications'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => {
                setActiveTab(tab);
                setSaved(false);
              }}
              className={`px-4 py-2 text-sm font-medium transition ${
                activeTab === tab
                  ? 'border-b-2 border-blue-500 text-blue-700'
                  : 'text-slate-600 hover:text-slate-700'
              }`}
            >
              {tab === 'password' ? 'Password' : tab === 'profile' ? 'Profile' : 'Notifications'}
            </button>
          ))}
        </div>

        {activeTab === 'password' && (
          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              <div>
                <label className="block text-xs text-slate-600 mb-2">Current Password</label>
                <input
                  type="password"
                  value={passwordForm.current}
                  onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-2">New Password</label>
                <input
                  type="password"
                  value={passwordForm.new}
                  onChange={(e) => setPasswordForm({ ...passwordForm, new: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
                  required
                  minLength={6}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-2">Confirm New Password</label>
                <input
                  type="password"
                  value={passwordForm.confirm}
                  onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
                  required
                />
              </div>
            </div>
            <button
              type="submit"
              className="w-full rounded-lg bg-blue-500/20 px-4 py-3 text-sm font-semibold text-blue-700 transition hover:bg-blue-500/30"
            >
              Change Password
            </button>
          </form>
        )}

        {activeTab === 'profile' && (
          <form onSubmit={handleProfileSave} className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              <div>
                <label className="block text-xs text-slate-600 mb-2">Email Address</label>
                <input
                  type="email"
                  value={profileForm.email}
                  onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-2">Phone Number</label>
                <input
                  type="tel"
                  value={profileForm.phone}
                  onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
                  required
                />
              </div>
            </div>
            {saved && (
              <div className="rounded-lg border border-blue-500/50 bg-blue-500/10 p-3 text-sm text-blue-700">
                Profile updated successfully!
              </div>
            )}
            <button
              type="submit"
              className="w-full rounded-lg bg-blue-500/20 px-4 py-3 text-sm font-semibold text-blue-700 transition hover:bg-blue-500/30"
            >
              Save Changes
            </button>
          </form>
        )}

        {activeTab === 'notifications' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              {Object.entries(notifications).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {key === 'email' ? 'Email Notifications' : key === 'sms' ? 'SMS Notifications' : key === 'deadlineReminders' ? 'Deadline Reminders' : 'Grade Updates'}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      {key === 'email' ? 'Receive updates via email' : key === 'sms' ? 'Receive updates via SMS' : key === 'deadlineReminders' ? 'Get notified about upcoming deadlines' : 'Get notified when grades are updated'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleNotificationToggle(key as keyof typeof notifications)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                      value ? 'bg-blue-500' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                        value ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              ))}
            </div>
            {saved && (
              <div className="rounded-lg border border-blue-500/50 bg-blue-500/10 p-3 text-sm text-blue-700">
                Notification preferences saved!
              </div>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

interface LoginPortalProps {
  admins: User[];
  lecturers: User[];
  onLogin: (userId: string, password: string) => void;
  authError: string | null;
  onClearError: () => void;
  showLecturerOnly?: boolean;
  showAdminOnly?: boolean;
}

function LoginPortal({
  admins,
  lecturers,
  onLogin,
  authError,
  onClearError,
  showLecturerOnly = false,
  showAdminOnly = false,
}: LoginPortalProps) {
  const [selectedAdmin, setSelectedAdmin] = useState(
    admins[0]?.id ?? ''
  );
  const [adminPassword, setAdminPassword] = useState(DEFAULT_PASSWORD);
  const [selectedLecturer, setSelectedLecturer] = useState(
    lecturers[0]?.id ?? ''
  );
  const [lecturerPassword, setLecturerPassword] = useState(DEFAULT_PASSWORD);

  useEffect(() => {
    if (admins.length > 0 && !admins.find((u: User) => u.id === selectedAdmin)) {
      setSelectedAdmin(admins[0].id);
    }
  }, [admins, selectedAdmin]);

  useEffect(() => {
    if (lecturers.length > 0 && !lecturers.find((u) => u.id === selectedLecturer)) {
      setSelectedLecturer(lecturers[0].id);
    }
  }, [lecturers, selectedLecturer]);

  const handleAdminSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onClearError();
    if (selectedAdmin) {
      onLogin(selectedAdmin, adminPassword);
    }
  };

  const handleLecturerSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onClearError();
    if (selectedLecturer) {
      onLogin(selectedLecturer, lecturerPassword);
    }
  };

  return (
    <div className="space-y-6">
      {authError && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-6 py-4">
          <p className="text-sm font-semibold text-rose-200">{authError}</p>
        </div>
      )}
      
      {showLecturerOnly && (
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-900/90 to-slate-950/90 p-8 shadow-xl">
          <div className="mb-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/20">
                <span className="text-2xl">🎓</span>
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Lecturer Account
                </h3>
                <p className="text-xs text-slate-600">Teaching Staff</p>
              </div>
            </div>
            <p className="text-sm text-slate-600">
              Access your personal teaching dashboard and role-specific workflows.
            </p>
          </div>
          <form onSubmit={handleLecturerSubmit} className="space-y-4">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Select Lecturer
              </label>
              <select
                value={selectedLecturer}
                onChange={(event) => {
                  setSelectedLecturer(event.target.value);
                  onClearError();
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              >
                <option value="">Choose a lecturer...</option>
                {lecturers.map((user: User) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Password
              </label>
              <input
                type="password"
                value={lecturerPassword}
                onChange={(event) => {
                  setLecturerPassword(event.target.value);
                  onClearError();
                }}
                placeholder="Enter your password"
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-600 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              />
            </div>
            <button
              type="submit"
              disabled={!selectedLecturer || !lecturerPassword.trim()}
              className="w-full rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 px-6 py-3 text-sm font-bold text-white shadow-lg transition hover:from-blue-500 hover:to-emerald-600 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:from-emerald-600 disabled:hover:to-emerald-700"
            >
              Sign In as Lecturer
            </button>
            <p className="text-center text-xs text-slate-500">
              Default password: <span className="font-mono text-slate-600">{DEFAULT_PASSWORD}</span>
            </p>
          </form>
        </div>
      )}

      {showAdminOnly && (
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-900/90 to-slate-950/90 p-8 shadow-xl">
          <div className="mb-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/20">
                <span className="text-2xl">👤</span>
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Admin Account
                </h3>
                <p className="text-xs text-slate-600">System Administrator</p>
              </div>
            </div>
            <p className="text-sm text-slate-600">
              Access administrative controls to manage staff accounts and system settings.
            </p>
          </div>
          <form onSubmit={handleAdminSubmit} className="space-y-4">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Select Admin
              </label>
              <select
                value={selectedAdmin}
                onChange={(event) => {
                  setSelectedAdmin(event.target.value);
                  onClearError();
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
              >
                <option value="">Choose an administrator...</option>
                {admins.map((user: User) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Password
              </label>
              <input
                type="password"
                value={adminPassword}
                onChange={(event) => {
                  setAdminPassword(event.target.value);
                  onClearError();
                }}
                placeholder="Enter your password"
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-600 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
              />
            </div>
            <button
              type="submit"
              disabled={!selectedAdmin || !adminPassword.trim()}
              className="w-full rounded-xl bg-gradient-to-r from-purple-600 to-purple-700 px-6 py-3 text-sm font-bold text-white shadow-lg transition hover:from-purple-500 hover:to-purple-600 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:from-purple-600 disabled:hover:to-purple-700"
            >
              Sign In as Admin
            </button>
            <p className="text-center text-xs text-slate-500">
              Default password: <span className="font-mono text-slate-600">{DEFAULT_PASSWORD}</span>
            </p>
          </form>
        </div>
      )}

      {!showLecturerOnly && !showAdminOnly && (
        <div className="grid gap-8 lg:grid-cols-2">
          {/* Admin Login Form */}
          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-900/90 to-slate-950/90 p-8 shadow-xl">
            <div className="mb-6">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/20">
                  <span className="text-2xl">👤</span>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    Admin Account
                  </h3>
                  <p className="text-xs text-slate-600">System Administrator</p>
                </div>
              </div>
              <p className="text-sm text-slate-600">
                Access administrative controls to manage staff accounts and system settings.
              </p>
            </div>
            <form onSubmit={handleAdminSubmit} className="space-y-4">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Select Admin
                </label>
                <select
                  value={selectedAdmin}
                  onChange={(event) => {
                    setSelectedAdmin(event.target.value);
                    onClearError();
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
                >
                  <option value="">Choose an administrator...</option>
                  {admins.map((user: User) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Password
                </label>
                <input
                  type="password"
                  value={adminPassword}
                  onChange={(event) => {
                    setAdminPassword(event.target.value);
                    onClearError();
                  }}
                  placeholder="Enter your password"
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-600 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
                />
              </div>
              <button
                type="submit"
                disabled={!selectedAdmin || !adminPassword.trim()}
                className="w-full rounded-xl bg-gradient-to-r from-purple-600 to-purple-700 px-6 py-3 text-sm font-bold text-white shadow-lg transition hover:from-purple-500 hover:to-purple-600 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:from-purple-600 disabled:hover:to-purple-700"
              >
                Sign In as Admin
              </button>
              <p className="text-center text-xs text-slate-500">
                Default password: <span className="font-mono text-slate-600">{DEFAULT_PASSWORD}</span>
              </p>
            </form>
          </div>

          {/* Lecturer Login Form */}
          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-900/90 to-slate-950/90 p-8 shadow-xl">
            <div className="mb-6">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/20">
                  <span className="text-2xl">🎓</span>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    Lecturer Account
                  </h3>
                  <p className="text-xs text-slate-600">Teaching Staff</p>
                </div>
              </div>
              <p className="text-sm text-slate-600">
                Access your personal teaching dashboard and role-specific workflows.
              </p>
            </div>
            <form onSubmit={handleLecturerSubmit} className="space-y-4">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Select Lecturer
                </label>
                <select
                  value={selectedLecturer}
                  onChange={(event) => {
                    setSelectedLecturer(event.target.value);
                    onClearError();
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                >
                  <option value="">Choose a lecturer...</option>
                  {lecturers.map((user: User) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Password
                </label>
                <input
                  type="password"
                  value={lecturerPassword}
                  onChange={(event) => {
                    setLecturerPassword(event.target.value);
                    onClearError();
                  }}
                  placeholder="Enter your password"
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-600 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </div>
              <button
                type="submit"
                disabled={!selectedLecturer || !lecturerPassword.trim()}
                className="w-full rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 px-6 py-3 text-sm font-bold text-white shadow-lg transition hover:from-blue-500 hover:to-emerald-600 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:from-emerald-600 disabled:hover:to-emerald-700"
              >
                Sign In as Lecturer
              </button>
              <p className="text-center text-xs text-slate-500">
                Default password: <span className="font-mono text-slate-600">{DEFAULT_PASSWORD}</span>
              </p>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

interface WorkflowOrchestrationProps {
  workflow: WorkflowState;
  annotations: Annotation[];
  versionHistory: VersionHistoryEntry[];
  currentUser: User | undefined;
  userHasRole: (role: Role) => boolean;
  onSetterSubmit: () => void;
  onTeamLeadCompile: () => void;
  onSanitizeAndForward: () => void;
  onRevisionIntegrated: () => void;
  onOpenApprovalPortal: () => void;
  onApprove: (notes: string) => void;
  onReject: (notes: string) => void;
  onRestartWorkflow: () => void;
  sectionId?: string;
}

function WorkflowOrchestration({
  workflow,
  annotations,
  versionHistory,
  currentUser,
  userHasRole,
  onSetterSubmit,
  onTeamLeadCompile,
  onSanitizeAndForward,
  onRevisionIntegrated,
  onOpenApprovalPortal,
  onApprove,
  onReject,
  onRestartWorkflow,
  sectionId,
}: WorkflowOrchestrationProps) {
  const [approvalNotes, setApprovalNotes] = useState('');

  const canSetterSubmit =
    userHasRole('Setter') && workflow.stage === 'Awaiting Setter';
  const canTeamLeadCompile =
    userHasRole('Team Lead') && workflow.stage === 'Submitted to Team Lead';
  const canSanitize =
    userHasRole('Chief Examiner') &&
    workflow.stage === 'Vetted & Returned to Chief Examiner';
  const canConfirmRevision =
    userHasRole('Team Lead') && workflow.stage === 'Sanitized for Revision';
  const canOpenApprovalPortal =
    userHasRole('Chief Examiner') && workflow.stage === 'Revision Complete';
  const canDrawDecision =
    userHasRole('Chief Examiner') && workflow.stage === 'Awaiting Approval';
  const canRestart =
    (userHasRole('Chief Examiner') || userHasRole('Admin')) &&
    workflow.awaitingRecycle;

  const lastDecision = workflow.lastDecision;

  return (
    <SectionCard
      id={sectionId}
      title="Secure Workflow Execution"
      kicker="Moderation Lifecycle"
      description="Move papers from setting through compilation, vetting, revision, and final approval with auditable timeline entries."
    >
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <ActionButton
              disabled={!canSetterSubmit}
              label="Submit Paper Draft"
              description="Setter sends paper to Team Lead with auto copy to Chief Examiner."
              onClick={onSetterSubmit}
              tone="blue"
            />
            <ActionButton
              disabled={!canTeamLeadCompile}
              label="Compile & Forward"
              description="Team Lead merges submissions and pushes to vetters."
              onClick={onTeamLeadCompile}
              tone="blue"
            />
            <ActionButton
              disabled={!canSanitize}
              label="Sanitize & Forward"
              description="Chief Examiner removes footprints and sends for revision."
              onClick={onSanitizeAndForward}
              tone="blue"
            />
            <ActionButton
              disabled={!canConfirmRevision}
              label="Confirm Revisions Integrated"
              description="Team Lead confirms revisions and notifies Chief Examiner."
              onClick={onRevisionIntegrated}
              tone="blue"
            />
            <ActionButton
              disabled={!canOpenApprovalPortal}
              label="Open Approval Portal"
              description="Chief Examiner reviews final packet before decision."
              onClick={onOpenApprovalPortal}
              tone="blue"
            />
            <ActionButton
              disabled={!canRestart}
              label="Request New Setter & Restart"
              description="Restart workflow after rejection and trigger recycling."
              onClick={onRestartWorkflow}
              tone="amber"
            />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-800">
              Final Approval Portal
            </h3>
            <p className="mt-2 text-xs text-slate-500">
              Chief Examiner reviews secure version history, confirms comments
              were addressed, and issues a final verdict.
            </p>
            <textarea
              value={approvalNotes}
              onChange={(event) => setApprovalNotes(event.target.value)}
              placeholder="Decision notes (optional)"
              className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:opacity-60"
              disabled={!canDrawDecision}
            />
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={!canDrawDecision}
                onClick={() => {
                  onApprove(approvalNotes);
                  setApprovalNotes('');
                }}
                className="rounded-xl bg-blue-500/90 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:bg-blue-500/40 disabled:text-emerald-900"
              >
                Approve for Printing
              </button>
              <button
                type="button"
                disabled={!canDrawDecision}
                onClick={() => {
                  onReject(approvalNotes);
                  setApprovalNotes('');
                }}
                className="rounded-xl bg-rose-500/90 px-4 py-2 text-sm font-semibold text-rose-950 transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:bg-rose-500/40 disabled:text-rose-900"
              >
                Reject & Trigger Recycling
              </button>
            </div>
            {lastDecision ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <p className="font-semibold uppercase tracking-wide text-slate-700">
                  Last Decision — {lastDecision.type}
                </p>
                <p className="mt-1">
                  {lastDecision.actor}{' '}
                  <span className="text-slate-500">
                    ({formatTimestamp(lastDecision.timestamp)})
                  </span>
                </p>
                {lastDecision.notes ? (
                  <p className="mt-1 text-slate-700">
                    “{lastDecision.notes}”
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-800">
              Version History Ledger
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Immutable record of every version shared across stakeholders.
            </p>
            <ul className="mt-3 space-y-3">
              {versionHistory.map((entry) => (
                <li
                  key={entry.id}
                  className="rounded-xl border border-slate-200 bg-white p-3"
                >
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span className="font-semibold text-blue-700">
                      {entry.versionLabel}
                    </span>
                    <span>{formatTimestamp(entry.timestamp)}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-900">{entry.notes}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Owner: {entry.actor}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-800">
              Annotation Snapshot
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              {annotations.length > 0
                ? `${annotations.length} inline comments recorded.`
                : 'No annotations captured yet.'}
            </p>
            <ul className="mt-3 space-y-3">
              {annotations.slice(0, 4).map((annotation) => (
                <li
                  key={annotation.id}
                  className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700"
                >
                  <p className="text-sm text-slate-900">
                    “{annotation.comment}”
                  </p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="font-semibold text-blue-700">
                      {annotation.author}
                    </span>
                    <span className="text-slate-500">
                      {formatTimestamp(annotation.timestamp)}
                    </span>
                  </div>
                </li>
              ))}
              {annotations.length > 4 ? (
                <li className="text-xs text-slate-500">
                  +{annotations.length - 4} more annotations stored securely
                </li>
              ) : null}
            </ul>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-800">Timeline Audit</h3>
        <p className="mt-1 text-xs text-slate-500">
          Full audit trail of how the paper progressed across the moderation
          lifecycle.
        </p>
        <ul className="mt-4 space-y-4">
          {workflow.timeline.map((event) => (
            <li
              key={event.id}
              className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-800 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-semibold text-blue-700">{event.actor}</p>
                <p className="text-slate-700">{event.message}</p>
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  {event.stage}
                </p>
              </div>
              <span className="text-xs text-slate-500">
                {formatTimestamp(event.timestamp)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </SectionCard>
  );
}

interface ActionButtonProps {
  label: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'blue' | 'red' | 'amber';
}

const toneButtonClasses: Record<
  NonNullable<ActionButtonProps['tone']>,
  string
> = {
  blue:
    'bg-blue-500/90 text-blue-950 hover:bg-blue-400 disabled:bg-blue-500/30 disabled:text-blue-900',
  red:
    'bg-red-500/90 text-red-950 hover:bg-red-400 disabled:bg-red-500/30 disabled:text-red-900',
  amber:
    'bg-amber-400/90 text-amber-950 hover:bg-amber-300 disabled:bg-amber-500/30 disabled:text-amber-900',
};

function ActionButton({
  label,
  description,
  onClick,
  disabled = false,
  tone = 'blue',
}: ActionButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-2xl border border-slate-200 bg-white p-4 text-left transition ${
        disabled
          ? 'opacity-60'
          : 'hover:border-blue-500/40 hover:bg-blue-50'
      }`}
    >
      <span
        className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${toneButtonClasses[tone]}`}
      >
        {label}
      </span>
      <p className="mt-3 text-sm text-slate-700">{description}</p>
    </button>
  );
}

interface VettingAndAnnotationsProps {
  workflowStage: WorkflowStage;
  vettingSession: VettingSessionState;
  annotations: Annotation[];
  safeBrowserPolicies: string[];
  digitalChecklist: typeof digitalChecklist;
  vettingCountdown: string | null;
  userHasRole: (role: Role) => boolean;
  onStartVetting: (minutes: number) => void;
  onCompleteVetting: () => void;
  onAddAnnotation: (comment: string) => void;
  sectionId?: string;
}

function VettingAndAnnotations({
  workflowStage,
  vettingSession,
  annotations,
  safeBrowserPolicies,
  digitalChecklist,
  vettingCountdown,
  userHasRole,
  onStartVetting,
  onCompleteVetting,
  onAddAnnotation,
  sectionId,
}: VettingAndAnnotationsProps) {
  const [duration, setDuration] = useState(45);
  const [annotationDraft, setAnnotationDraft] = useState('');

  const canStartSession =
    userHasRole('Vetter') &&
    (workflowStage === 'Compiled for Vetting' ||
      workflowStage === 'Vetting Session Expired') &&
    !vettingSession.active;

  const canCompleteSession =
    userHasRole('Vetter') &&
    vettingSession.active &&
    workflowStage === 'Vetting in Progress';

  const safeBrowserStatus = [
    {
      label: 'Camera On',
      active: vettingSession.active ? vettingSession.cameraOn : true,
    },
    {
      label: 'Screenshots Blocked',
      active: vettingSession.active ? vettingSession.screenshotBlocked : true,
    },
    {
      label: 'Tab Switching Disabled',
      active: vettingSession.active ? vettingSession.switchingLocked : true,
    },
    {
      label: 'Timer Guarding Session',
      active: vettingSession.active,
    },
  ];

  const handleAnnotationSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onAddAnnotation(annotationDraft);
    setAnnotationDraft('');
  };

  return (
    <SectionCard
      id={sectionId}
      title="Digital Vetting & Annotation Suite"
      kicker="Safe Browser & Real-Time Sync"
      description="Enforce safe browser rules, coordinate real-time annotation, and cross-reference moderation checklists."
      actions={
        vettingSession.active && vettingCountdown ? (
          <div className="rounded-2xl border border-blue-500/40 bg-blue-500/10 px-4 py-3 text-center text-sm font-semibold text-blue-700">
            Session Countdown
            <div className="mt-1 text-2xl tracking-widest text-blue-800">
              {vettingCountdown}
            </div>
          </div>
        ) : (
          <StatusPill
            label="Session Idle"
            active={false}
            tone="slate"
          />
        )
      }
    >
      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-800">
              Safe Browser Controls
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Session enforces secure vetting environment from login to logout.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {safeBrowserStatus.map((item) => (
                <StatusPill
                  key={item.label}
                  label={item.label}
                  active={item.active}
                  tone={item.active ? 'blue' : 'amber'}
                />
              ))}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="session-minutes"
                  className="text-xs font-semibold uppercase tracking-wide text-slate-600"
                >
                  Session Duration (minutes)
                </label>
                <input
                  id="session-minutes"
                  type="number"
                  min={5}
                  max={180}
                  value={duration}
                  onChange={(event) =>
                    setDuration(Number.parseInt(event.target.value, 10))
                  }
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </div>
              <div className="flex items-end gap-3">
                <button
                  type="button"
                  onClick={() => onStartVetting(duration)}
                  disabled={!canStartSession}
                  className="flex-1 rounded-xl bg-blue-500/90 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:bg-blue-500/40 disabled:text-emerald-900"
                >
                  Start Safe Session
                </button>
                <button
                  type="button"
                  onClick={onCompleteVetting}
                  disabled={!canCompleteSession}
                  className="flex-1 rounded-xl bg-amber-400/90 px-4 py-2 text-sm font-semibold text-amber-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-amber-500/40 disabled:text-amber-900"
                >
                  Complete Vetting
                </button>
              </div>
            </div>

            <ul className="mt-4 space-y-2 text-sm text-slate-700">
              {safeBrowserPolicies.map((policy) => (
                <li key={policy} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span>{policy}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-800">
              Real-Time Digital Annotation
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Comments synchronise instantly so vetters see collective feedback.
            </p>
            <form
              onSubmit={handleAnnotationSubmit}
              className="mt-3 flex flex-col gap-3 sm:flex-row"
            >
              <input
                value={annotationDraft}
                onChange={(event) => setAnnotationDraft(event.target.value)}
                placeholder="Add annotation (Bloom’s taxonomy reference, etc.)"
                className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:opacity-60"
                disabled={!vettingSession.active}
              />
              <button
                type="submit"
                disabled={!vettingSession.active}
                className="rounded-xl bg-blue-500/90 px-4 py-2 text-sm font-semibold text-indigo-950 transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-blue-500/40 disabled:text-indigo-900"
              >
                Publish Comment
              </button>
            </form>
            <div className="mt-4 max-h-64 space-y-3 overflow-y-auto">
              {annotations.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No annotations posted yet. Start the vetting session to add
                  synchronized comments.
                </p>
              ) : (
                annotations.map((annotation) => (
                  <div
                    key={annotation.id}
                    className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700"
                  >
                    <p className="text-sm text-slate-900">
                      “{annotation.comment}”
                    </p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="font-semibold text-blue-700">
                        {annotation.author}
                      </span>
                      <span className="text-slate-500">
                        {formatTimestamp(annotation.timestamp)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-800">
              Moderation Checklist — Course Outline
            </h3>
            <ul className="mt-2 space-y-2 text-sm text-slate-700">
              {digitalChecklist.courseOutline.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-800">
              Bloom’s Taxonomy Coverage
            </h3>
            <ul className="mt-2 space-y-2 text-sm text-slate-700">
              {digitalChecklist.bloomsTaxonomy.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-indigo-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-800">
              Compliance Checklist
            </h3>
            <ul className="mt-2 space-y-2 text-sm text-slate-700">
              {digitalChecklist.compliance.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

interface DigitalDestructionPanelProps {
  destructionLog: DestructionLogEntry[];
  lastDecision?: WorkflowDecision;
  sectionId?: string;
}

function DigitalDestructionPanel({
  destructionLog,
  lastDecision,
  sectionId,
}: DigitalDestructionPanelProps) {
  return (
    <SectionCard
      id={sectionId}
      title="Digital Destruction & Archival"
      kicker="Secure Lifecycle Closure"
      description="Replace physical burning with a verifiable log that captures who secured draft versions for destruction or archiving."
      actions={
        lastDecision ? (
          <StatusPill
            label={`Last Decision: ${lastDecision.type}`}
            tone={lastDecision.type === 'Approved' ? 'blue' : 'amber'}
          />
        ) : (
          <StatusPill label="Awaiting Decision" tone="slate" active={false} />
        )
      }
    >
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-800">
          Secure Destruction Ledger
        </h3>
        <p className="mt-2 text-xs text-slate-500">
          Every rejected draft is traced digitally with timestamps and actor
          notes.
        </p>
        {destructionLog.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">
            No destruction events logged yet. Rejecting a paper will add secure
            entries here.
          </p>
        ) : (
          <ul className="mt-4 space-y-3 text-sm text-slate-700">
            {destructionLog.map((entry) => (
              <li
                key={entry.id}
                className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4"
              >
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span className="font-semibold text-rose-200">
                    {entry.versionLabel}
                  </span>
                  <span>{formatTimestamp(entry.timestamp)}</span>
                </div>
                <p className="mt-2 text-sm text-slate-900">{entry.details}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}

export default App;
