import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { motion } from 'framer-motion';
import jsPDF from 'jspdf';
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
import { createNotification, getUserNotifications, markNotificationAsRead, markAllNotificationsAsRead } from './lib/examServices/notificationService';
import ucuLogo from './assets/ucu-logo.png';

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

// Derive an effective workflow stage from persisted paper statuses so that
// dashboards still reflect real progress even after a full page refresh.
const getEffectiveWorkflowStage = (
  submittedPapers: SubmittedPaper[],
  currentStage: WorkflowStage
): WorkflowStage => {
  const hasApproved = submittedPapers.some((p) => p.status === 'approved');
  if (hasApproved) return 'Approved';

  const hasVetted = submittedPapers.some((p) => p.status === 'vetted');
  if (hasVetted) return 'Vetted & Returned to Chief Examiner';

  const hasInVetting = submittedPapers.some((p) => p.status === 'in-vetting');
  if (hasInVetting) return 'Vetting in Progress';

  // Check if Team Lead has submitted papers to Chief Examiner
  const hasTeamLeadSubmission = submittedPapers.some(
    (p) => p.submittedRole === 'Team Lead' && p.status === 'submitted'
  );
  if (hasTeamLeadSubmission) {
    return 'Compiled for Vetting'; // Team Lead submission means ready for Chief Examiner AI check, then vetting
  }

  const hasSubmitted = submittedPapers.some((p) => p.status === 'submitted');
  if (hasSubmitted && currentStage === 'Awaiting Setter') {
    return 'Submitted to Team Lead';
  }

  return currentStage;
};

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
  title?: string;
  type?: 'info' | 'warning' | 'error' | 'success' | 'deadline';
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

interface VetterWarning {
  id: string;
  vetterId: string;
  vetterName: string;
  type: 'tab_switch' | 'tab_navigation_attempt' | 'window_leave' | 'camera_disconnect' | 'screenshot_attempt' | 'window_open_attempt' | 'app_switch_attempt' | 'session_terminated';
  message: string;
  timestamp: number;
  severity: 'warning' | 'critical';
}

interface VetterMonitoring {
  vetterId: string;
  vetterName: string;
  joinedAt: number;
  cameraStream: MediaStream | null;
  warnings: VetterWarning[];
  violations: number;
}

interface VettingSessionRecord {
  id: string;
  paperId: string;
  paperName: string;
  courseCode: string;
  courseUnit: string;
  startedAt: number;
  completedAt: number;
  durationMinutes: number;
  vetters: Array<{
    vetterId: string;
    vetterName: string;
    joinedAt: number;
    warnings: VetterWarning[];
    violations: number;
  }>;
  annotations: Annotation[];
  checklistComments: Map<string, { comment: string; vetterName: string; timestamp: number; color: string }>;
  status: 'completed' | 'expired' | 'terminated';
}

interface DestructionLogEntry {
  id: string;
  versionLabel: string;
  timestamp: string;
  details: string;
}

interface ModerationSchedule {
  scheduled: boolean;
  startDateTime?: string; // ISO string for when moderation begins
  endDateTime?: string; // ISO string for when moderation ends
  scheduledStartTime?: number; // Timestamp when moderation will start
  scheduledEndTime?: number; // Timestamp when moderation will end
}

type ExamPaperStatus =
  | 'submitted_to_repository'
  | 'integrated_by_team_lead'
  | 'appointed_for_vetting'
  | 'vetting_in_progress'
  | 'vetted_with_comments'
  | 'approved_for_printing';

interface SubmittedPaper {
  id: string;
  fileName: string;
  submittedBy: string;
  submittedAt: string;
  fileSize?: number;
  status: 'submitted' | 'in-vetting' | 'vetted' | 'approved';
  courseUnit?: string;
  courseCode?: string;
  semester?: string;
  year?: string;
  fileUrl?: string;
  submittedRole?: 'Setter' | 'Team Lead' | 'Chief Examiner' | 'Manual' | 'Unknown';
}

interface RepositoryPaper {
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
  submittedRole?: 'Setter' | 'Team Lead' | 'Chief Examiner' | 'Manual' | 'Unknown';
}
interface SetterSubmission {
  id: string;
  fileName: string;
  submittedBy: string;
  submittedAt: string;
  fileContent?: string;
}

interface RepositoryPaper {
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
  submittedRole?: 'Setter' | 'Team Lead' | 'Chief Examiner' | 'Manual' | 'Unknown';
}

interface Annotation {
  id: string;
  author: string;
  comment: string;
  timestamp: string;
}

type ChecklistComment = {
  comment: string;
  vetterName: string;
  timestamp: number;
  color: string;
};

type ChecklistCommentsMap = Map<string, ChecklistComment>;

const DEFAULT_PASSWORD = 'user123';
const DEFAULT_SESSION_MINUTES = 3;
const CHECKLIST_COMMENTS_STORAGE_KEY = 'ucu-vetting-checklist-comments';
const CHECKLIST_COMMENTS_CHANNEL = 'ucu-vetting-checklist-sync';
const CHECKLIST_TYPING_TTL_MS = 6000;

const _defaultLecturerModules = [
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
      { id: 'ce-ai-similarity', name: 'Similarity Detection', description: 'Compare submitted papers with historical papers to detect similarities', category: 'Academic Integrity' },
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

const _roleToPanelIdMap: Partial<Record<Role, string>> = {
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

const DEMO_PAPER_ID = 'demo-networking';

const stripDemoPaper = (papers: SubmittedPaper[]): SubmittedPaper[] =>
  papers.filter((paper) => paper.id !== DEMO_PAPER_ID);

const encodeToBase64 = (input: string): string => {
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    return window.btoa(input);
  }
  const globalBuffer = typeof globalThis !== 'undefined' ? (globalThis as any).Buffer : undefined;
  if (globalBuffer?.from) {
    return globalBuffer.from(input, 'binary').toString('base64');
  }
  if (typeof btoa === 'function') {
    return btoa(input);
  }
  throw new Error('Base64 encoding not supported in this environment.');
};

const createDemoPdfDataUrl = (): string => {
  const textStream = `BT
/F1 20 Tf
72 720 Td
(UC Vetting Demo Paper) Tj
0 -28 Td
(Use this sample to test vetter tools.) Tj
0 -28 Td
(All violations remain visible to the Chief Examiner.) Tj
ET
`;

  const objectContents = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${textStream.length} >>\nstream\n${textStream}endstream\n`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
  ].map((content, _index) => `${_index + 1} 0 obj\n${content}\nendobj\n`);

  const header = '%PDF-1.4\n';
  const offsets = [0];
  let currentOffset = header.length;
  objectContents.forEach((obj) => {
    offsets.push(currentOffset);
    currentOffset += obj.length;
  });

  const body = objectContents.join('');
  const xrefStart = header.length + body.length;
  const xrefEntries = ['0000000000 65535 f \n'];
  for (let i = 1; i < offsets.length; i += 1) {
    xrefEntries.push(`${offsets[i].toString().padStart(10, '0')} 00000 n \n`);
  }
  const xref = `xref\n0 ${offsets.length}\n${xrefEntries.join('')}`;
  const trailer = `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  const pdfString = `${header}${body}${xref}${trailer}`;
  return `data:application/pdf;base64,${encodeToBase64(pdfString)}`;
};

const DEMO_PDF_DATA_URL = createDemoPdfDataUrl();

const createDemoPaper = (): SubmittedPaper => ({
  id: DEMO_PAPER_ID,
  fileName: 'networking.pdf',
  submittedBy: 'Demo Setter',
  submittedAt: new Date().toISOString(),
  fileSize: 0,
  status: 'in-vetting',
  courseUnit: 'Computer Networks',
  courseCode: 'CSE 3101',
  semester: 'Advent',
  year: `${new Date().getFullYear()}`,
  fileUrl: DEMO_PDF_DATA_URL,
  submittedRole: 'Setter',
});

const ensureDemoPaper = (papers: SubmittedPaper[]): SubmittedPaper[] => {
  const cleaned = stripDemoPaper(papers);
  if (cleaned.length === 0) {
    return [createDemoPaper()];
  }
  return cleaned;
};

const directFileUrlPattern = /^(https?:\/\/|\/|data:)/i;

const resolvePaperUrl = (fileUrl?: string | null): string | null => {
  if (!fileUrl) return null;
  if (directFileUrlPattern.test(fileUrl)) {
    return fileUrl;
  }

  try {
    const { data } = supabase.storage
      .from('exam_papers')
      .getPublicUrl(fileUrl);

    return data?.publicUrl ?? null;
  } catch (error) {
    console.error('Error generating Supabase public URL:', error);
    return null;
  }
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

interface ChecklistSectionConfig {
  id: string;
  title: string;
  placeholder: string;
  headingColor: string;
}

const pdfChecklistSectionConfigs: ChecklistSectionConfig[] = [
  {
    id: 'section-pdf-section-a',
    title: 'SECTION A — STRUCTURE & GENERAL QUALITY',
    placeholder: 'Add your comments for Section A (Structure & General Quality)...',
    headingColor: 'text-indigo-700',
  },
  {
    id: 'section-pdf-section-b',
    title: 'SECTION B — ALIGNMENT WITH COURSE OUTLINE',
    placeholder: 'Add your comments for Section B (Alignment with Course Outline)...',
    headingColor: 'text-purple-700',
  },
  {
    id: 'section-pdf-section-c',
    title: 'SECTION C — COGNITIVE DEPTH & BLOOM’S COVERAGE',
    placeholder: 'Capture comments about Bloom’s levels, fairness, and balance...',
    headingColor: 'text-blue-700',
  },
  {
    id: 'section-pdf-section-d',
    title: 'SECTION D — MARKING SCHEME & SOLUTION QUALITY',
    placeholder: 'Document issues or approvals for the marking guide and solutions...',
    headingColor: 'text-amber-700',
  },
  {
    id: 'section-pdf-section-e',
    title: 'SECTION E — ACADEMIC INTEGRITY & COMPLIANCE',
    placeholder: 'Highlight integrity, formatting, or compliance observations...',
    headingColor: 'text-emerald-700',
  },
  {
    id: 'section-pdf-additional',
    title: 'Additional Comments',
    placeholder: 'Add any additional comments or observations...',
    headingColor: 'text-rose-700',
  },
];

const defaultChecklistSectionConfigs: ChecklistSectionConfig[] = [
  {
    id: 'section-courseOutline',
    title: 'Course Outline Section',
    placeholder: 'Add your comments for the Course Outline section...',
    headingColor: 'text-blue-700',
  },
  {
    id: 'section-bloomsTaxonomy',
    title: 'Blooms Taxonomy Section',
    placeholder: 'Add your comments for the Blooms Taxonomy section...',
    headingColor: 'text-purple-700',
  },
  {
    id: 'section-compliance',
    title: 'Compliance Section',
    placeholder: 'Add your comments for the Compliance section...',
    headingColor: 'text-emerald-700',
  },
  {
    id: 'section-general-observations',
    title: 'General / Additional Comments',
    placeholder: 'Capture overarching remarks that affect the whole paper...',
    headingColor: 'text-rose-700',
  },
];

const createDemoChecklistComments = (): ChecklistCommentsMap => {
  const demoMap: ChecklistCommentsMap = new Map();
  const demoKey1 = 'courseOutline-Coverage of core topics for the semester';
  demoMap.set(demoKey1, {
    comment: '✅ Good coverage of all core topics. All required sections are present and well-structured.',
    vetterName: 'Dr. Sarah Johnson',
    timestamp: Date.now() - 3600000,
    color: '#10B981',
  });
  const demoKey2 = 'bloomsTaxonomy-Questions test different cognitive levels';
  demoMap.set(demoKey2, {
    comment: '⚠️ Some questions are too focused on lower-level recall. Recommend adding more analysis and evaluation questions.',
    vetterName: 'Prof. Michael Chen',
    timestamp: Date.now() - 1800000,
    color: '#F59E0B',
  });
  const demoKey3 = 'compliance-All questions are answerable within the allocated time';
  demoMap.set(demoKey3, {
    comment: '✅ Time allocation is appropriate. All questions can be completed within the given timeframe.',
    vetterName: 'Dr. Emily Williams',
    timestamp: Date.now() - 900000,
    color: '#3B82F6',
  });
  return demoMap;
};

const loadChecklistComments = (): ChecklistCommentsMap => {
  try {
    const saved = localStorage.getItem(CHECKLIST_COMMENTS_STORAGE_KEY);
    if (!saved) {
      return createDemoChecklistComments();
    }
    const parsed = JSON.parse(saved) as Record<string, ChecklistComment>;
    return new Map(Object.entries(parsed));
  } catch (error) {
    console.error('Error loading checklist comments:', error);
    return createDemoChecklistComments();
  }
};

const serializeChecklistComments = (comments: ChecklistCommentsMap): Record<string, ChecklistComment> => {
  const obj: Record<string, ChecklistComment> = {};
  comments.forEach((value, key) => {
    obj[key] = value;
  });
  return obj;
};

const buildChecklistExportPayload = ({
  comments,
  hasCustomChecklistPdf,
  hideVetterNames = false,
}: {
  comments: ChecklistCommentsMap;
  hasCustomChecklistPdf: boolean;
  hideVetterNames?: boolean;
}): string | null => {
  if (comments.size === 0) {
    return null;
  }

  const sectionConfigs = hasCustomChecklistPdf ? pdfChecklistSectionConfigs : defaultChecklistSectionConfigs;
  let checklistText = 'MODERATION CHECKLIST WITH VETTER COMMENTS\n';
  checklistText += '='.repeat(50) + '\n\n';

  checklistText += 'SECTION COMMENTS\n';
  checklistText += '-'.repeat(50) + '\n\n';

  sectionConfigs.forEach((section) => {
    const sectionComment = comments.get(section.id);
    if (sectionComment?.comment) {
      checklistText += `${section.title}\n`;
      checklistText += `Comment: ${sectionComment.comment}\n`;
      if (!hideVetterNames) {
        checklistText += `Added by: ${sectionComment.vetterName} on ${new Date(sectionComment.timestamp).toLocaleString()}\n\n`;
      } else {
        checklistText += `Added on: ${new Date(sectionComment.timestamp).toLocaleString()}\n\n`;
      }
    }
  });

  // Item-Level Comments section removed as per requirements

  return checklistText;
};

// Helper function to load UCU logo as base64
const loadUCULogo = async (): Promise<string | null> => {
  try {
    // Try to import the logo from assets
    const logoModule = await import('/src/assets/ucu-logo.png?url');
    if (logoModule.default) {
      // Fetch and convert to base64
      const response = await fetch(logoModule.default);
      const blob = await response.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    }
  } catch (error) {
    console.log('UCU logo not available, using text fallback');
  }
  return null;
};

// Generate PDF with UCU cover page and checklist content
const generateChecklistPDF = ({
  comments,
  hasCustomChecklistPdf,
  hideVetterNames = false,
  decision,
  courseCode,
  courseUnit,
  paperName,
  decisionNotes,
  decisionActor,
  decisionTimestamp,
}: {
  comments: ChecklistCommentsMap;
  hasCustomChecklistPdf: boolean;
  hideVetterNames?: boolean;
  decision?: 'Approved' | 'Rejected';
  courseCode?: string;
  courseUnit?: string;
  paperName?: string;
  decisionNotes?: string;
  decisionActor?: string;
  decisionTimestamp?: string;
}): jsPDF | null => {
  if (comments.size === 0) {
    return null;
  }

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  let yPos = margin;

  // UCU Cover Page with official UCU colors (Blue and White)
  // UCU Official Blue: RGB(0, 51, 102) - Deep professional blue
  const ucuBlue = [0, 51, 102];
  const ucuBlueLight = [0, 102, 204]; // Lighter blue for accents
  
  // Header with UCU official blue - taller header for logo space
  doc.setFillColor(ucuBlue[0], ucuBlue[1], ucuBlue[2]);
  doc.rect(0, 0, pageWidth, 50, 'F');
  
  // UCU Logo and University Name
  // Note: Logo loading is async, so we'll use text for now
  // The logo can be added later if needed via async PDF generation
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('UGANDA CHRISTIAN UNIVERSITY', pageWidth / 2, 30, { align: 'center' });
  
  // Add a decorative line under the header
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(0.5);
  doc.line(20, 40, pageWidth - 20, 40);
  
  yPos = 50;
  
  // Reset text color
  doc.setTextColor(0, 0, 0);
  
  // Title Section with UCU blue accent
  yPos = yPos + 15;
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(ucuBlue[0], ucuBlue[1], ucuBlue[2]);
  doc.text('MODERATION CHECKLIST REPORT', pageWidth / 2, yPos, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  
  yPos += 15;
  doc.setFontSize(14);
  doc.setFont('helvetica', 'normal');
  
  // Decision Status Box (only show if decision is provided)
  if (decision) {
    const decisionColor = decision === 'Approved' ? [34, 197, 94] : [239, 68, 68]; // Green for approved, Red for rejected
    doc.setFillColor(decisionColor[0], decisionColor[1], decisionColor[2]);
    doc.setDrawColor(decisionColor[0], decisionColor[1], decisionColor[2]);
    doc.roundedRect(pageWidth / 2 - 50, yPos - 8, 100, 20, 3, 3, 'FD');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(`DECISION: ${decision.toUpperCase()}`, pageWidth / 2, yPos + 4, { align: 'center' });
    doc.setTextColor(0, 0, 0);
    yPos += 30;
  } else {
    yPos += 10;
  }
  
  // Paper Information with UCU blue heading
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(ucuBlue[0], ucuBlue[1], ucuBlue[2]);
  doc.text('PAPER INFORMATION', margin, yPos);
  doc.setTextColor(0, 0, 0);
  yPos += 8;
  
  doc.setFont('helvetica', 'normal');
  if (courseCode) {
    doc.text(`Course Code: ${courseCode}`, margin, yPos);
    yPos += 7;
  }
  if (courseUnit) {
    doc.text(`Course Unit: ${courseUnit}`, margin, yPos);
    yPos += 7;
  }
  if (paperName) {
    doc.text(`Paper: ${paperName}`, margin, yPos);
    yPos += 7;
  }
  
  // Decision Details (only show if decision info is provided)
  if (decision || decisionActor || decisionTimestamp || decisionNotes) {
    yPos += 5;
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(ucuBlue[0], ucuBlue[1], ucuBlue[2]);
    doc.text('DECISION DETAILS', margin, yPos);
    doc.setTextColor(0, 0, 0);
    yPos += 8;
    
    doc.setFont('helvetica', 'normal');
    if (decisionActor) {
      doc.text(`Decision By: ${decisionActor}`, margin, yPos);
      yPos += 7;
    }
    if (decisionTimestamp) {
      const formattedDate = new Date(decisionTimestamp).toLocaleString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      doc.text(`Decision Date: ${formattedDate}`, margin, yPos);
      yPos += 7;
    }
    if (decisionNotes) {
      yPos += 3;
      doc.setFont('helvetica', 'bold');
      doc.text('Decision Notes:', margin, yPos);
      yPos += 7;
      doc.setFont('helvetica', 'normal');
      const notesLines = doc.splitTextToSize(decisionNotes, pageWidth - 2 * margin);
      doc.text(notesLines, margin, yPos);
      yPos += notesLines.length * 7;
    }
  }
  
  // Add new page for checklist content
  doc.addPage();
  yPos = margin;
  
  // Checklist Content Header with UCU blue
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(ucuBlue[0], ucuBlue[1], ucuBlue[2]);
  doc.text('MODERATION CHECKLIST WITH VETTER COMMENTS', pageWidth / 2, yPos, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  yPos += 15;
  
  // Get section configs
  const sectionConfigs = hasCustomChecklistPdf ? pdfChecklistSectionConfigs : defaultChecklistSectionConfigs;
  
  // Section Comments with UCU blue heading
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(ucuBlue[0], ucuBlue[1], ucuBlue[2]);
  doc.text('SECTION COMMENTS', margin, yPos);
  doc.setTextColor(0, 0, 0);
  yPos += 10;
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  
  sectionConfigs.forEach((section) => {
    const sectionComment = comments.get(section.id);
    if (sectionComment?.comment) {
      // Check if we need a new page
      if (yPos > pageHeight - 40) {
        doc.addPage();
        yPos = margin;
      }
      
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(ucuBlueLight[0], ucuBlueLight[1], ucuBlueLight[2]);
      doc.text(section.title, margin, yPos);
      doc.setTextColor(0, 0, 0);
      yPos += 7;
      
      doc.setFont('helvetica', 'normal');
      const commentLines = doc.splitTextToSize(`Comment: ${sectionComment.comment}`, pageWidth - 2 * margin);
      doc.text(commentLines, margin, yPos);
      yPos += commentLines.length * 5;
      
      const timestamp = new Date(sectionComment.timestamp).toLocaleString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      
      if (!hideVetterNames) {
        doc.text(`Added by: ${sectionComment.vetterName} on ${timestamp}`, margin, yPos);
      } else {
        doc.text(`Added on: ${timestamp}`, margin, yPos);
      }
      yPos += 10;
    }
  });
  
  // Item-Level Comments section removed as per requirements
  
  // Footer on last page
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    // Footer with UCU blue accent
    doc.setFontSize(8);
    doc.setTextColor(ucuBlue[0], ucuBlue[1], ucuBlue[2]);
    doc.text(
      `Page ${i} of ${pageCount} - Uganda Christian University - Generated on ${new Date().toLocaleString('en-GB')}`,
      pageWidth / 2,
      pageHeight - 10,
      { align: 'center' }
    );
    doc.setTextColor(0, 0, 0);
  }
  
  return doc;
};

const loadCustomChecklist = (): typeof digitalChecklist | null => {
  try {
    const saved = localStorage.getItem('ucu-custom-checklist');
    if (!saved) {
      return null;
    }
    const parsed = JSON.parse(saved);
    if (
      parsed &&
      Array.isArray(parsed.courseOutline) &&
      Array.isArray(parsed.bloomsTaxonomy) &&
      Array.isArray(parsed.compliance)
    ) {
      return parsed;
    }
    return null;
  } catch (error) {
    console.error('Error loading custom checklist:', error);
    return null;
  }
};

const loadCustomChecklistPdf = (): { url: string; name: string; isWordDoc?: boolean } | null => {
  try {
    const saved = localStorage.getItem('ucu-custom-checklist-pdf');
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    if (parsed?.name) {
      return { url: parsed.url || '', name: parsed.name, isWordDoc: parsed.isWordDoc || false };
    }
    return null;
  } catch (error) {
    console.error('Error loading custom checklist PDF:', error);
    return null;
  }
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
  const [_isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [chiefExaminerRoleEnabled, setChiefExaminerRoleEnabled] =
    useState(loadPersistedChiefExaminerEnabled);
  const [deadlinesActive, setDeadlinesActive] = useState(false);
  const [_deadlineStartTime, setDeadlineStartTime] = useState<number | null>(null);
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
  // Track if checklist has been forwarded to Team Lead
  const [checklistForwardedToTeamLead, setChecklistForwardedToTeamLead] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('ucu-checklist-forwarded');
      return saved === 'true';
    } catch {
      return false;
    }
  });
  const [workflow, setWorkflow] = useState<WorkflowState>(initialWorkflow);
  const [versionHistory, setVersionHistory] =
    useState<VersionHistoryEntry[]>(initialVersionHistory);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [destructionLog, setDestructionLog] = useState<DestructionLogEntry[]>(
    []
  );
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [showNotificationPanel, setShowNotificationPanel] = useState(false);
  const [activeToast, setActiveToast] = useState<AppNotification | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    if (!activeToast) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setActiveToast(null);
    }, 5000); // Match the progress bar duration

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [activeToast]);
  // Load persisted papers from localStorage
  const loadPersistedPapers = (): SubmittedPaper[] => {
    try {
      const saved = localStorage.getItem('ucu-moderation-papers');
      if (!saved) return ensureDemoPaper([]);
      const parsed = JSON.parse(saved) as SubmittedPaper[];
      return ensureDemoPaper(parsed);
    } catch (error) {
      console.error('Error loading persisted papers:', error);
      return ensureDemoPaper([]);
    }
  };

  // Load persisted moderation schedule from localStorage
  const loadPersistedModerationSchedule = (): ModerationSchedule => {
    try {
      const saved = localStorage.getItem('ucu-moderation-schedule');
      if (!saved) return { scheduled: false };
      const parsed = JSON.parse(saved) as ModerationSchedule;
      // Convert ISO strings back to timestamps if needed
      if (parsed.scheduledStartTime && typeof parsed.scheduledStartTime === 'string') {
        parsed.scheduledStartTime = new Date(parsed.scheduledStartTime).getTime();
      }
      if (parsed.scheduledEndTime && typeof parsed.scheduledEndTime === 'string') {
        parsed.scheduledEndTime = new Date(parsed.scheduledEndTime).getTime();
      }
      return parsed;
    } catch (error) {
      console.error('Error loading persisted moderation schedule:', error);
      return { scheduled: false };
    }
  };

  // Load persisted vetting session from localStorage
  const loadPersistedVettingSession = (): VettingSessionState => {
    try {
      const saved = localStorage.getItem('ucu-moderation-vetting-session');
      if (!saved) return emptyVettingSession;
      const parsed = JSON.parse(saved) as VettingSessionState;
      // Convert timestamps if they're strings
      if (parsed.startedAt && typeof parsed.startedAt === 'string') {
        parsed.startedAt = new Date(parsed.startedAt).getTime();
      }
      if (parsed.expiresAt && typeof parsed.expiresAt === 'string') {
        parsed.expiresAt = new Date(parsed.expiresAt).getTime();
      }
      return parsed;
    } catch (error) {
      console.error('Error loading persisted vetting session:', error);
      return emptyVettingSession;
    }
  };

  const [submittedPapers, setSubmittedPapers] = useState<SubmittedPaper[]>(loadPersistedPapers());
  const [setterSubmissions, setSetterSubmissions] = useState<SetterSubmission[]>([]);
  const [repositoryPapers, setRepositoryPapers] = useState<RepositoryPaper[]>([]);
  const [customChecklist, setCustomChecklist] = useState<typeof digitalChecklist | null>(loadCustomChecklist());
  const [customChecklistPdf, setCustomChecklistPdf] = useState<{ url: string; name: string; isWordDoc?: boolean } | null>(loadCustomChecklistPdf());
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [activePanelId, setActivePanelId] = useState<string>('overview');
  const [moderationSchedule, setModerationSchedule] = useState<ModerationSchedule>(loadPersistedModerationSchedule());
  const [vettingSession, setVettingSession] = useState<VettingSessionState>(loadPersistedVettingSession());
  // Track which vetters have joined the session (enabled camera and started their individual session)
  const [joinedVetters, setJoinedVetters] = useState<Set<string>>(new Set());
  // Track restricted vetters (violated rules - cannot rejoin until reactivated by Chief Examiner)
  const loadRestrictedVetters = (): Set<string> => {
    try {
      const saved = localStorage.getItem('ucu-restricted-vetters');
      if (!saved) return new Set();
      const parsed = JSON.parse(saved) as string[];
      return new Set(parsed);
    } catch (error) {
      console.error('Error loading restricted vetters:', error);
      return new Set();
    }
  };
  const [restrictedVetters, setRestrictedVetters] = useState<Set<string>>(loadRestrictedVetters);
  // Track monitoring data for each vetter (camera feeds, warnings, violations)
  const [vetterMonitoring, setVetterMonitoring] = useState<Map<string, VetterMonitoring>>(new Map());
  // Store camera stream references for Chief Examiner monitoring
  const vetterCameraStreams = useRef<Map<string, MediaStream>>(new Map());
  // Checklist comments - keyed by checklist category and item text
  const [checklistComments, setChecklistComments] = useState<ChecklistCommentsMap>(() => loadChecklistComments());
  const [checklistTypingState, setChecklistTypingState] = useState<Map<string, Map<string, { name: string; timestamp: number }>>>(new Map());
  // Track draft text for real-time collaboration - Map<commentKey, Map<vetterId, { text: string; vetterName: string }>>
  const [checklistDraftText, setChecklistDraftText] = useState<Map<string, Map<string, { text: string; vetterName: string }>>>(new Map());
  const checklistCommentsChannelRef = useRef<BroadcastChannel | null>(null);
  const activeChecklist = customChecklist ?? digitalChecklist;
  // Vetting session records - stores completed sessions
  const loadVettingRecords = (): VettingSessionRecord[] => {
    try {
      const saved = localStorage.getItem('ucu-vetting-records');
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      // Convert checklistComments back to Map
      return parsed.map((record: any) => ({
        ...record,
        checklistComments: new Map(Object.entries(record.checklistComments || {})),
      }));
    } catch (error) {
      console.error('Error loading vetting records:', error);
      return [];
    }
  };
  
  // Function to clear all vetting records
  const _clearVettingRecords = () => {
    localStorage.removeItem('ucu-vetting-records');
    setVettingSessionRecords([]);
    console.log('✅ All vetting session records cleared');
  };
  
  const [vettingSessionRecords, setVettingSessionRecords] = useState<VettingSessionRecord[]>(loadVettingRecords());
  // Archive papers - for AI similarity checking
  const loadArchivedPapers = (): SubmittedPaper[] => {
    try {
      const saved = localStorage.getItem('ucu-archived-papers');
      if (!saved) return [];
      return JSON.parse(saved);
    } catch (error) {
      console.error('Error loading archived papers:', error);
      return [];
    }
  };
  const [_archivedPapers, setArchivedPapers] = useState<SubmittedPaper[]>(loadArchivedPapers());
  const mainContentRef = useRef<HTMLDivElement | null>(null);

  const currentUser = useMemo(
    () => users.find((user) => user.id === authUserId) ?? null,
    [authUserId, users]
  );

  useEffect(() => {
    try {
      const serialized = JSON.stringify(serializeChecklistComments(checklistComments));
      localStorage.setItem(CHECKLIST_COMMENTS_STORAGE_KEY, serialized);
    } catch (error) {
      console.error('Error saving checklist comments:', error);
    }
  }, [checklistComments]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== CHECKLIST_COMMENTS_STORAGE_KEY || !event.newValue) {
        return;
      }
      try {
        const parsed = JSON.parse(event.newValue) as Record<string, ChecklistComment>;
        setChecklistComments(new Map(Object.entries(parsed)));
      } catch (error) {
        console.error('Error syncing checklist comments from storage:', error);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
      return;
    }
    const channel = new BroadcastChannel(CHECKLIST_COMMENTS_CHANNEL);
    checklistCommentsChannelRef.current = channel;
    channel.onmessage = (event: MessageEvent) => {
      const { type, payload } = event.data || {};
      if (!payload) return;
      if (payload.sourceUserId && payload.sourceUserId === currentUser?.id) {
        return;
      }
      if (type === 'comment_update') {
        const { commentKey, commentData } = payload as {
          commentKey?: string;
          commentData?: ChecklistComment | null;
        };
        if (!commentKey) return;
        setChecklistComments((prev) => {
          const next = new Map(prev);
          if (commentData) {
            next.set(commentKey, commentData);
          } else {
            next.delete(commentKey);
          }
          return next;
        });
      } else if (type === 'typing') {
        const { commentKey, vetterId, vetterName, isTyping, timestamp } = payload as {
          commentKey?: string;
          vetterId?: string;
          vetterName?: string;
          isTyping?: boolean;
          timestamp?: number;
        };
        if (!commentKey || !vetterId || vetterId === currentUser?.id) {
          return;
        }
        setChecklistTypingState((prev) => {
          const next = new Map(prev);
          const existing = new Map(next.get(commentKey) ?? new Map());
          if (isTyping) {
            existing.set(vetterId, {
              name: vetterName ?? 'Vetter',
              timestamp: timestamp ?? Date.now(),
            });
          } else {
            existing.delete(vetterId);
          }
          if (existing.size > 0) {
            next.set(commentKey, existing);
          } else {
            next.delete(commentKey);
          }
          return next;
        });
      } else if (type === 'draft_update') {
        const { commentKey, vetterId, vetterName, draftText } = payload as {
          commentKey?: string;
          vetterId?: string;
          vetterName?: string;
          draftText?: string;
        };
        if (!commentKey || !vetterId || vetterId === currentUser?.id) {
          return;
        }
        setChecklistDraftText((prev) => {
          const next = new Map(prev);
          const existing = new Map(next.get(commentKey) ?? new Map());
          if (draftText && draftText.trim()) {
            existing.set(vetterId, {
              text: draftText,
              vetterName: vetterName ?? 'Vetter',
            });
          } else {
            existing.delete(vetterId);
          }
          if (existing.size > 0) {
            next.set(commentKey, existing);
          } else {
            next.delete(commentKey);
          }
          return next;
        });
      }
    };
    return () => {
      channel.close();
      checklistCommentsChannelRef.current = null;
    };
  }, [currentUser?.id]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setChecklistTypingState((prev) => {
        const now = Date.now();
        let mutated = false;
        const next = new Map<string, Map<string, { name: string; timestamp: number }>>();
        prev.forEach((userMap, key) => {
          const retained = new Map<string, { name: string; timestamp: number }>();
          userMap.forEach((entry, userId) => {
            if (now - entry.timestamp < CHECKLIST_TYPING_TTL_MS) {
              retained.set(userId, entry);
            } else {
              mutated = true;
            }
          });
          if (retained.size > 0) {
            next.set(key, retained);
          } else if (userMap.size > 0) {
            mutated = true;
          }
        });
        return mutated ? next : prev;
      });
    }, 2000);
    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const checklistTypingIndicators = useMemo(() => {
    const indicatorMap = new Map<string, string[]>();
    checklistTypingState.forEach((userMap, key) => {
      const names = Array.from(userMap.values())
        .map((entry) => entry.name)
        .filter(Boolean);
      if (names.length > 0) {
        indicatorMap.set(key, Array.from(new Set(names)));
      }
    });
    return indicatorMap;
  }, [checklistTypingState]);

  const broadcastChecklistCommentUpdate = useCallback(
    (commentKey: string, commentData: ChecklistComment | null) => {
      if (!commentKey || !currentUser?.id) return;
      try {
        checklistCommentsChannelRef.current?.postMessage({
          type: 'comment_update',
          payload: {
            commentKey,
            commentData,
            sourceUserId: currentUser.id,
          },
        });
      } catch (error) {
        console.error('Error broadcasting checklist comment update:', error);
      }
    },
    [currentUser?.id]
  );

  const broadcastDraftTextUpdate = useCallback(
    (commentKey: string, draftText: string) => {
      if (!commentKey || !currentUser?.id) return;
      try {
        checklistCommentsChannelRef.current?.postMessage({
          type: 'draft_update',
          payload: {
            commentKey,
            vetterId: currentUser.id,
            vetterName: currentUser.name ?? 'Unknown',
            draftText,
            sourceUserId: currentUser.id,
          },
        });
      } catch (error) {
        console.error('Error broadcasting draft text update:', error);
      }
    },
    [currentUser?.id, currentUser?.name]
  );

  const handleChecklistTypingChange = useCallback(
    (commentKey: string, isTyping: boolean) => {
      if (!commentKey || !currentUser?.id) return;
      const userId = currentUser.id;
      setChecklistTypingState((prev) => {
        const next = new Map(prev);
        const existing = new Map(next.get(commentKey) ?? new Map());
        if (isTyping) {
          existing.set(userId, {
            name: currentUser.name ?? 'Unknown',
            timestamp: Date.now(),
          });
        } else {
          existing.delete(userId);
        }
        if (existing.size > 0) {
          next.set(commentKey, existing);
        } else {
          next.delete(commentKey);
        }
        return next;
      });
      try {
        checklistCommentsChannelRef.current?.postMessage({
          type: 'typing',
          payload: {
            commentKey,
            vetterId: userId,
            vetterName: currentUser.name ?? 'Unknown',
            isTyping,
            timestamp: Date.now(),
            sourceUserId: userId,
          },
        });
      } catch (error) {
        console.error('Error broadcasting typing indicator:', error);
      }
    },
    [currentUser?.id, currentUser?.name]
  );

  // Load persisted deadline state so countdowns continue across refresh / logout
  useEffect(() => {
    try {
      const raw = localStorage.getItem('ucu-moderation-deadlines');
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        setterDeadlineActive?: boolean;
        setterDeadlineStartTime?: number | null;
        setterDeadlineDuration?: { days: number; hours: number; minutes: number };
        teamLeadDeadlineActive?: boolean;
        teamLeadDeadlineStartTime?: number | null;
        teamLeadDeadlineDuration?: { days: number; hours: number; minutes: number };
      };

      if (typeof parsed.setterDeadlineActive === 'boolean') {
        setSetterDeadlineActive(parsed.setterDeadlineActive);
      }
      if (typeof parsed.setterDeadlineStartTime === 'number') {
        setSetterDeadlineStartTime(parsed.setterDeadlineStartTime);
      }
      if (parsed.setterDeadlineDuration) {
        setSetterDeadlineDuration(parsed.setterDeadlineDuration);
      }

      if (typeof parsed.teamLeadDeadlineActive === 'boolean') {
        setTeamLeadDeadlineActive(parsed.teamLeadDeadlineActive);
      }
      if (typeof parsed.teamLeadDeadlineStartTime === 'number') {
        setTeamLeadDeadlineStartTime(parsed.teamLeadDeadlineStartTime);
      }
      if (parsed.teamLeadDeadlineDuration) {
        setTeamLeadDeadlineDuration(parsed.teamLeadDeadlineDuration);
      }
    } catch (error) {
      console.error('Error loading deadline state from localStorage:', error);
    }
  }, []);

  // Persist deadline state whenever it changes
  useEffect(() => {
    try {
      const payload = {
        setterDeadlineActive,
        setterDeadlineStartTime,
        setterDeadlineDuration,
        teamLeadDeadlineActive,
        teamLeadDeadlineStartTime,
        teamLeadDeadlineDuration,
      };
      localStorage.setItem('ucu-moderation-deadlines', JSON.stringify(payload));
    } catch (error) {
      console.error('Error saving deadline state to localStorage:', error);
    }
  }, [
    setterDeadlineActive,
    setterDeadlineStartTime,
    setterDeadlineDuration,
    teamLeadDeadlineActive,
    teamLeadDeadlineStartTime,
    teamLeadDeadlineDuration,
  ]);

  // Persist submittedPapers whenever they change
  useEffect(() => {
    try {
      localStorage.setItem('ucu-moderation-papers', JSON.stringify(submittedPapers));
    } catch (error) {
      console.error('Error saving papers to localStorage:', error);
    }
  }, [submittedPapers]);

  // Persist moderationSchedule whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('ucu-moderation-schedule', JSON.stringify(moderationSchedule));
    } catch (error) {
      console.error('Error saving moderation schedule to localStorage:', error);
    }
  }, [moderationSchedule]);

  // Persist vettingSession whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('ucu-moderation-vetting-session', JSON.stringify(vettingSession));
    } catch (error) {
      console.error('Error saving vetting session to localStorage:', error);
    }
  }, [vettingSession]);

  useEffect(() => {
    try {
      if (customChecklist) {
        localStorage.setItem('ucu-custom-checklist', JSON.stringify(customChecklist));
      } else {
        localStorage.removeItem('ucu-custom-checklist');
      }
      if (customChecklistPdf) {
        localStorage.setItem('ucu-custom-checklist-pdf', JSON.stringify(customChecklistPdf));
      } else {
        localStorage.removeItem('ucu-custom-checklist-pdf');
      }
    } catch (error) {
      console.error('Error saving custom checklist:', error);
    }
  }, [customChecklist, customChecklistPdf]);

  // Load persisted exam papers from Supabase so they survive refresh/login
  useEffect(() => {
    const loadExamPapersFromSupabase = async () => {
      try {
        const { data, error } = await supabase
          .from('exam_papers')
          .select('*')
          .order('created_at', { ascending: false });

        if (error || !data) {
          console.error('Error loading exam papers from Supabase:', error);
          return;
        }

        // Map exam_papers rows into SubmittedPaper + repositoryPapers structures
        const submitted: SubmittedPaper[] = data.map((paper: any) => {
          let submittedRole: SubmittedPaper['submittedRole'] = 'Unknown';
          if (paper.team_lead_id) {
            submittedRole = 'Team Lead';
          } else if (paper.setter_id) {
            submittedRole = 'Setter';
          } else if (paper.chief_examiner_id) {
            submittedRole = 'Chief Examiner';
          }

          return {
            id: paper.id,
            fileName: paper.file_name || paper.course_name || 'Exam Paper',
            submittedBy:
              paper.team_lead_id ||
              paper.setter_id ||
              paper.chief_examiner_id ||
              'Unknown',
            submittedAt: paper.submitted_at || paper.created_at,
            fileSize: paper.file_size || undefined,
            // Map backend workflow states into the simplified UI statuses.
            // NOTE: A paper that has only been integrated by the Team Lead
            // has NOT yet been vetted, so we must not surface it as "vetted"
            // in the Chief Examiner dashboard.
            status:
              paper.status === 'approved_for_printing'
                ? 'approved'
                : paper.status === 'appointed_for_vetting' ||
                  paper.status === 'vetting_in_progress' ||
                  paper.status === 'vetted_with_comments'
                ? 'in-vetting'
                : paper.status === 'integrated_by_team_lead'
                ? 'submitted'
                : 'submitted',
            courseCode: paper.course_code,
            courseUnit: paper.course_name,
            semester: paper.semester,
            year: paper.academic_year,
            fileUrl: paper.file_url || undefined,
            submittedRole,
          };
        });

        const repo = data.map((paper: any) => {
          let submittedRole: 'Setter' | 'Team Lead' | 'Chief Examiner' | 'Manual' | 'Unknown' = 'Unknown';
          if (paper.team_lead_id) {
            submittedRole = 'Team Lead';
          } else if (paper.setter_id) {
            submittedRole = 'Setter';
          } else if (paper.chief_examiner_id) {
            submittedRole = 'Chief Examiner';
          }
          
          return {
            id: paper.id,
            courseUnit: paper.course_name,
            courseCode: paper.course_code,
            semester: paper.semester,
            year: paper.academic_year,
            submittedBy: paper.setter_id || paper.team_lead_id || 'Unknown',
            submittedAt: paper.submitted_at || paper.created_at,
            fileName: paper.file_name || 'Exam Paper',
            content: paper.file_url || '',
            fileSize: paper.file_size || undefined,
            submittedRole,
          };
        });

        // Merge Supabase papers with persisted papers, prioritizing Supabase data but keeping persisted statuses
        const persistedPapers = loadPersistedPapers();
        const mergedPapers: SubmittedPaper[] = submitted.map(supabasePaper => {
          const persisted = persistedPapers.find(p => p.id === supabasePaper.id);
          // If paper exists in persisted and has "in-vetting" status, keep that status
          if (persisted && persisted.status === 'in-vetting') {
            return { ...supabasePaper, status: 'in-vetting' as const };
          }
          return supabasePaper;
        });
        // Add any persisted papers that aren't in Supabase yet
        const newPersisted = persistedPapers.filter(p => !submitted.find(s => s.id === p.id));
        const finalPapers = ensureDemoPaper([...mergedPapers, ...newPersisted]);
        setSubmittedPapers(finalPapers);
        setRepositoryPapers(repo);
        
        // Persist the merged papers
        try {
          localStorage.setItem('ucu-moderation-papers', JSON.stringify(finalPapers));
        } catch (error) {
          console.error('Error saving merged papers to localStorage:', error);
        }
      } catch (err) {
        console.error('Unexpected error loading exam papers:', err);
      }
    };

    loadExamPapersFromSupabase();
  }, []);

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

  // Load persisted notifications for the signed-in user from Supabase with real-time subscription
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
          title: n.title,
          timestamp: n.created_at,
          read: n.is_read,
          type: n.type,
        }));
        setNotifications(mapped);
        
        // Check for unread role assignment notifications and show toast
        const roleAssignmentNotifications = mapped.filter(
          (n) => 
            !n.read && 
            n.type === 'success' && 
            (n.title?.includes('Role Assigned') || n.title?.includes('Chief Examiner'))
        );
        
        if (roleAssignmentNotifications.length > 0) {
          // Show the most recent role assignment notification
          const mostRecent = roleAssignmentNotifications.sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          )[0];
          
          setActiveToast(mostRecent);
          // Auto-hide toast after 8 seconds for role assignments
          setTimeout(() => {
            setActiveToast((current) =>
              current && current.id === mostRecent.id ? null : current
            );
          }, 8000);
        }
      } catch (error) {
        console.error('Error loading user notifications:', error);
      }
    };

    void loadNotifications();
    
    // Set up real-time subscription for notifications
    if (currentUser) {
      const channelName = `notifications:${currentUser.id}`;
      const channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${currentUser.id}`,
          },
          (payload) => {
            console.log('📬 New notification received via real-time:', payload);
            try {
              const newNotification = payload.new as {
                id: string;
                message: string;
                created_at: string;
                is_read: boolean;
                title?: string;
                type?: 'info' | 'warning' | 'error' | 'success' | 'deadline';
              };
              const mapped: AppNotification = {
                id: newNotification.id,
                message: newNotification.message,
                title: newNotification.title,
                timestamp: newNotification.created_at,
                read: newNotification.is_read,
                type: newNotification.type || 'info',
              };
              setNotifications((prev) => [mapped, ...prev].slice(0, 50));
              // Show toast for new notification
              setActiveToast(mapped);
              // Auto-hide toast after 5 seconds
              setTimeout(() => {
                setActiveToast((current) =>
                  current && current.id === mapped.id ? null : current
                );
              }, 5000);
            } catch (error) {
              console.error('Error processing new notification:', error);
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${currentUser.id}`,
          },
          (payload) => {
            console.log('📝 Notification updated via real-time:', payload);
            try {
              const updatedNotification = payload.new as {
                id: string;
                is_read: boolean;
              };
              setNotifications((prev) =>
                prev.map((n) =>
                  n.id === updatedNotification.id
                    ? { ...n, read: updatedNotification.is_read }
                    : n
                )
              );
            } catch (error) {
              console.error('Error processing notification update:', error);
            }
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log('✅ Real-time notifications subscription active');
          } else if (status === 'CHANNEL_ERROR') {
            console.error('❌ Real-time subscription error - falling back to polling');
          } else if (status === 'TIMED_OUT') {
            console.warn('⏱️ Real-time subscription timed out - falling back to polling');
          } else {
            console.log('📡 Real-time subscription status:', status);
          }
        });

      // Also keep polling as backup (every 10 seconds for faster updates)
      const interval = setInterval(() => {
        loadNotifications();
      }, 10000);
      
      return () => {
        console.log('🔌 Cleaning up notification subscription');
        supabase.removeChannel(channel);
        clearInterval(interval);
      };
    }
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

  // Safe Browser Enforcement Effects - ONLY for Vetters, NOT for Chief Examiner
  useEffect(() => {
    // Only apply safe browser restrictions to vetters who have joined
    const isVetter = currentUserHasRole('Vetter');
    const vetterHasJoined = currentUser?.id ? joinedVetters.has(currentUser.id) : false;
    
    if (!vettingSession.active || !vettingSession.safeBrowserEnabled || !isVetter || !vetterHasJoined) {
      // Clean up any existing restrictions when session is not active or user is not a joined vetter
      const bodyStyle = document.body.style as CSSStyleDeclaration & { MozUserSelect?: string };
      bodyStyle.userSelect = '';
      bodyStyle.webkitUserSelect = '';
      bodyStyle.MozUserSelect = '';
      return;
    }

    console.log('Safe browser enforcement activated', {
      active: vettingSession.active,
      safeBrowserEnabled: vettingSession.safeBrowserEnabled,
      cameraOn: vettingSession.cameraOn,
      screenshotBlocked: vettingSession.screenshotBlocked,
      switchingLocked: vettingSession.switchingLocked,
    });

    // 1. Prevent Screenshots - Only if screenshotBlocked is true
    const preventScreenshots = () => {
      if (!vettingSession.screenshotBlocked) {
        return () => {}; // No-op cleanup
      }

      // Disable right-click context menu
      const handleContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        return false;
      };

      // Disable common screenshot keyboard shortcuts
      const handleKeyDown = (e: KeyboardEvent) => {
        // Windows: Win+Shift+S, Print Screen, Alt+Print Screen
        // Mac: Cmd+Shift+3, Cmd+Shift+4, Cmd+Shift+5
        if (
          (e.key === 'PrintScreen') ||
          (e.ctrlKey && e.shiftKey && e.key === 'S') ||
          (e.metaKey && e.shiftKey && ['3', '4', '5'].includes(e.key)) ||
          (e.altKey && e.key === 'PrintScreen') ||
          (e.key === 'F12') ||
          (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(e.key)) ||
          (e.ctrlKey && e.key === 'U')
        ) {
          e.preventDefault();
          e.stopPropagation();
          // Immediately restrict the vetter if they attempt screenshot
          if (currentUser?.id && joinedVetters.has(currentUser.id)) {
            restrictVetter(currentUser.id, 'screenshot_attempt');
          }
          return false;
        }
      };

      // Disable text selection (makes screenshots harder)
      const handleSelectStart = (e: Event) => {
        e.preventDefault();
        return false;
      };

      // Disable drag
      const handleDragStart = (e: DragEvent) => {
        e.preventDefault();
        return false;
      };

      document.addEventListener('contextmenu', handleContextMenu, { capture: true });
      document.addEventListener('keydown', handleKeyDown, { capture: true });
      document.addEventListener('selectstart', handleSelectStart, { capture: true });
      document.addEventListener('dragstart', handleDragStart, { capture: true });

      // Add CSS to prevent selection
      const bodyStyle = document.body.style as CSSStyleDeclaration & { MozUserSelect?: string };
      bodyStyle.userSelect = 'none';
      bodyStyle.webkitUserSelect = 'none';
      bodyStyle.MozUserSelect = 'none';

      return () => {
        document.removeEventListener('contextmenu', handleContextMenu, { capture: true });
        document.removeEventListener('keydown', handleKeyDown, { capture: true });
        document.removeEventListener('selectstart', handleSelectStart, { capture: true });
        document.removeEventListener('dragstart', handleDragStart, { capture: true });
        bodyStyle.userSelect = '';
        bodyStyle.webkitUserSelect = '';
        bodyStyle.MozUserSelect = '';
      };
    };

    // 2. Close other windows/tabs - Always active when safe browser is on
    const closeOtherWindows = () => {
      // Try to close other windows (only works for windows opened by this script)
      if (window.opener) {
        try {
          window.opener.close();
        } catch (e) {
          // Cross-origin or already closed
        }
      }

      // STRICT: Warn user about other tabs and terminate session if they switch away
      const handleVisibilityChange = () => {
        if (document.hidden && currentUser?.id) {
          // Log warning for Chief Examiner monitoring
          logVetterWarning(
            currentUser.id,
            'tab_switch',
            'Vetter switched away from the vetting session tab.',
            'critical'
          );
          
          alert('WARNING: You have switched away from the vetting session. If you continue, your session will be terminated. Please return immediately.');
          // Try to bring focus back
          window.focus();
          
          // If still not focused after warning, restrict the vetter
          setTimeout(() => {
            if (document.hidden || !document.hasFocus()) {
              // Immediately restrict the vetter if they continue leaving the window
              if (currentUser.id && joinedVetters.has(currentUser.id)) {
                restrictVetter(currentUser.id, 'window_leave');
              }
            }
          }, 3000);
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    };

    // 3. Prevent tab/window switching - STRICT enforcement for vetters
    const preventTabSwitching = () => {
      if (!vettingSession.switchingLocked) {
        return () => {}; // No-op cleanup
      }

      // STRICT: Warn about session termination when trying to leave
      const handleBeforeUnload = (e: BeforeUnloadEvent) => {
        e.preventDefault();
        e.returnValue = 'WARNING: Leaving this page will TERMINATE your vetting session. Your work will be saved, but you must rejoin to continue.';
        return e.returnValue;
      };

      const handleBlur = () => {
        // STRICT: Immediately prevent leaving the vetting window
        if (document.hasFocus() === false && currentUser?.id) {
          const vetterId = currentUser.id;
          setTimeout(() => {
            if (!document.hasFocus()) {
              logVetterWarning(
                vetterId,
                'window_leave',
                'Safe browser enforcement: attempt to leave vetting window detected. Forcing focus back.',
                'critical'
              );
              
              alert('Leaving the vetting window is not allowed. Returning focus to the vetting environment. Continued attempts will terminate your session.');
              
              const refocus = () => {
                try {
              window.focus();
                } catch (error) {
                  console.error('Error forcing focus back to vetting window:', error);
                }
              };
              
              refocus();
              const refocusInterval = window.setInterval(() => {
                if (!document.hasFocus()) {
                  refocus();
              } else {
                  window.clearInterval(refocusInterval);
                }
              }, 150);
              
              window.setTimeout(() => {
                if (!document.hasFocus()) {
                  window.clearInterval(refocusInterval);
                  
                  // Immediately restrict the vetter if they continue leaving the window
                  if (vetterId && joinedVetters.has(vetterId)) {
                    restrictVetter(vetterId, 'window_leave');
                  }
                }
              }, 2000);
            }
          }, 250);
        }
      };

      // Prevent keyboard shortcuts for tab navigation
      const handleKeyDown = (e: KeyboardEvent) => {
        // Block Ctrl+T (new tab), Ctrl+W (close tab), Ctrl+Shift+T (reopen tab)
        // Ctrl+N (new window), Ctrl+Shift+N (new incognito)
        if (
          (e.ctrlKey || e.metaKey) && (
            e.key === 't' || 
            e.key === 'T' || 
            e.key === 'w' || 
            e.key === 'W' ||
            (e.shiftKey && (e.key === 't' || e.key === 'T' || e.key === 'n' || e.key === 'N')) ||
            (!e.shiftKey && e.key === 'n')
          )
        ) {
          e.preventDefault();
          e.stopPropagation();
          
          // Log warning for Chief Examiner monitoring - CRITICAL
          if (currentUser?.id) {
            const alertMessage = 'Tab navigation is disabled during the vetting session. Your session will be terminated if you attempt to open new tabs.';
            logVetterWarning(
              currentUser.id,
              'tab_navigation_attempt',
              `Attempted to use ${e.key.toUpperCase()} shortcut for tab navigation. Alert shown: "${alertMessage}"`,
              'critical'
            );
            
            // Increment violations count
            setVetterMonitoring(prev => {
              const newMap = new Map(prev);
              const existing = newMap.get(currentUser.id!);
              if (existing) {
                newMap.set(currentUser.id!, {
                  ...existing,
                  violations: (existing.violations || 0) + 1,
                });
              }
              return newMap;
            });
          }
          
          alert('Tab navigation is disabled during the vetting session. Your session will be terminated if you attempt to open new tabs.');
          return false;
        }
        
        // Block Alt+Tab (Windows/Linux) and Cmd+Tab (Mac) attempts
        if ((e.altKey && e.key === 'Tab') || (e.metaKey && e.key === 'Tab')) {
          e.preventDefault();
          e.stopPropagation();
          
          // Log warning for Chief Examiner monitoring - CRITICAL
          if (currentUser?.id) {
            logVetterWarning(
              currentUser.id,
              'app_switch_attempt',
              'Attempted to switch between applications using Alt+Tab/Cmd+Tab. This is a critical violation.',
              'critical'
            );
            
            // Increment violations count
            setVetterMonitoring(prev => {
              const newMap = new Map(prev);
              const existing = newMap.get(currentUser.id!);
              if (existing) {
                newMap.set(currentUser.id!, {
                  ...existing,
                  violations: (existing.violations || 0) + 1,
                });
              }
              return newMap;
            });
          }
          
          alert('Switching between applications is not allowed. Your session will be terminated.');
          return false;
        }
      };

      // Block attempts to open new windows/tabs programmatically
      const originalWindowOpen = window.open;
      window.open = function(...args: any[]) {
        // Log warning for Chief Examiner monitoring - CRITICAL VIOLATION
        if (currentUser?.id) {
          const alertMessage = 'Opening new windows/tabs is disabled during the vetting session. Your session will be terminated if you continue.';
          logVetterWarning(
            currentUser.id,
            'window_open_attempt',
            `Attempted to open new window/tab: ${args[0] || 'unknown URL'}. This is a critical violation. Alert shown: "${alertMessage}"`,
            'critical'
          );
          
          // Increment violations count
          setVetterMonitoring(prev => {
            const newMap = new Map(prev);
            const existing = newMap.get(currentUser.id!);
            if (existing) {
              newMap.set(currentUser.id!, {
                ...existing,
                violations: (existing.violations || 0) + 1,
              });
            }
            return newMap;
          });
        }
        
        alert('Opening new windows/tabs is disabled during the vetting session. Your session will be terminated if you continue.');
        return null;
      };

      window.addEventListener('beforeunload', handleBeforeUnload);
      window.addEventListener('blur', handleBlur);
      document.addEventListener('keydown', handleKeyDown, true);

      // Prevent navigation
      const handlePopState = () => {
        window.history.pushState(null, '', window.location.href);
      };

      window.history.pushState(null, '', window.location.href);
      window.addEventListener('popstate', handlePopState);

      return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
        window.removeEventListener('blur', handleBlur);
        document.removeEventListener('keydown', handleKeyDown, true);
        window.removeEventListener('popstate', handlePopState);
        window.open = originalWindowOpen; // Restore original
      };
    };

    // 4. Camera monitoring - Only if cameraOn is true
    const monitorCamera = async () => {
      if (!vettingSession.cameraOn) {
        return () => {}; // No-op cleanup
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        // Camera is active - we can monitor it
        // Store stream reference for cleanup
        (window as any).__vettingCameraStream = stream;
        
        // Monitor camera status
        const checkCamera = setInterval(() => {
          if (stream.active) {
            // Camera is active
          } else {
            alert('Camera disconnected. Please ensure your camera remains active during the session.');
          }
        }, 5000);

        return () => {
          clearInterval(checkCamera);
          stream.getTracks().forEach(track => track.stop());
          delete (window as any).__vettingCameraStream;
        };
      } catch (error) {
        console.error('Camera access error:', error);
        alert('Camera access is required for the vetting session. Please enable camera permissions.');
        return () => {}; // No-op cleanup on error
      }
    };

    // 5. Fullscreen enforcement (optional - makes it harder to switch)
    const enforceFullscreen = () => {
      const requestFullscreen = async () => {
        try {
          if (document.documentElement.requestFullscreen) {
            await document.documentElement.requestFullscreen();
          } else if ((document.documentElement as any).webkitRequestFullscreen) {
            await (document.documentElement as any).webkitRequestFullscreen();
          } else if ((document.documentElement as any).mozRequestFullScreen) {
            await (document.documentElement as any).mozRequestFullScreen();
          }
        } catch (error) {
          console.error('Fullscreen error:', error);
        }
      };

      // Try to enter fullscreen
      requestFullscreen();

      // Monitor fullscreen changes
      const handleFullscreenChange = () => {
        if (!document.fullscreenElement && !(document as any).webkitFullscreenElement && !(document as any).mozFullScreenElement) {
          // User exited fullscreen - warn them
          alert('Fullscreen mode is required. Returning to fullscreen...');
          requestFullscreen();
        }
      };

      document.addEventListener('fullscreenchange', handleFullscreenChange);
      document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.addEventListener('mozfullscreenchange', handleFullscreenChange);

      return () => {
        document.removeEventListener('fullscreenchange', handleFullscreenChange);
        document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
        document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      };
    };

    // Apply restrictions based on individual flags
    const cleanupScreenshots = preventScreenshots();
    const cleanupWindows = closeOtherWindows();
    const cleanupTabSwitching = preventTabSwitching();
    let cleanupCamera: (() => void) | undefined;
    const cleanupFullscreen = enforceFullscreen();

    // Start camera monitoring (async) - only if cameraOn is true AND user is a Vetter
    // Chief Examiners can start the session but don't need camera access
    // Vetters will be prompted for camera when they join the active session
    if (vettingSession.cameraOn && currentUserHasRole('Vetter')) {
      monitorCamera().then(cleanup => {
        cleanupCamera = cleanup;
      }).catch(err => {
        console.error('Camera monitoring setup error:', err);
      });
    }

    // Cleanup when session ends
    return () => {
      cleanupScreenshots?.();
      cleanupWindows?.();
      cleanupTabSwitching?.();
      cleanupCamera?.();
      cleanupFullscreen?.();
    };
  }, [vettingSession.active, vettingSession.safeBrowserEnabled, vettingSession.cameraOn, vettingSession.screenshotBlocked, vettingSession.switchingLocked, joinedVetters, currentUser?.id]);

  // Auto-complete session when scheduled moderation ends - handles ALL vetters
  useEffect(() => {
    if (
      moderationSchedule.scheduled &&
      moderationSchedule.scheduledEndTime &&
      currentTime >= moderationSchedule.scheduledEndTime &&
      vettingSession.active
    ) {
      joinedVetters.forEach((vetterId) => {
        logVetterWarning?.(
          vetterId,
          'window_leave',
          'Session expired. Camera feed terminated and vetter signed out automatically.',
          'critical'
        );
      });
      // Save records for all joined vetters before ending session
      const vettedPaper = submittedPapers.find(p => p.status === 'in-vetting');
      
      if (vettedPaper && vettingSession.startedAt) {
        const completedAt = Date.now();
        const startedAt = vettingSession.startedAt;
        const durationMinutes = vettingSession.durationMinutes || DEFAULT_SESSION_MINUTES;
        
        // Create vetting session record with all vetter data
        const sessionRecord: VettingSessionRecord = {
          id: createId(),
          paperId: vettedPaper.id,
          paperName: vettedPaper.fileName,
          courseCode: vettedPaper.courseCode || 'Unknown',
          courseUnit: vettedPaper.courseUnit || 'Unknown',
          startedAt,
          completedAt,
          durationMinutes,
          vetters: Array.from((vetterMonitoring || new Map()).entries()).map(([vetterId, monitoring]) => {
            const allWarnings = monitoring.warnings ? [...monitoring.warnings] : [];
            // Count violations from critical warnings as backup, but prefer the tracked violations count
            const criticalWarningsCount = allWarnings.filter(w => w.severity === 'critical').length;
            const violations = typeof monitoring.violations === 'number' ? monitoring.violations : criticalWarningsCount;
            
            console.log(`📋 Recording vetter ${monitoring.vetterName} (moderation ended):`, {
              vetterId,
              warningsCount: allWarnings.length,
              violations,
              criticalWarningsCount,
              monitoringViolations: monitoring.violations,
            });
            
            return {
              vetterId,
              vetterName: monitoring.vetterName,
              joinedAt: monitoring.joinedAt,
              warnings: allWarnings,
              violations: violations, // ALL violations recorded - use tracked count or count from critical warnings
            };
          }),
          annotations: [...annotations],
          checklistComments: new Map(checklistComments),
          status: 'completed',
        };
        
        // Store the session record
        setVettingSessionRecords(prev => [sessionRecord, ...prev]);
        
        // Persist to localStorage
        try {
          const existing = JSON.parse(localStorage.getItem('ucu-vetting-records') || '[]');
          const recordToSave = {
            ...sessionRecord,
            checklistComments: Object.fromEntries(sessionRecord.checklistComments),
          };
          existing.unshift(recordToSave);
          localStorage.setItem('ucu-vetting-records', JSON.stringify(existing.slice(0, 50)));
        } catch (error) {
          console.error('Error saving vetting record:', error);
        }
        
        // Update submitted papers status to 'vetted'
        setSubmittedPapers(prev => {
          const base = stripDemoPaper(prev);
          const updated = base.map(paper =>
            paper.status === 'in-vetting'
              ? { ...paper, status: 'vetted' as const }
              : paper
          );
          return ensureDemoPaper(updated);
        });
      }
      
      // Stop all camera streams for all vetters
      vetterCameraStreams.current.forEach((stream, vetterId) => {
        stream.getTracks().forEach(track => track.stop());
        console.log(`📹 Stopped camera stream for vetter ${vetterId} (moderation ended)`);
      });
      vetterCameraStreams.current.clear();
      
      // Stop global monitoring camera stream if it exists
      if ((window as any).__vettingCameraStream) {
        const globalStream = (window as any).__vettingCameraStream as MediaStream;
        globalStream.getTracks().forEach(track => track.stop());
        delete (window as any).__vettingCameraStream;
        console.log('📹 Stopped global monitoring camera stream (moderation ended)');
      }
      
      // Remove all vetters from joined set
      setJoinedVetters(new Set());
      
      // Clear monitoring data
      setVetterMonitoring(new Map());
      
      // Auto-submit all pending annotations (they're already saved, just log it)
      if (annotations.length > 0) {
        pushWorkflowEvent(
          `Moderation session ended. ${annotations.length} annotation(s) automatically submitted.`,
          'System'
        );
      }

      // Close safe browser and end session
      setVettingSession({
        active: false,
        safeBrowserEnabled: false,
        cameraOn: false,
        screenshotBlocked: false,
        switchingLocked: false,
        lastClosedReason: 'expired',
      });

      pushWorkflowEvent(
        'Moderation Session Ended: Session time expired. All vetter records saved, cameras stopped, and safe browser closed.',
        'System',
        { stage: 'Vetted & Returned to Chief Examiner' }
      );

      // Show notification
      const notification: AppNotification = {
        id: createId(),
        message: 'Moderation Session Ended: Session time expired. All vetter records have been saved and cameras stopped.',
        timestamp: new Date().toISOString(),
        read: false,
        title: 'Session Expired',
        type: 'warning',
      };
      setNotifications((prev) => [notification, ...prev]);
      setActiveToast(notification);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moderationSchedule.scheduled, moderationSchedule.scheduledEndTime, currentTime, vettingSession.active, annotations.length]);

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

  const _handleAddUser = (name: string, baseRole: BaseRole) => {
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

  const _handleEnableChiefExaminerRole = () => {
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

  const _addLecturerAccount = async (name: string, category?: 'Undergraduate' | 'Postgraduate', email?: string) => {
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
  const addAdminAccount = async (
    name: string,
    email: string,
    isSuperAdmin: boolean,
    campus: string,
    department: string
  ) => {
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
      campus: campus.trim(),
      department: department.trim(),
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

  const _handlePromoteToChiefExaminer = async (userId: string) => {
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

  const _handleUnassignChiefExaminer = (userId: string) => {
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

      // Create a notification for the Chief Examiner (current user) to see in their bell
      const notification: AppNotification = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        message,
        timestamp: new Date().toISOString(),
        read: false,
        title: 'Role Assignment Successful',
        type: 'success',
      };

      // Show toast + local bell update for the current user (Chief Examiner)
      setNotifications((prev) => [notification, ...prev].slice(0, 20));
      setActiveToast(notification);

      // Note: Notification for the target user is created in privilegeElevation.ts
      // (appointRole/elevateToChiefExaminer functions)

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
      submittedRole: 'Chief Examiner' as const,
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
      submittedRole: 'Setter' as const,
    };
    setRepositoryPapers((prev) => [...prev, repositoryPaper]);

    pushWorkflowEvent(
      'Submitted draft to Team Lead. Copy automatically shared with Chief Examiner. Paper added to repository and vetting.',
      actor,
      {
        stage: 'Submitted to Team Lead',
        mutate: (_prev) => ({
          portalOpen: false,
          awaitingRecycle: false,
          lastDecision: undefined,
        }),
      }
    );
    appendVersionHistory(
      actor,
      `Setter lodged the initial draft paper (${courseCode} - ${courseName}) and notified Chief Examiner. Paper added to repository for AI analysis.`
    );

    // Notify Team Lead(s) that a new draft has arrived
    const message = `New draft "${file.name}" submitted by ${actor} for ${courseCode} - ${courseName}.`;
    const toast: AppNotification = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      message,
      timestamp: new Date().toISOString(),
      read: false,
      title: 'New Setter Draft Submitted',
      type: 'info',
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

  const handleTeamLeadSubmitPDF = async (
    file: File,
    courseUnit: string,
    courseCode: string,
    semester: string,
    year: string
  ) => {
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
    const actorId = authUserId || currentUser?.id;
    const paperId = createId();
    const newPaper: SubmittedPaper = {
      id: paperId,
      fileName: file.name,
      submittedBy: actor,
      submittedAt: new Date().toISOString(),
      fileSize: file.size,
      status: 'submitted' as const,
      courseUnit,
      courseCode,
      semester,
      year,
      submittedRole: 'Team Lead',
    };

    setSubmittedPapers((prev) => {
      const base = stripDemoPaper(prev);
      const updated = [...base, newPaper];
      return ensureDemoPaper(updated);
    });

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
        submittedRole: 'Team Lead' as const,
      };
      setRepositoryPapers((prev) => [...prev, repositoryPaper]);
    };
    reader.readAsText(file);

    // Persist Team Lead submission to Supabase so Chief Examiner and vetters can see it
    const result = await saveExamPaperToSupabase(file, {
      courseUnit,
      courseCode,
      semester,
      year,
      submittedById: actorId,
      submittedByName: actor,
      submittedRole: 'Team Lead',
    });

    if (!result.success) {
      alert(result.error || 'Failed to save Team Lead submission to the system.');
      return;
    }

    // Show success confirmation to Team Lead
    alert(`Successfully submitted "${file.name}" to Chief Examiner. The Chief Examiner has been notified and will review the paper for AI similarity analysis before forwarding to vetting.\n\nThe paper will appear in the "Submissions from Team Lead" section in the Chief Examiner Dashboard.`);

    // Reload papers from Supabase to ensure Chief Examiner sees the new submission
    // This helps when Chief Examiner is logged in on another session
    try {
      const { data, error } = await supabase
        .from('exam_papers')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && data) {
        const submitted: SubmittedPaper[] = data.map((paper: any) => {
          let submittedRole: SubmittedPaper['submittedRole'] = 'Unknown';
          if (paper.team_lead_id) {
            submittedRole = 'Team Lead';
          } else if (paper.setter_id) {
            submittedRole = 'Setter';
          } else if (paper.chief_examiner_id) {
            submittedRole = 'Chief Examiner';
          }

          return {
            id: paper.id,
            fileName: paper.file_name || paper.course_name || 'Exam Paper',
            submittedBy:
              paper.team_lead_id ||
              paper.setter_id ||
              paper.chief_examiner_id ||
              'Unknown',
            submittedAt: paper.submitted_at || paper.created_at,
            fileSize: paper.file_size || undefined,
            status:
              paper.status === 'approved_for_printing'
                ? 'approved'
                : paper.status === 'appointed_for_vetting' ||
                  paper.status === 'vetting_in_progress' ||
                  paper.status === 'vetted_with_comments'
                ? 'in-vetting'
                : paper.status === 'integrated_by_team_lead'
                ? 'submitted'
                : 'submitted',
            courseCode: paper.course_code,
            courseUnit: paper.course_name,
            semester: paper.semester,
            year: paper.academic_year,
            fileUrl: paper.file_url || undefined,
            submittedRole,
          };
        });
        setSubmittedPapers(ensureDemoPaper(submitted));
      }
    } catch (err) {
      console.error('Error reloading papers after Team Lead submission:', err);
    }

    // Update workflow stage to indicate papers are with Chief Examiner
    pushWorkflowEvent(
      `Team Lead submitted PDF "${file.name}" to Chief Examiner. Paper ready for AI similarity analysis before vetting.`,
      actor,
      {
        stage: 'Compiled for Vetting',
        mutate: (prev) => ({
          ...prev,
        }),
      }
    );
    appendVersionHistory(
      actor,
      `Team Lead submitted paper: ${file.name} (${courseCode} - ${courseUnit}, ${(file.size / 1024).toFixed(
        2
      )} KB). Paper received by Chief Examiner for AI similarity checks before vetting.`
    );

    // Notify Chief Examiner that Team Lead has submitted the compiled paper
    const notificationMessage = `Team Lead ${actor} submitted "${file.name}" for ${courseCode} - ${courseUnit}. Paper is ready for your AI similarity analysis before forwarding to vetting.`;
    const toast: AppNotification = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      message: notificationMessage,
      timestamp: new Date().toISOString(),
      read: false,
      title: 'Team Lead Submission Received',
      type: 'info',
    };

    // If the current user also has Chief Examiner role (multi‑role account),
    // show the toast immediately in the UI.
    if (currentUserHasRole('Chief Examiner')) {
      setNotifications((prev) => [toast, ...prev].slice(0, 20));
      setActiveToast(toast);
      setTimeout(() => {
        setActiveToast((current) =>
          current && current.id === toast.id ? null : current
        );
      }, 8000); // Show longer for important Chief Examiner notifications
    }

    // Persist notification in the DB for ALL Chief Examiners (priority notification)
    users
      .filter((u) => u.roles.includes('Chief Examiner'))
      .forEach((target) => {
        if (!target.id) return;
        void createNotification({
          user_id: target.id,
          title: 'Team Lead Submission Received - Action Required',
          message: notificationMessage,
          type: 'info',
        });
      });

    // Also notify Vetters (but with lower priority)
    users
      .filter((u) => u.roles.includes('Vetter') && !u.roles.includes('Chief Examiner'))
      .forEach((target) => {
        if (!target.id) return;
        void createNotification({
          user_id: target.id,
          title: 'Team Lead Submission Received',
          message: `Team Lead ${actor} submitted "${file.name}" for ${courseCode} - ${courseUnit}. Awaiting Chief Examiner AI analysis before vetting.`,
          type: 'info',
        });
      });
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
    setSubmittedPapers(prev => {
      const base = stripDemoPaper(prev);
      const updated = base.map(paper =>
        paper.submittedBy === actor && paper.status === 'submitted'
          ? { ...paper, status: 'in-vetting' as const }
          : paper
      );
      return ensureDemoPaper(updated);
    });
    
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

  const handleStartVetting = async (minutes: number) => {
    console.log('handleStartVetting called with minutes:', minutes);
    console.log('Current state:', {
      hasVetterRole: currentUserHasRole('Vetter'),
      hasChiefExaminerRole: currentUserHasRole('Chief Examiner'),
      workflowStage: workflow.stage,
      sessionActive: vettingSession.active,
      currentUser: currentUser?.name,
      currentUserId: currentUser?.id,
    });

    const isChiefExaminer = currentUserHasRole('Chief Examiner');
    const isVetter = currentUserHasRole('Vetter');

    // Allow Chief Examiner or Vetter to start/join the session
    if (!isChiefExaminer && !isVetter) {
      alert('You must have the Chief Examiner or Vetter role to start a vetting session.');
      console.error('Start session blocked: User does not have required role');
      return;
    }

    // If Chief Examiner is starting the global session
    if (isChiefExaminer && !isVetter) {
      if (vettingSession.active) {
        alert('A vetting session is already active.');
        console.error('Start session blocked: Session already active');
      return;
    }

    const duration = Math.max(DEFAULT_SESSION_MINUTES, minutes);
    const startedAt = Date.now();
    const expiresAt = startedAt + duration * 60 * 1000;
      
      console.log('Chief Examiner starting global vetting session:', {
        duration,
        startedAt,
        expiresAt,
      });
      
      // Start global vetting session - this enables the "Start Session" button for vetters
    setVettingSession({
      active: true,
      startedAt,
      durationMinutes: duration,
      expiresAt,
        safeBrowserEnabled: true, // Will be enforced only for vetters
      cameraOn: true,
      screenshotBlocked: true,
      switchingLocked: true,
    });

      // Update workflow stage to 'Vetting in Progress'
    const actor = currentUser?.name ?? 'Unknown';
    pushWorkflowEvent(
        `Chief Examiner started vetting session with a ${duration}-minute secure window. Vetters can now join by clicking "Start Session" and enabling their camera.`,
      actor,
      { stage: 'Vetting in Progress' }
    );
      
      setWorkflow((prev) => ({
        ...prev,
        stage: 'Vetting in Progress',
      }));

      // Notify all vetters that vetting session has started
      const vettingMessage = `Chief Examiner ${actor} started a vetting session. You can now join by clicking "Start Session" and enabling your camera.`;
      users
        .filter((u) => u.roles.includes('Vetter'))
        .forEach((vetter) => {
          if (vetter.id) {
            void createNotification({
              user_id: vetter.id,
              title: 'Vetting Session Started',
              message: vettingMessage,
              type: 'info',
            });
          }
        });

      console.log('Global vetting session started by Chief Examiner!');
      return;
    }

    // If Vetter is joining the session (global session must already be active)
    if (isVetter && !vettingSession.active) {
      alert('The Chief Examiner must start the session first. Please wait for the session to begin.');
      console.error('Vetter join blocked: Global session not active');
      return;
    }

    // Vetter must enable camera BEFORE starting their session
    if (isVetter && currentUser?.id) {
      // Check if vetter has already joined
      if (joinedVetters.has(currentUser.id)) {
        alert('You have already joined this vetting session.');
        return;
      }

      // STRICT: Require camera access before vetter can start
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        // Camera access granted - stop the stream for now, will be reactivated by safe browser effect
        stream.getTracks().forEach(track => track.stop());
      } catch (error) {
        alert('Camera access is REQUIRED to join the vetting session. Please enable camera permissions and try again.');
        console.error('Vetter join blocked: Camera access denied', error);
        return;
      }

      // Mark this vetter as joined
      setJoinedVetters(prev => new Set(prev).add(currentUser.id!));
      
      // Store camera stream for Chief Examiner monitoring
      try {
        const cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        vetterCameraStreams.current.set(currentUser.id!, cameraStream);
        
        // Initialize monitoring data for this vetter
        setVetterMonitoring(prev => {
          const newMap = new Map(prev);
          newMap.set(currentUser.id!, {
            vetterId: currentUser.id!,
            vetterName: currentUser.name ?? 'Unknown',
            joinedAt: Date.now(),
            cameraStream,
            warnings: [],
            violations: 0,
          });
          return newMap;
        });
      } catch (error) {
        console.error('Failed to capture camera stream for monitoring:', error);
      }
      
      const actor = currentUser.name ?? 'Unknown';
      pushWorkflowEvent(
        `Vetter ${actor} joined the vetting session. Safe browser restrictions are now active.`,
        actor
      );

      console.log('Vetter joined session successfully!', {
        vetterId: currentUser.id,
        vetterName: actor,
      });
    }
  };

  // Function to restrict a vetter (sign out, add to restricted list, persist)
  const restrictVetter = (vetterId: string, violationType: 'screenshot_attempt' | 'window_leave') => {
    if (!vetterId) return;
    
    // Sign out the vetter immediately
    setJoinedVetters(prev => {
      const newSet = new Set(prev);
      newSet.delete(vetterId);
      return newSet;
    });
    
    // Clean up camera stream
    const stream = vetterCameraStreams.current.get(vetterId);
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      vetterCameraStreams.current.delete(vetterId);
    }
    
    // Remove from monitoring
    setVetterMonitoring(prev => {
      const newMap = new Map(prev);
      newMap.delete(vetterId);
      return newMap;
    });
    
    // Add to restricted list
    setRestrictedVetters(prev => {
      const newSet = new Set(prev);
      newSet.add(vetterId);
      // Persist to localStorage
      localStorage.setItem('ucu-restricted-vetters', JSON.stringify(Array.from(newSet)));
      return newSet;
    });
    
    // Log the violation
    logVetterWarning(
      vetterId,
      violationType,
      `VIOLATION: ${violationType === 'screenshot_attempt' ? 'Screenshot attempt detected' : 'Window leave detected'}. Session terminated and access restricted.`,
      'critical'
    );
    
    // Show violation message to the vetter
    const violationMessage = violationType === 'screenshot_attempt' 
      ? 'VIOLATION: Screenshot attempt detected. Your session has been terminated and your access has been restricted. Please contact the Chief Examiner to regain access.'
      : 'VIOLATION: Leaving the window is not allowed. Your session has been terminated and your access has been restricted. Please contact the Chief Examiner to regain access.';
    
    alert(violationMessage);
    
    // Note: User will need to manually log out or refresh - we've already restricted their access
  };

  // Helper function to log warnings/violations for vetter monitoring
  // THIS RECORDS EVERY ACTION AND ALERT MESSAGE SHOWN TO THE VETTER - CHIEF EXAMINER SEES ALL IN REAL-TIME
  const logVetterWarning = (vetterId: string, type: VetterWarning['type'], message: string, severity: 'warning' | 'critical' = 'warning') => {
    const vetter = users.find((u: User) => u.id === vetterId);
    if (!vetter) {
      console.warn('logVetterWarning: Vetter not found', vetterId);
      return;
    }

    const warning: VetterWarning = {
      id: createId(),
      vetterId,
      vetterName: vetter.name,
      type,
      message,
      timestamp: Date.now(),
      severity,
    };

    // Log to console for debugging - Chief Examiner can see this in console too
    console.log('🚨 Vetter Warning Logged:', {
      vetterId,
      vetterName: vetter.name,
      type,
      message,
      severity,
      timestamp: new Date(warning.timestamp).toLocaleString(),
    });

    // Update monitoring state - Chief Examiner sees this immediately
    setVetterMonitoring(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(vetterId);
      if (existing) {
        // Add warning to existing monitoring data - Keep last 100 warnings for complete history
        newMap.set(vetterId, {
          ...existing,
          warnings: [...(existing.warnings || []), warning].slice(-100), // Keep last 100 warnings
          violations: existing.violations + (severity === 'critical' ? 1 : 0),
        });
      } else {
        // Initialize monitoring data if it doesn't exist (shouldn't happen but safety check)
        newMap.set(vetterId, {
          vetterId,
          vetterName: vetter.name,
          joinedAt: Date.now(),
          cameraStream: null,
          warnings: [warning],
          violations: severity === 'critical' ? 1 : 0,
        });
      }
      return newMap;
    });

    // Also notify Chief Examiner via browser notification if they have that permission
    if (currentUserHasRole('Chief Examiner') && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(`Vetter Warning: ${vetter.name}`, {
        body: `${severity.toUpperCase()}: ${message}`,
        icon: '/favicon.ico',
        tag: warning.id,
      });
    }
  };

  const handleScheduleModeration = (startDateTime: string) => {
    if (!currentUserHasRole('Chief Examiner')) {
      return;
    }
    
    const scheduledStartTime = new Date(startDateTime).getTime();
    
    if (scheduledStartTime < Date.now()) {
      alert('Start time must be in the future');
      return;
    }
    
    // Set end time to null since it will be determined when session starts manually
    setModerationSchedule({
      scheduled: true,
      startDateTime,
      endDateTime: undefined,
      scheduledStartTime,
      scheduledEndTime: undefined,
    });
    
    const actor = currentUser?.name ?? 'Unknown';
    const startDate = new Date(startDateTime).toLocaleString();
    pushWorkflowEvent(
      `Moderation scheduled: starts ${startDate}. Session will be started manually.`,
      actor
    );
  };

  const handleRemoveChecklist = () => {
    if (confirm('Are you sure you want to remove the checklist from vetting? This will clear the uploaded checklist PDF/template.')) {
      setCustomChecklistPdf(null);
      setCustomChecklist(null);
      alert('Checklist removed from vetting. Default checklist will be used.');
    }
  };

  const handleRemovePaperFromVetting = (paperId: string) => {
    const paper = submittedPapers.find(p => p.id === paperId);
    if (!paper) {
      alert('Paper not found.');
      return;
    }
    
    if (confirm(`Are you sure you want to remove "${paper.fileName}" from vetting? This will change its status back to "submitted".`)) {
      setSubmittedPapers(prev => {
        const updated = prev.map(p => 
          p.id === paperId 
            ? { ...p, status: 'submitted' as const }
            : p
        );
        // Persist to localStorage
        try {
          localStorage.setItem('ucu-moderation-papers', JSON.stringify(updated));
        } catch (error) {
          console.error('Error saving papers to localStorage:', error);
        }
        return updated;
      });
      alert(`Paper "${paper.fileName}" has been removed from vetting and returned to submitted status.`);
    }
  };

  const handleUploadChecklistFile = (file: File) => {
    // Accept Word documents (.docx) and PDFs - prefer Word for editing
    const isWordDoc = file.name.toLowerCase().endsWith('.docx') || 
                      file.name.toLowerCase().endsWith('.doc') ||
                      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                      file.type === 'application/msword';
    
    if (isWordDoc) {
      // For Word documents, we'll create an editable HTML version
      const reader = new FileReader();
      reader.onload = (_event) => {
        // Store the file info - we'll display an editable Word-like interface
        setCustomChecklist(null);
        setCustomChecklistPdf({ url: '', name: file.name, isWordDoc: true });
        alert('Word document uploaded! You can now edit the checklist directly in the editable document below.');
      };
      reader.onerror = () => {
        alert('Unable to read the Word document. Please try again.');
      };
      reader.readAsDataURL(file);
      return;
    }
    
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const pdfUrl = event.target?.result as string;
        setCustomChecklist(null);
        setCustomChecklistPdf({ url: pdfUrl, name: file.name, isWordDoc: false });
        alert('Checklist PDF uploaded. For better editing, consider uploading a Word document (.docx) instead.');
      };
      reader.onerror = () => {
        alert('Unable to read the PDF file. Please try again.');
      };
      reader.readAsDataURL(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = (event.target?.result as string) || '';
      try {
        let parsed = JSON.parse(text);
        if (
          !parsed ||
          !Array.isArray(parsed.courseOutline) ||
          !Array.isArray(parsed.bloomsTaxonomy) ||
          !Array.isArray(parsed.compliance)
        ) {
          throw new Error('Invalid checklist format');
        }
        setCustomChecklist(parsed);
        setCustomChecklistPdf(null);
        alert('Checklist uploaded successfully. Vetters will now use the new template.');
      } catch (error) {
        const lines = text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        if (lines.length === 0) {
          alert('Failed to parse checklist. Please upload a JSON, text, or PDF file with checklist items.');
          console.error('Checklist upload error:', error);
          return;
        }
        const fallbackChecklist = {
          courseOutline: lines,
          bloomsTaxonomy: lines,
          compliance: lines,
        };
        setCustomChecklist(fallbackChecklist);
        setCustomChecklistPdf(null);
        alert('Checklist uploaded as plain text. All sections will use the provided list.');
      }
    };
    reader.onerror = () => {
      alert('Unable to read the checklist file. Please try again.');
    };
    reader.readAsText(file);
  };

  const handleCompleteVetting = () => {
    if (!currentUserHasRole('Vetter')) {
      return;
    }
    if (!vettingSession.active || workflow.stage !== 'Vetting in Progress') {
      return;
    }
    const actor = currentUser?.name ?? 'Unknown';
    const completedAt = Date.now();
    const startedAt = vettingSession.startedAt || completedAt;
    const durationMinutes = vettingSession.durationMinutes || DEFAULT_SESSION_MINUTES;
    
    // Find the paper being vetted
    const vettedPaper = submittedPapers.find(p => p.status === 'in-vetting');
    
    // Create vetting session record
    if (vettedPaper) {
      const sessionRecord: VettingSessionRecord = {
        id: createId(),
        paperId: vettedPaper.id,
        paperName: vettedPaper.fileName,
        courseCode: vettedPaper.courseCode || 'Unknown',
        courseUnit: vettedPaper.courseUnit || 'Unknown',
        startedAt,
        completedAt,
        durationMinutes,
        vetters: Array.from((vetterMonitoring || new Map()).entries()).map(([vetterId, monitoring]) => {
          // CRITICAL: Ensure ALL warnings are captured - deep copy to prevent any loss
          const allWarnings = monitoring.warnings ? [...monitoring.warnings] : [];
          // Count violations from critical warnings as backup, but prefer the tracked violations count
          const criticalWarningsCount = allWarnings.filter(w => w.severity === 'critical').length;
          const violations = typeof monitoring.violations === 'number' ? monitoring.violations : criticalWarningsCount;
          
          console.log(`📋 Recording vetter ${monitoring.vetterName}:`, {
            vetterId,
            warningsCount: allWarnings.length,
            violations,
            criticalWarningsCount,
            monitoringViolations: monitoring.violations,
            warnings: allWarnings.map(w => ({
              type: w.type,
              message: w.message,
              severity: w.severity,
              timestamp: new Date(w.timestamp).toLocaleString(),
            })),
          });
          
          return {
            vetterId,
            vetterName: monitoring.vetterName,
            joinedAt: monitoring.joinedAt,
            warnings: allWarnings, // ALL warnings recorded
            violations: violations, // ALL violations recorded - use tracked count or count from critical warnings
          };
        }),
        annotations: [...annotations],
        checklistComments: new Map(checklistComments),
        status: 'completed',
      };
      
      // Store the session record
      setVettingSessionRecords(prev => [sessionRecord, ...prev]);
      
      // Persist to localStorage (convert Map to object for JSON)
      try {
        const existing = JSON.parse(localStorage.getItem('ucu-vetting-records') || '[]');
        const recordToSave = {
          ...sessionRecord,
          checklistComments: Object.fromEntries(sessionRecord.checklistComments),
        };
        existing.unshift(recordToSave);
        localStorage.setItem('ucu-vetting-records', JSON.stringify(existing.slice(0, 50))); // Keep last 50
      } catch (error) {
        console.error('Error saving vetting record:', error);
      }
    }
    
    // Stop camera stream for current user immediately
    if (currentUser?.id) {
      const stream = vetterCameraStreams.current.get(currentUser.id);
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        vetterCameraStreams.current.delete(currentUser.id);
        console.log(`📹 Stopped camera stream for vetter ${currentUser.id}`);
      }
    }
    
    // Stop global monitoring camera stream if it exists
    if ((window as any).__vettingCameraStream) {
      const globalStream = (window as any).__vettingCameraStream as MediaStream;
      globalStream.getTracks().forEach(track => track.stop());
      delete (window as any).__vettingCameraStream;
      console.log('📹 Stopped global monitoring camera stream');
    }
    
    // Disable safe browser mode and stop all camera streams
    setVettingSession((prev) => ({
      ...prev,
      active: false,
      safeBrowserEnabled: false,
      cameraOn: false,
      screenshotBlocked: false,
      switchingLocked: false,
      lastClosedReason: 'completed',
    }));
    
    setJoinedVetters((prev) => {
      const updated = new Set(prev);
      if (currentUser?.id) {
        updated.delete(currentUser.id);
      }
      return updated;
    });
    
    // Stop all remaining camera streams
    vetterCameraStreams.current.forEach((stream, vetterId) => {
      stream.getTracks().forEach(track => track.stop());
      vetterCameraStreams.current.delete(vetterId);
    });
    
    if (currentUser?.id) {
      logVetterWarning?.(
        currentUser.id,
        'window_leave',
        'Vetting session completed. Camera feed stopped and safe browser mode disabled.',
        'critical'
      );
    }
    
    // Update submitted papers status to 'vetted'
    setSubmittedPapers(prev => {
      const base = stripDemoPaper(prev);
      const updated = base.map(paper =>
        paper.status === 'in-vetting'
          ? { ...paper, status: 'vetted' as const }
          : paper
      );
      return ensureDemoPaper(updated);
    });
    
    if (vettedPaper) {
      void syncPaperStatusToSupabase(vettedPaper.id, 'vetted_with_comments');
    }
    
    pushWorkflowEvent(
      'Returned annotated paper and digital moderation log to Chief Examiner.',
      actor,
      { stage: 'Vetted & Returned to Chief Examiner' }
    );
    appendVersionHistory(
      actor,
      `Vetting complete with ${annotations.length} inline annotations.`
    );

    // Notify Chief Examiner that vetting is complete
    const completionMessage = `Vetter ${actor} completed vetting with ${annotations.length} annotation(s). Paper is ready for review.`;
    users
      .filter((u) => u.roles.includes('Chief Examiner'))
      .forEach((chief) => {
        if (chief.id) {
          void createNotification({
            user_id: chief.id,
            title: 'Vetting Completed',
            message: completionMessage,
            type: 'success',
          });
        }
      });

    // Auto-forward comments to team lead when session completes (if comments exist)
    if (checklistComments && checklistComments.size > 0) {
      const payload = buildChecklistExportPayload({
        comments: checklistComments,
        hasCustomChecklistPdf: Boolean(customChecklistPdf?.url),
      });
      if (payload) {
        const teamLeads = users.filter((u) => u.roles.includes('Team Lead') && u.id);
        teamLeads.forEach((teamLead) => {
          if (teamLead.id) {
            void createNotification({
              user_id: teamLead.id,
              title: 'Vetting Feedback Packet',
              message: `Vetting session completed. Comments and checklist attached.\n\n${payload}`,
              type: 'warning',
            });
          }
        });
        pushWorkflowEvent(
          'Vetting comments and annotated checklist forwarded to Team Lead.',
          actor
        );
      }
    }
  };

  const handleChecklistDownload = useCallback(() => {
    // Only allow download if Chief Examiner has made a decision
    if (!workflow.lastDecision) {
      alert('Checklist can only be downloaded after Chief Examiner makes a decision (Approve or Reject).');
      return;
    }

    if (checklistComments.size === 0) {
      alert('No checklist comments to download yet.');
      return;
    }

    // Find the vetted paper to get course information
    const vettedPaper = submittedPapers.find(p => p.status === 'vetted' || p.status === 'approved');
    
    // Generate PDF with UCU cover page
    const pdf = generateChecklistPDF({
      comments: checklistComments,
      hasCustomChecklistPdf: Boolean(customChecklistPdf?.url),
      hideVetterNames: false,
      decision: workflow.lastDecision.type,
      courseCode: vettedPaper?.courseCode,
      courseUnit: vettedPaper?.courseUnit,
      paperName: vettedPaper?.fileName,
      decisionNotes: workflow.lastDecision.notes,
      decisionActor: workflow.lastDecision.actor,
      decisionTimestamp: workflow.lastDecision.timestamp,
    });

    if (!pdf) {
      alert('Failed to generate PDF. Please try again.');
      return;
    }

    // Generate filename with decision status
    const dateStr = new Date().toISOString().split('T')[0];
    const decisionStr = workflow.lastDecision.type.toLowerCase();
    const filename = `UCU-Moderation-Checklist-${decisionStr}-${dateStr}.pdf`;
    
    // Save PDF
    pdf.save(filename);
    alert('Moderation checklist PDF downloaded successfully!');
  }, [checklistComments, customChecklistPdf, workflow.lastDecision, submittedPapers]);

  const forwardChecklistPacketToTeamLead = useCallback(
    (notes: string) => {
      // Hide vetter names when forwarding to team lead
      const payload = buildChecklistExportPayload({
        comments: checklistComments,
        hasCustomChecklistPdf: Boolean(customChecklistPdf?.url),
        hideVetterNames: true,
      });
      if (!payload) {
        alert('No checklist comments are available to forward. Ask the vetters to capture their remarks first.');
        return false;
      }

      const actor = currentUser?.name ?? 'Chief Examiner';
      const teamLeads = users.filter((u) => u.roles.includes('Team Lead') && u.id);
      if (teamLeads.length === 0) {
        alert('No Team Lead accounts are available to receive the forwarded checklist.');
        return false;
      }

      // Mark checklist as forwarded and persist to localStorage
      setChecklistForwardedToTeamLead(true);
      try {
        localStorage.setItem('ucu-checklist-forwarded', 'true');
      } catch (error) {
        console.error('Error saving checklist forwarded state:', error);
      }

      // Send notifications to Team Leads
      teamLeads.forEach((teamLead) => {
        if (!teamLead.id) return;
        void createNotification({
          user_id: teamLead.id,
          title: 'Moderation Checklist Available',
          message: `Chief Examiner ${actor} has forwarded the moderation checklist with vetting feedback. You can now download the moderation results.${notes ? `\n\nNotes: ${notes}` : ''}`,
          type: 'info',
        });
      });

      pushWorkflowEvent(
        'Forwarded vetting comments and annotated checklist back to Team Lead for action.',
        actor
      );
      
      // Toast notification for Chief Examiner
      const toast: AppNotification = {
        id: createId(),
        message: `Moderation checklist successfully forwarded to ${teamLeads.length} Team Lead(s). They will receive a notification and can now download the moderation results.`,
        timestamp: new Date().toISOString(),
        read: false,
        title: 'Checklist Forwarded',
        type: 'success',
      };
      setNotifications((prev) => [toast, ...prev].slice(0, 20));
      setActiveToast(toast);

      return true;
    },
    [checklistComments, customChecklistPdf, currentUser?.name, users]
  );

  const handleForwardChecklistDecision = (decision: 'approved' | 'rejected', notes: string) => {
    if (decision === 'approved') {
      handleApprove(notes);
    } else {
      const forwarded = forwardChecklistPacketToTeamLead(notes);
      if (!forwarded) {
        return;
      }
      handleReject(notes, undefined);
    }
  };

  const handleVettingExpired = () => {
    // Save records for all joined vetters before ending session
    const vettedPaper = submittedPapers.find(p => p.status === 'in-vetting');
    
    if (vettedPaper && vettingSession.startedAt) {
      const completedAt = Date.now();
      const startedAt = vettingSession.startedAt;
      const durationMinutes = vettingSession.durationMinutes || DEFAULT_SESSION_MINUTES;
      
      // Create vetting session record with all vetter data
      const sessionRecord: VettingSessionRecord = {
        id: createId(),
        paperId: vettedPaper.id,
        paperName: vettedPaper.fileName,
        courseCode: vettedPaper.courseCode || 'Unknown',
        courseUnit: vettedPaper.courseUnit || 'Unknown',
        startedAt,
        completedAt,
        durationMinutes,
        vetters: Array.from((vetterMonitoring || new Map()).entries()).map(([vetterId, monitoring]) => {
          // CRITICAL: Ensure ALL warnings are captured - deep copy to prevent any loss
          const allWarnings = monitoring.warnings ? [...monitoring.warnings] : [];
          // Count violations from critical warnings as backup, but prefer the tracked violations count
          const criticalWarningsCount = allWarnings.filter(w => w.severity === 'critical').length;
          const violations = typeof monitoring.violations === 'number' ? monitoring.violations : criticalWarningsCount;
          
          console.log(`📋 Recording vetter ${monitoring.vetterName} (expired session):`, {
            vetterId,
            warningsCount: allWarnings.length,
            violations,
            criticalWarningsCount,
            monitoringViolations: monitoring.violations,
            warnings: allWarnings.map(w => ({
              type: w.type,
              message: w.message,
              severity: w.severity,
              timestamp: new Date(w.timestamp).toLocaleString(),
            })),
          });
          
          return {
            vetterId,
            vetterName: monitoring.vetterName,
            joinedAt: monitoring.joinedAt,
            warnings: allWarnings, // ALL warnings recorded
            violations: violations, // ALL violations recorded - use tracked count or count from critical warnings
          };
        }),
        annotations: [...annotations],
        checklistComments: new Map(checklistComments),
        status: 'expired',
      };
      
      // Store the session record
      setVettingSessionRecords(prev => [sessionRecord, ...prev]);
      
      // Persist to localStorage (convert Map to object for JSON)
      try {
        const existing = JSON.parse(localStorage.getItem('ucu-vetting-records') || '[]');
        const recordToSave = {
          ...sessionRecord,
          checklistComments: Object.fromEntries(sessionRecord.checklistComments),
        };
        existing.unshift(recordToSave);
        localStorage.setItem('ucu-vetting-records', JSON.stringify(existing.slice(0, 50))); // Keep last 50
      } catch (error) {
        console.error('Error saving vetting record:', error);
      }
      
      // Update submitted papers status to 'vetted' when session expires
      setSubmittedPapers(prev => {
        const base = stripDemoPaper(prev);
        const updated = base.map(paper =>
          paper.status === 'in-vetting'
            ? { ...paper, status: 'vetted' as const }
            : paper
        );
        return ensureDemoPaper(updated);
      });
      
      void syncPaperStatusToSupabase(vettedPaper.id, 'vetted_with_comments');
    }
    
    // Stop all camera streams for all vetters
    vetterCameraStreams.current.forEach((stream, vetterId) => {
      stream.getTracks().forEach(track => track.stop());
      console.log(`📹 Stopped camera stream for vetter ${vetterId}`);
    });
    vetterCameraStreams.current.clear();
    
    // Stop global monitoring camera stream if it exists
    if ((window as any).__vettingCameraStream) {
      const globalStream = (window as any).__vettingCameraStream as MediaStream;
      globalStream.getTracks().forEach(track => track.stop());
      delete (window as any).__vettingCameraStream;
      console.log('📹 Stopped global monitoring camera stream (session expired)');
    }
    
    // Remove all vetters from joined set
    setJoinedVetters(new Set());
    
    // Clear monitoring data
    setVetterMonitoring(new Map());
    
    // End the session and disable safe browser mode
    setVettingSession((prev) => ({
      ...prev,
      active: false,
      safeBrowserEnabled: false,
      cameraOn: false,
      screenshotBlocked: false,
      switchingLocked: false,
      lastClosedReason: 'expired',
    }));
    
    pushWorkflowEvent(
      'Vetting window expired — all vetter sessions terminated automatically. Records saved and cameras stopped.',
      'System',
      { stage: 'Vetting Session Expired' }
    );
    
    // Show notification to all users
    const notification: AppNotification = {
      id: createId(),
      message: 'Vetting Session Expired: Session time finished. All vetter records have been saved and cameras stopped.',
      timestamp: new Date().toISOString(),
      read: false,
      title: 'Session Expired',
      type: 'warning',
    };
    setNotifications((prev) => [notification, ...prev]);
    setActiveToast(notification);
  };

  const handleSanitizeAndForward = async () => {
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
    
    // Find vetted papers to get their exam paper IDs
    const vettedPapers = submittedPapers.filter(p => p.status === 'vetted');
    
    if (vettedPapers.length === 0) {
      console.warn('⚠️ No vetted papers found to notify team lead about');
      return;
    }

    // Get team_lead_id from the database for each vetted paper
    const teamLeadIds = new Set<string>();
    
    for (const paper of vettedPapers) {
      try {
        // Get exam paper from database to find the assigned team lead
        const { data: examPaper, error } = await supabase
          .from('exam_papers')
          .select('team_lead_id, course_code, course_name')
          .eq('id', paper.id)
          .single();

        if (error) {
          console.error(`Error fetching exam paper ${paper.id}:`, error);
          continue;
        }

        if (examPaper?.team_lead_id) {
          teamLeadIds.add(examPaper.team_lead_id);
          console.log(`📋 Found team lead ${examPaper.team_lead_id} for paper ${paper.id} (${examPaper.course_code})`);
        } else {
          console.warn(`⚠️ No team_lead_id found for exam paper ${paper.id}`);
        }
      } catch (error) {
        console.error(`Error processing paper ${paper.id}:`, error);
      }
    }

    // If no team lead IDs found in database, fall back to notifying all team leads
    if (teamLeadIds.size === 0) {
      console.warn('⚠️ No team lead IDs found in database, notifying all team leads as fallback');
      users
        .filter((u) => u.roles.includes('Team Lead'))
        .forEach(async (teamLead) => {
          if (teamLead.id) {
            const result = await createNotification({
              user_id: teamLead.id,
              title: 'Modulation Results Received',
              message: `Chief Examiner ${actor} has sent sanitized modulation results. Please review and proceed with revisions.`,
              type: 'info',
            });
            if (!result.success) {
              console.error('Failed to create notification for Team Lead:', result.error);
            } else {
              console.log('✅ Notification sent to Team Lead (fallback):', teamLead.name);
            }
          }
        });
      return;
    }

    // Notify the specific team lead(s) assigned to the exam paper(s)
    for (const teamLeadId of teamLeadIds) {
      const result = await createNotification({
        user_id: teamLeadId,
        title: 'Modulation Results Received',
        message: `Chief Examiner ${actor} has sent sanitized modulation results. Please review and proceed with revisions.`,
        type: 'info',
      });
      
      if (!result.success) {
        console.error(`❌ Failed to create notification for Team Lead ${teamLeadId}:`, result.error);
      } else {
        const teamLeadUser = users.find(u => u.id === teamLeadId);
        console.log(`✅ Notification sent to Team Lead: ${teamLeadUser?.name || teamLeadId}`);
      }
    }
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
    
    // Notify Chief Examiner that revisions are complete
    users
      .filter((u) => u.roles.includes('Chief Examiner'))
      .forEach(async (chiefExaminer) => {
        if (chiefExaminer.id) {
          const result = await createNotification({
            user_id: chiefExaminer.id,
            title: 'Revisions Completed',
            message: `Team Lead ${actor} has completed revisions and submitted for final review.`,
            type: 'info',
          });
          if (!result.success) {
            console.error('Failed to create notification for Chief Examiner:', result.error);
          } else {
            console.log('✅ Notification sent to Chief Examiner:', chiefExaminer.name);
          }
        }
      });
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
    // Allow approval from both "Vetted & Returned to Chief Examiner" and "Awaiting Approval" stages
    if (workflow.stage !== 'Awaiting Approval' && workflow.stage !== 'Vetted & Returned to Chief Examiner') {
      return;
    }
    const actor = currentUser?.name ?? 'Unknown';
    const timestamp = new Date().toISOString();
    
    // Find vetted papers
    const vettedPapers = submittedPapers.filter(p => p.status === 'vetted');
    
    // Update submitted papers status to 'approved' and add to archive
    setSubmittedPapers(prev => {
      const base = stripDemoPaper(prev);
      const updated = base.map(paper =>
        paper.status === 'vetted'
          ? { ...paper, status: 'approved' as const }
          : paper
      );
      return ensureDemoPaper(updated);
    });
    
    // Add approved papers to archive for AI similarity checking
    vettedPapers.forEach(paper => {
      const archivedPaper = {
        ...paper,
        status: 'approved' as const,
        archivedAt: new Date().toISOString(),
        archivedBy: actor,
      };
      setArchivedPapers(prev => {
        const updated = [archivedPaper, ...prev];
        // Persist to localStorage
        try {
          localStorage.setItem('ucu-archived-papers', JSON.stringify(updated.slice(0, 1000))); // Keep last 1000
        } catch (error) {
          console.error('Error saving archived papers:', error);
        }
        return updated;
      });
    });
    
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
    
    // Notify Team Lead (without forwarding comments - vetting was positive)
    users
      .filter((u) => u.roles.includes('Team Lead'))
      .forEach((teamLead) => {
        if (teamLead.id) {
          void createNotification({
            user_id: teamLead.id,
            title: 'Paper Approved',
            message: `Paper has been approved for printing by ${actor}. Vetting was positive - no comments to address.${notes ? ` Notes: ${notes}` : ''}`,
            type: 'success',
          });
        }
      });
  };

  const handleReject = async (notes: string, newDeadline?: { days: number; hours: number; minutes: number }) => {
    if (!currentUserHasRole('Chief Examiner')) {
      return;
    }
    // Allow rejection from both "Vetted & Returned to Chief Examiner" and "Awaiting Approval" stages
    if (workflow.stage !== 'Awaiting Approval' && workflow.stage !== 'Vetted & Returned to Chief Examiner') {
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
    // If rejection is from "Vetted & Returned" stage, send feedback to Team Lead with new deadline
    if (workflow.stage === 'Vetted & Returned to Chief Examiner') {
      // Set new deadline for Team Lead - use provided deadline or default to 7 days
      const deadlineToUse = newDeadline || { days: 7, hours: 0, minutes: 0 };
      setTeamLeadDeadlineActive(true);
      setTeamLeadDeadlineStartTime(Date.now());
      setTeamLeadDeadlineDuration(deadlineToUse);
      
      // Update papers status back to 'submitted' so Team Lead can revise
      setSubmittedPapers(prev => {
        const base = stripDemoPaper(prev);
        const updated = base.map(paper =>
          paper.status === 'vetted'
            ? { ...paper, status: 'submitted' as const }
            : paper
        );
        return ensureDemoPaper(updated);
      });
      
      // Update workflow stage back to Team Lead
      pushWorkflowEvent(
        `Rejected and returned to Team Lead for revision. Feedback: ${notes || 'See annotations for details.'}`,
        actor,
        {
          stage: 'Submitted to Team Lead',
          mutate: () => ({
            portalOpen: false,
            awaitingRecycle: false,
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
          ? `Rejected and returned to Team Lead. Feedback: ${notes}`
          : 'Rejected and returned to Team Lead for revision.'
      );
      
      // Get all vetter comments from the session record
      const vettedPaper = submittedPapers.find(p => p.status === 'vetted');
      const sessionRecord = vettedPaper 
        ? vettingSessionRecords.find(r => r.paperId === vettedPaper.id)
        : null;
      
      // Collect all comments from vetters
      let vetterCommentsText = '\n\n=== REJECTED ===\n\nVetter Comments:\n';
      if (sessionRecord) {
        // Add annotations
        if (sessionRecord.annotations.length > 0) {
          vetterCommentsText += '\nAnnotations:\n';
          sessionRecord.annotations.forEach(ann => {
            vetterCommentsText += `- ${ann.author}: "${ann.comment}"\n`;
          });
        }
        
        // Add checklist comments
        if (sessionRecord.checklistComments.size > 0) {
          vetterCommentsText += '\nChecklist Comments:\n';
          sessionRecord.checklistComments.forEach((comment, key) => {
            const [category, item] = key.split('-');
            vetterCommentsText += `- ${category} - ${item}: ${comment.vetterName} - "${comment.comment}"\n`;
          });
        }
        
        // Add warnings/violations
        sessionRecord.vetters.forEach(vetter => {
          if (vetter.warnings.length > 0) {
            vetterCommentsText += `\n${vetter.vetterName} - Warnings:\n`;
            vetter.warnings.forEach(w => {
              vetterCommentsText += `  - ${w.type}: ${w.message}\n`;
            });
          }
        });
      }
      
      // Notify Team Lead with all comments - ensure delivery to all Team Leads
      const deadlineText = newDeadline 
        ? `\n\nNew deadline: ${newDeadline.days} day(s), ${newDeadline.hours} hour(s), ${newDeadline.minutes} minute(s).`
        : '';
      const rejectionMessage = `=== REJECTED ===\n\nPaper rejected by Chief Examiner ${actor}.\n\nFeedback: ${notes || 'See annotations for details.'}${deadlineText}${vetterCommentsText}`;
      
      // Fetch Team Leads directly from Supabase to ensure we have the latest data
      let teamLeadIds: string[] = [];
      try {
        console.log('📤 Fetching Team Leads from Supabase...');
        // Fetch all user profiles and filter for Team Leads in JavaScript
        // This is more reliable than trying to use array operators
        const { data: allProfiles, error: profilesError } = await supabase
          .from('user_profiles')
          .select('id, roles');
        
        if (profilesError) {
          console.error('❌ Error fetching user profiles from Supabase:', profilesError);
          // Fallback to local users array
          teamLeadIds = users
            .filter((u) => u.roles.includes('Team Lead') && u.id)
            .map((u) => u.id!);
        } else {
          // Filter for users with 'Team Lead' in their roles array
          teamLeadIds = (allProfiles || [])
            .filter((profile: any) => {
              const roles = profile.roles || [];
              return Array.isArray(roles) && roles.includes('Team Lead');
            })
            .map((profile: any) => profile.id);
          console.log(`✅ Found ${teamLeadIds.length} Team Lead(s) in database:`, teamLeadIds);
        }
        
        // If no Team Leads found in Supabase, try local users as fallback
        if (teamLeadIds.length === 0) {
          console.warn('⚠️ No Team Leads found in Supabase, trying local users array...');
          teamLeadIds = users
            .filter((u) => u.roles.includes('Team Lead') && u.id)
            .map((u) => u.id!);
          console.log(`📋 Found ${teamLeadIds.length} Team Lead(s) in local users:`, teamLeadIds);
        }
      } catch (error: any) {
        console.error('❌ Exception fetching Team Leads:', error);
        // Fallback to local users array
        teamLeadIds = users
          .filter((u) => u.roles.includes('Team Lead') && u.id)
          .map((u) => u.id!);
      }
      
      if (teamLeadIds.length === 0) {
        console.error('❌ No Team Leads found! Cannot send rejection notification.');
        const errorToast: AppNotification = {
          id: createId(),
          message: 'No Team Leads found in the system. Please ensure Team Leads are assigned.',
          timestamp: new Date().toISOString(),
          read: false,
          title: 'No Team Leads Found',
          type: 'error',
        };
        setNotifications((prev) => [errorToast, ...prev].slice(0, 20));
        setActiveToast(errorToast);
        return;
      }
      
      console.log(`📨 Sending rejection notifications to ${teamLeadIds.length} Team Lead(s)...`);
      const notificationPromises = teamLeadIds.map((teamLeadId) => {
        console.log(`📤 Creating notification for Team Lead: ${teamLeadId}`);
        return createNotification({
          user_id: teamLeadId,
          title: 'Paper Rejected - Revision Required',
          message: rejectionMessage,
          type: 'warning',
        });
      });
      
      // Wait for all notifications to be sent
      const results = await Promise.allSettled(notificationPromises);
      const successful = results.filter((r) => r.status === 'fulfilled' && r.value.success);
      const failed = results.filter((r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success));
      const successCount = successful.length;
      const totalCount = teamLeadIds.length;
      
      console.log(`✅ Notification results: ${successCount} succeeded, ${failed.length} failed out of ${totalCount} total`);
      
      // Log any failures for debugging
      failed.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value.error) {
          console.error(`❌ Failed to notify Team Lead ${teamLeadIds[index]}:`, result.value.error);
        } else if (result.status === 'rejected') {
          console.error(`❌ Exception notifying Team Lead ${teamLeadIds[index]}:`, result.reason);
        }
      });
      
      // Show success toast notification to Chief Examiner
      if (successCount > 0) {
        const successToast: AppNotification = {
          id: createId(),
          message: `Rejection successfully sent to ${successCount} Team Lead(s). ${failed.length > 0 ? `(${failed.length} failed - check console for details)` : ''}`,
          timestamp: new Date().toISOString(),
          read: false,
          title: 'Rejection Delivered',
          type: 'success',
        };
        setNotifications((prev) => [successToast, ...prev].slice(0, 20));
        setActiveToast(successToast);
      } else {
        // Show error toast if no notifications were sent
        const errorToast: AppNotification = {
          id: createId(),
          message: `Failed to send rejection notification to all ${totalCount} Team Lead(s). Please check console for errors and try again.`,
          timestamp: new Date().toISOString(),
          read: false,
          title: 'Notification Failed',
          type: 'error',
        };
        setNotifications((prev) => [errorToast, ...prev].slice(0, 20));
        setActiveToast(errorToast);
      }
    } else {
      // Original rejection logic for "Awaiting Approval" stage
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
    }
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
    const newAnnotation = {
        id: createId(),
        author: currentUser.name,
        comment: trimmed,
        timestamp: new Date().toISOString(),
    };
    setAnnotations((prev) => [newAnnotation, ...prev]);

    // Notify Chief Examiner and other vetters about new annotation
    const annotationMessage = `${currentUser.name} added a comment: "${trimmed.substring(0, 100)}${trimmed.length > 100 ? '...' : ''}"`;
    users
      .filter((u) => (u.roles.includes('Chief Examiner') || u.roles.includes('Vetter')) && u.id !== currentUser.id)
      .forEach((user) => {
        if (user.id) {
          void createNotification({
            user_id: user.id,
            title: 'New Annotation Added',
            message: annotationMessage,
            type: 'info',
          });
        }
      });
  };

  // Calculate moderation countdowns
  const moderationStartCountdown = useMemo(() => {
    if (!moderationSchedule.scheduled || !moderationSchedule.scheduledStartTime) {
      return null;
    }
    const now = currentTime;
    const startTime = moderationSchedule.scheduledStartTime;
    
    if (now >= startTime) {
      return null; // Moderation has started
    }
    
    const remaining = startTime - now;
    const hours = Math.floor(remaining / (60 * 60 * 1000));
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
    const seconds = Math.floor((remaining % (60 * 1000)) / 1000);
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }, [moderationSchedule, currentTime]);

  const moderationEndCountdown = useMemo(() => {
    if (!moderationSchedule.scheduled || !moderationSchedule.scheduledEndTime || !moderationSchedule.scheduledStartTime) {
      return null;
    }
    const now = currentTime;
    const startTime = moderationSchedule.scheduledStartTime;
    const endTime = moderationSchedule.scheduledEndTime;
    
    if (now < startTime) {
      return null; // Moderation hasn't started yet
    }
    
    if (now >= endTime) {
      return '00:00:00'; // Moderation has ended
    }
    
    const remaining = endTime - now;
    const hours = Math.floor(remaining / (60 * 60 * 1000));
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
    const seconds = Math.floor((remaining % (60 * 1000)) / 1000);
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }, [moderationSchedule, currentTime]);

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
          users={users}
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
          restrictedVetters={restrictedVetters}
          onReactivateVetter={(vetterId) => {
            setRestrictedVetters(prev => {
              const newSet = new Set(prev);
              newSet.delete(vetterId);
              localStorage.setItem('ucu-restricted-vetters', JSON.stringify(Array.from(newSet)));
              return newSet;
            });
          }}
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
          submittedPapers={submittedPapers}
          setSubmittedPapers={setSubmittedPapers}
        />
      ),
    });

    roleSpecificPanels.push({
      id: 'repository-papers',
      label: 'Repository Papers',
      visible: true,
      render: () => (
        <RepositoryPapersPanel repositoryPapers={repositoryPapers} users={users} />
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
          submittedPapers={submittedPapers.filter(
            (p) => p.courseUnit === currentUser?.courseUnit
          )}
          // Show all setter submissions relevant to this workflow so the Team Lead
          // can see the true count of drafts coming in from Setters.
          setterSubmissions={setterSubmissions}
          users={users}
          teamLeadDeadlineActive={teamLeadDeadlineActive}
          teamLeadDeadlineStartTime={teamLeadDeadlineStartTime}
          teamLeadDeadlineDuration={teamLeadDeadlineDuration}
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
          submittedPapers={submittedPapers.filter(
            (p) => p.courseUnit === currentUser?.courseUnit
          )}
          setterSubmissions={setterSubmissions}
          workflowStage={workflow.stage}
          onSubmitPDF={handleTeamLeadSubmitPDF}
          checklistForwarded={checklistForwardedToTeamLead}
          vettingSessionRecords={vettingSessionRecords}
          customChecklistPdf={customChecklistPdf}
        />
      ),
    });
  }

  if (isAuthenticated && showWorkflowInterfaces && !isPureLecturer && !currentUserHasRole('Team Lead') && !currentUserHasRole('Setter')) {
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

  if (isAuthenticated && showVettingInterfaces && !isPureLecturer) {
    roleSpecificPanels.push({
      id: 'vetting-suite',
      label: 'Vetting & Annotations',
      visible: true,
      render: () => (
        <VettingAndAnnotations
          workflowStage={workflow.stage}
          workflow={workflow}
          vettingSession={vettingSession}
          annotations={annotations}
          safeBrowserPolicies={safeBrowserPolicies}
          checklist={activeChecklist}
          customChecklistPdf={customChecklistPdf}
          vettingCountdown={vettingCountdown}
          userHasRole={currentUserHasRole}
          onStartVetting={handleStartVetting}
          onCompleteVetting={handleCompleteVetting}
          onAddAnnotation={handleAddAnnotation}
          submittedPapers={submittedPapers.filter(p => p.status === 'in-vetting' || p.status === 'vetted')}
          moderationSchedule={moderationSchedule}
          onScheduleModeration={handleScheduleModeration}
          moderationStartCountdown={moderationStartCountdown}
          moderationEndCountdown={moderationEndCountdown}
          currentUserId={currentUser?.id}
          joinedVetters={joinedVetters}
          restrictedVetters={restrictedVetters}
          vetterMonitoring={vetterMonitoring}
          logVetterWarning={logVetterWarning}
          users={users}
          onReactivateVetter={(vetterId) => {
            setRestrictedVetters(prev => {
              const newSet = new Set(prev);
              newSet.delete(vetterId);
              localStorage.setItem('ucu-restricted-vetters', JSON.stringify(Array.from(newSet)));
              return newSet;
            });
          }}
          checklistComments={checklistComments}
          typingIndicators={checklistTypingIndicators}
          checklistDraftText={checklistDraftText}
          onChecklistCommentChange={(key, comment, color = '#3B82F6') => {
            let entry: ChecklistComment | null = null;
            setChecklistComments((prev) => {
              const updated = new Map(prev);
              if (comment) {
                entry = {
                  comment,
                  vetterName: currentUser?.name || 'Unknown',
                  timestamp: Date.now(),
                  color,
                };
                updated.set(key, entry);
              } else {
                updated.delete(key);
              }
              return updated;
            });
            broadcastChecklistCommentUpdate(key, entry);
            // Clear draft text when comment is saved
            if (comment && currentUser?.id) {
              setChecklistDraftText((prev) => {
                const next = new Map(prev);
                const existing = next.get(key);
                if (existing) {
                  const updated = new Map(existing);
                  updated.delete(currentUser.id);
                  if (updated.size > 0) {
                    next.set(key, updated);
                  } else {
                    next.delete(key);
                  }
                }
                return next;
              });
            }
            if (!comment) {
              handleChecklistTypingChange(key, false);
            }
          }}
          onChecklistTypingChange={handleChecklistTypingChange}
          onChecklistDraftChange={broadcastDraftTextUpdate}
          onDownloadChecklistPacket={handleChecklistDownload}
          onUploadChecklist={handleUploadChecklistFile}
          onRemoveChecklist={handleRemoveChecklist}
          onRemovePaperFromVetting={handleRemovePaperFromVetting}
          onEndSession={() => {
            // Save vetting session record with all checklist comments before ending
            const vettedPaper = submittedPapers.find(p => p.status === 'in-vetting');
            
            if (vettedPaper && vettingSession.startedAt) {
              const completedAt = Date.now();
              const startedAt = vettingSession.startedAt;
              const durationMinutes = vettingSession.durationMinutes || DEFAULT_SESSION_MINUTES;
              
              // Create vetting session record with all vetter data and checklist comments
              const sessionRecord: VettingSessionRecord = {
                id: createId(),
                paperId: vettedPaper.id,
                paperName: vettedPaper.fileName,
                courseCode: vettedPaper.courseCode || 'Unknown',
                courseUnit: vettedPaper.courseUnit || 'Unknown',
                startedAt,
                completedAt,
                durationMinutes,
                vetters: Array.from((vetterMonitoring || new Map()).entries()).map(([vetterId, monitoring]) => {
                  const allWarnings = monitoring.warnings ? [...monitoring.warnings] : [];
                  const criticalWarningsCount = allWarnings.filter(w => w.severity === 'critical').length;
                  const violations = typeof monitoring.violations === 'number' ? monitoring.violations : criticalWarningsCount;
                  
                  return {
                    vetterId,
                    vetterName: monitoring.vetterName,
                    joinedAt: monitoring.joinedAt,
                    warnings: allWarnings,
                    violations: violations,
                  };
                }),
                annotations: [...annotations],
                checklistComments: new Map(checklistComments), // Save all checklist comments (section and item-level)
                status: 'terminated',
              };
              
              // Store the session record
              setVettingSessionRecords(prev => [sessionRecord, ...prev]);
              
              // Persist to localStorage
              try {
                const existing = JSON.parse(localStorage.getItem('ucu-vetting-records') || '[]');
                const recordToSave = {
                  ...sessionRecord,
                  checklistComments: Object.fromEntries(sessionRecord.checklistComments),
                };
                existing.unshift(recordToSave);
                localStorage.setItem('ucu-vetting-records', JSON.stringify(existing.slice(0, 50)));
              } catch (error) {
                console.error('Error saving vetting record:', error);
              }
              
              // Update submitted papers status to 'vetted'
              setSubmittedPapers(prev => {
                const base = stripDemoPaper(prev);
                const updated = base.map(paper =>
                  paper.status === 'in-vetting'
                    ? { ...paper, status: 'vetted' as const }
                    : paper
                );
                return ensureDemoPaper(updated);
              });
            }
            
            // Stop all camera streams for all vetters
            vetterCameraStreams.current.forEach((stream, vetterId) => {
              stream.getTracks().forEach(track => track.stop());
              console.log(`📹 Stopped camera stream for vetter ${vetterId} (session ended by Chief Examiner)`);
            });
            vetterCameraStreams.current.clear();
            
            // Stop global monitoring camera stream if it exists
            if ((window as any).__vettingCameraStream) {
              const globalStream = (window as any).__vettingCameraStream as MediaStream;
              globalStream.getTracks().forEach(track => track.stop());
              delete (window as any).__vettingCameraStream;
              console.log('📹 Stopped global monitoring camera stream (session ended by Chief Examiner)');
            }
            
            // End the global session and disable safe browser mode
            setVettingSession({
              active: false,
              safeBrowserEnabled: false,
              cameraOn: false,
              screenshotBlocked: false,
              switchingLocked: false,
              lastClosedReason: 'cancelled',
            });
            // Clear all joined vetters
            setJoinedVetters(new Set());
            // Clear monitoring data
            setVetterMonitoring(new Map());
            
            const actor = currentUser?.name ?? 'Unknown';
            pushWorkflowEvent(
              'Chief Examiner ended the vetting session. All vetter sessions have been terminated. All checklist comments and annotations have been saved.',
              actor
            );
          }}
          onForwardChecklist={handleForwardChecklistDecision}
          onApprove={handleApprove}
          onReject={handleReject}
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

  // Filter out workflow-related panels for pure lecturers
  const filteredRoleSpecificPanels = isPureLecturer
    ? roleSpecificPanels.filter(panel => {
        // Exclude any workflow-related panels
        const workflowPanelIds = [
          'workflow-execution',
          'vetting-suite',
          'chief-examiner-console',
          'chief-examiner-dashboard',
          'chief-examiner-track-paper',
          'repository-papers',
          'team-lead-panel',
          'team-lead-dashboard',
          'setter-panel',
        ];
        return !workflowPanelIds.includes(panel.id);
      })
    : roleSpecificPanels;

  const panelConfigs: PanelConfig[] = [
    ...(overviewPanel ? [overviewPanel] : []),
    // Only add lecturerRoleDashboard if it's different from overviewPanel (for non-pure lecturers)
    ...(lecturerRoleDashboard && lecturerRoleDashboard.id !== overviewPanel?.id ? [lecturerRoleDashboard] : []),
    ...(isAdmin ? adminPanels : []),
    ...(chiefExaminerPrivilegePanel ? [chiefExaminerPrivilegePanel] : []),
    // Show lecturer panels to anyone with Lecturer role or baseRole (including Chief Examiners)
    ...(isLecturer ? lecturerPanels : []),
    ...filteredRoleSpecificPanels,
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

  const _headingTitle = isPureLecturer
    ? 'Uganda Christian University'
    : isAdmin
    ? 'Admin Control Centre'
    : 'Control Centre';

  const _headingSubtitle =
    isPureLecturer
      ? 'Faculty of Computing & Informatics'
      : isAdmin
      ? 'Manage staff accounts, system settings, and administrative functions.'
      : 'Navigate workflow checkpoints and manage elevated privileges from one command hub.';

  // Check if current vetter has joined - hide sidebar and go fullscreen for vetters
  const isVetterActive = currentUserHasRole('Vetter') && currentUser?.id && joinedVetters.has(currentUser.id);

  return (
    <div className={`min-h-screen bg-white text-slate-900 flex ${isVetterActive ? 'fullscreen-vetter-mode' : ''}`}>
      {/* Overlay for mobile when sidebar is open */}
      {!isVetterActive && sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      
      {/* Hide sidebar when vetter has joined - fullscreen vetting mode */}
      {!isVetterActive && (
      <aside className={`${sidebarOpen ? 'translate-x-0 lg:w-72' : '-translate-x-full lg:translate-x-0 lg:w-20'} flex-col border-r border-blue-300 bg-[#2160F3] shadow-lg fixed left-0 top-0 h-screen z-50 transition-all duration-300 ease-in-out flex`}>
        <div className={`px-3 py-6 ${sidebarOpen ? '' : 'lg:px-2 lg:py-4'}`}>
          {/* Close button for mobile */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden absolute top-4 right-4 p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
            aria-label="Close menu"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          
          {/* Logo - Centered */}
          <div className={`mb-4 flex justify-center ${sidebarOpen ? '' : 'lg:hidden'}`}>
            <div className="bg-white rounded-lg p-2">
              <img
                src={ucuLogo}
                alt="UCU Logo"
                className="h-16 w-auto object-contain"
              />
            </div>
          </div>
          
          {/* Small logo for collapsed state */}
          <div className={`mb-4 hidden lg:flex justify-center ${sidebarOpen ? 'lg:hidden' : ''}`}>
            <div className="bg-white rounded-lg p-1">
              <img
                src={ucuLogo}
                alt="UCU Logo"
                className="h-8 w-auto object-contain"
              />
            </div>
          </div>
          
          {/* Main Title - Centered under logo */}
          <h1 className={`text-lg font-bold text-white mb-2 text-center ${sidebarOpen ? '' : 'lg:hidden'}`}>
            UCU E-Exam Manager
          </h1>
          
          {/* Subtitle */}
          <p className={`text-sm text-white/80 text-center ${sidebarOpen ? '' : 'lg:hidden'}`}>
            {currentUserHasRole('Lecturer') && !isAdmin
              ? 'Lecturer Portal'
              : isAdmin ? 'Admin Portal' : 'Digital Moderation'}
          </p>
        </div>
        <nav className={`flex-1 space-y-1 overflow-y-auto pb-6 ${sidebarOpen ? 'px-4' : 'lg:px-2'}`}>
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
              p.id === 'chief-examiner-track-paper' ||
              p.id === 'repository-papers'
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
                      const _labelParts = panel.label.split(' ');
                      return (
                        <button
                          key={panel.id}
                          type="button"
                          onClick={() => handlePanelSelect(panel.id)}
                          className={`flex w-full items-center ${sidebarOpen ? 'justify-between' : 'lg:justify-center'} rounded-xl border-2 ${sidebarOpen ? 'px-4' : 'lg:px-2'} py-3 text-left text-sm font-semibold transition-all shadow-lg mb-2 ${
                            isActive
                              ? 'border-pink-500/60 bg-gradient-to-r from-pink-500/20 via-rose-500/20 to-pink-500/20 text-pink-200 shadow-pink-500/30'
                              : 'border-pink-500/40 bg-gradient-to-r from-pink-500/10 via-rose-500/10 to-pink-500/10 text-pink-300 hover:border-pink-500/60 hover:bg-gradient-to-r hover:from-pink-500/20 hover:via-rose-500/20 hover:to-pink-500/20 hover:shadow-pink-500/40 hover:text-pink-200'
                          }`}
                        >
                          <span className={`flex items-center gap-1.5 ${sidebarOpen ? '' : 'lg:hidden'}`}>
                            <span className="inline-flex items-center gap-1">
                              <span className="animate-heartbeat text-pink-400 font-bold" style={{ animationDelay: '0s' }}>Submit</span>
                              <span className="animate-heartbeat text-pink-400 font-bold" style={{ animationDelay: '0.15s' }}>Draft</span>
                            </span>
                          </span>
                          <span className={`text-xs ${isActive ? 'text-pink-400' : 'text-pink-500/60'} ${sidebarOpen ? '' : 'lg:hidden'}`}>{isActive ? '•' : '↗'}</span>
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
                      className={`flex w-full items-center ${sidebarOpen ? 'gap-3' : 'lg:justify-center lg:gap-0'} rounded-xl border ${sidebarOpen ? 'px-4' : 'lg:px-2'} py-3 text-left text-sm font-medium transition-all ${
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
                      <span className={`flex-1 ${sidebarOpen ? '' : 'lg:hidden'}`}>{panel.label}</span>
                      <span className={`text-xs flex-shrink-0 ${isActive ? 'text-white' : 'text-blue-200'} ${sidebarOpen ? '' : 'lg:hidden'}`}>{isActive ? '•' : '↗'}</span>
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
                          className={`flex w-full items-center ${sidebarOpen ? 'justify-between' : 'lg:justify-center'} rounded-xl border-2 ${sidebarOpen ? 'px-4' : 'lg:px-2'} py-3 text-left text-sm font-semibold transition-all shadow-lg ${
                            isActive
                              ? 'border-violet-500/60 bg-gradient-to-r from-violet-500/20 via-purple-500/20 to-violet-500/20 text-violet-200 shadow-violet-500/30'
                              : 'border-violet-500/40 bg-gradient-to-r from-violet-500/10 via-purple-500/10 to-violet-500/10 text-violet-300 hover:border-violet-500/60 hover:bg-gradient-to-r hover:from-violet-500/20 hover:via-purple-500/20 hover:to-violet-500/20 hover:shadow-violet-500/40 hover:text-violet-200'
                          }`}
                        >
                          <span className={`flex items-center gap-1.5 ${sidebarOpen ? '' : 'lg:hidden'}`}>
                            <span className="inline-flex items-center gap-1">
                              <span className="animate-heartbeat text-violet-400 font-bold" style={{ animationDelay: '0s' }}>Team</span>
                              <span className="animate-heartbeat text-violet-400 font-bold" style={{ animationDelay: '0.15s' }}>Lead</span>
                            </span>
                            {submissionText && <span className="text-violet-300/90 ml-1">{submissionText}</span>}
                          </span>
                          <span className={`text-xs ${isActive ? 'text-violet-400' : 'text-violet-500/60'} ${sidebarOpen ? '' : 'lg:hidden'}`}>{isActive ? '•' : '↗'}</span>
                        </button>
                      );
                    })}
                  </>
                )}

                {/* Chief Examiner / Workflow Panels */}
                {filteredChiefExaminerPanels.length > 0 && (
                  <>
                    <div className={`mt-4 mb-2 px-2 ${sidebarOpen ? '' : 'lg:hidden'}`}>
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
                          className={`flex w-full items-center ${sidebarOpen ? 'justify-between' : 'lg:justify-center'} rounded-xl border-2 ${sidebarOpen ? 'px-4' : 'lg:px-2'} py-3 text-left text-sm font-semibold transition-all shadow-lg mb-2 ${
                            isActive
                              ? panelStyles.active
                              : panelStyles.inactive
                          }`}
                        >
                          <span className={`flex items-center gap-1.5 ${sidebarOpen ? '' : 'lg:hidden'}`}>
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
                              <span className={sidebarOpen ? '' : 'lg:hidden'}>{panel.label}</span>
                            )}
                          </span>
                          <span className={`text-xs ${isActive ? panelStyles.textColor : panelStyles.iconColor} ${sidebarOpen ? '' : 'lg:hidden'}`}>{isActive ? '•' : '↗'}</span>
                        </button>
                      );
                    })}
                  </>
                )}

                {/* Lecturer Panels */}
                {lecturerPanelsList.length > 0 && (
                  <>
                    <div className={`mt-4 mb-2 px-2 ${sidebarOpen ? '' : 'lg:hidden'}`}>
                      <p className="text-xs font-semibold uppercase tracking-wider text-blue-100">
                        Teaching & Classes
                      </p>
                    </div>
                    {lecturerPanelsList.map((panel, _index) => {
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
                          className={`group relative flex w-full items-center ${sidebarOpen ? 'gap-2' : 'lg:justify-center lg:gap-0'} rounded-xl border ${sidebarOpen ? 'px-3' : 'lg:px-2'} py-2 text-left text-xs font-semibold shadow-sm transition-all duration-200 ${
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
                          <span className={`relative flex-1 ${sidebarOpen ? '' : 'lg:hidden'}`}>
                            <span className="block text-[0.8rem]">
                              {panel.label}
                            </span>
                          </span>
                          <span className={`relative text-xs flex-shrink-0 ${isActive ? 'text-emerald-100' : 'text-blue-200/80 group-hover:text-emerald-100'} ${sidebarOpen ? '' : 'lg:hidden'}`}>
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
                    <div className={`mt-4 mb-2 px-2 ${sidebarOpen ? '' : 'lg:hidden'}`}>
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
                          className={`flex w-full items-center ${sidebarOpen ? 'justify-between' : 'lg:justify-center'} rounded-xl border ${sidebarOpen ? 'px-4' : 'lg:px-2'} py-2 text-left text-sm font-medium transition ${
                            isActive
                              ? 'border-blue-300 bg-blue-500 text-white shadow-md'
                              : 'border-transparent text-blue-100 hover:border-blue-300 hover:bg-blue-500/50 hover:text-white'
                          }`}
                        >
                          <span className={sidebarOpen ? '' : 'lg:hidden'}>{panel.label}</span>
                          <span className={`text-xs ${isActive ? 'text-white' : 'text-blue-200'} ${sidebarOpen ? '' : 'lg:hidden'}`}>{isActive ? '•' : '↗'}</span>
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
                      className={`flex w-full items-center ${sidebarOpen ? 'justify-between' : 'lg:justify-center'} rounded-xl border ${sidebarOpen ? 'px-4' : 'lg:px-2'} py-2 text-left text-sm font-medium transition ${
                        isActive
                          ? 'border-blue-300 bg-blue-500 text-white shadow-md'
                          : 'border-transparent text-blue-100 hover:border-blue-300 hover:bg-blue-500/50 hover:text-white'
                      }`}
                    >
                      <span className={sidebarOpen ? '' : 'lg:hidden'}>{panel.label}</span>
                      <span className={`text-xs ${isActive ? 'text-white' : 'text-blue-200'} ${sidebarOpen ? '' : 'lg:hidden'}`}>{isActive ? '•' : '↗'}</span>
                    </button>
                  );
                })}
              </>
            );
          })()}
        </nav>
      </aside>
      )}

      <div className={`flex-1 flex flex-col ${isVetterActive ? 'w-full' : sidebarOpen ? 'lg:ml-72' : 'lg:ml-20'}`}>
        <header className="relative border-b border-slate-200 bg-white px-4 py-5 backdrop-blur sm:px-6 lg:px-10 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            {/* Hamburger Menu Button - Mobile */}
            {!isVetterActive && (
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-white shadow-md border border-slate-200 hover:bg-slate-50 transition-colors"
                aria-label="Toggle menu"
              >
                <svg
                  className="w-6 h-6 text-slate-700"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  {sidebarOpen ? (
                    <path d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
            )}
            
            {/* Hamburger Menu Button - Desktop */}
            {!isVetterActive && (
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="hidden lg:flex items-center justify-center p-2 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors mr-4"
                aria-label="Toggle menu"
              >
                <svg
                  className="w-6 h-6 text-slate-700"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  {sidebarOpen ? (
                    <path d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
            )}
            
            <div className={!isVetterActive && sidebarOpen ? 'lg:ml-0' : ''}>
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
                  ? 'Chief Examiner'
                  : isTeamLead
                  ? 'Team Lead'
                  : isVetter
                  ? 'Vetting'
                  : isSetter
                  ? 'Setter'
                  : isPureLecturer
                  ? 'Teaching & Student Engagement'
                  : workflow.stage.replace(/-/g, ' ')}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {isAdmin
                  ? 'Manage staff accounts and system configuration'
                  : isChiefExaminer
                  ? 'Assign and manage the exam process'
                  : isTeamLead
                  ? 'Coordinate setters and manage submissions'
                  : isVetter
                  ? 'Review and vet exam papers'
                  : isSetter
                  ? 'Prepare and submit exam papers'
                  : isPureLecturer
                  ? 'Manage classes, students and reports'
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
                  onClick={async () => {
                    const wasOpen = showNotificationPanel;
                    setShowNotificationPanel((open) => !open);
                    
                    // If opening panel, refresh notifications and mark all as read in database
                    if (!wasOpen && currentUser) {
                      // Refresh notifications from database
                      try {
                        const dbNotifications = await getUserNotifications(currentUser.id);
                        const mapped: AppNotification[] = dbNotifications.map((n) => ({
                          id: n.id,
                          message: `${n.title}: ${n.message}`,
                          timestamp: n.created_at,
                          read: n.is_read,
                        }));
                        setNotifications(mapped);
                        
                        // Mark all as read in database if there are unread ones
                        const unreadCount = mapped.filter(n => !n.read).length;
                        if (unreadCount > 0) {
                          await markAllNotificationsAsRead(currentUser.id);
                    setNotifications((prev) =>
                      prev.map((n) => ({ ...n, read: true }))
                    );
                        }
                      } catch (error) {
                        console.error('Error refreshing notifications:', error);
                      }
                    } else if (!wasOpen) {
                      // Just mark local notifications as read if no user
                      setNotifications((prev) =>
                        prev.map((n) => ({ ...n, read: true }))
                      );
                    }
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
                      onClick={async () => {
                        // Mark notification as read when clicked
                        if (!note.read && currentUser) {
                          try {
                            await markNotificationAsRead(note.id);
                            setNotifications((prev) =>
                              prev.map((n) => 
                                n.id === note.id ? { ...n, read: true } : n
                              )
                            );
                          } catch (error) {
                            console.error('Error marking notification as read:', error);
                          }
                        }
                      }}
                      className={`group relative overflow-hidden rounded-xl border px-3 py-2 text-xs text-slate-800 shadow-sm transition-all duration-300 cursor-pointer ${
                        note.read
                          ? 'border-slate-100 bg-slate-50/80'
                          : 'border-blue-200 bg-gradient-to-r from-blue-50 via-indigo-50 to-cyan-50 shadow-[0_0_0_1px_rgba(129,140,248,0.35)]'
                      } hover:translate-y-[-1px] hover:shadow-md hover:shadow-blue-200/80`}
                    >
                      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-indigo-200/70 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                      {!note.read && (
                        <div className="absolute top-2 right-2 h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                      )}
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

        {/* Phone-style Toast Notification */}
        {activeToast && (
          <motion.div
            initial={{ opacity: 0, y: -50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed top-4 right-4 z-[9999] w-full max-w-sm"
          >
            <div
              className={`
                relative overflow-hidden rounded-2xl border-2 shadow-2xl backdrop-blur-md
                ${
                  activeToast.type === 'error'
                    ? 'border-red-500/50 bg-gradient-to-br from-red-50 via-red-50/95 to-red-100/90'
                    : activeToast.type === 'warning'
                    ? 'border-amber-500/50 bg-gradient-to-br from-amber-50 via-amber-50/95 to-amber-100/90'
                    : activeToast.type === 'success'
                    ? 'border-emerald-500/50 bg-gradient-to-br from-emerald-50 via-emerald-50/95 to-emerald-100/90'
                    : activeToast.type === 'deadline'
                    ? 'border-orange-500/50 bg-gradient-to-br from-orange-50 via-orange-50/95 to-orange-100/90'
                    : 'border-blue-500/50 bg-gradient-to-br from-blue-50 via-white/95 to-indigo-50/90'
                }
              `}
            >
              {/* Animated background glow */}
              <div
                className={`
                  absolute -right-10 -top-10 h-32 w-32 rounded-full blur-3xl opacity-40
                  ${
                    activeToast.type === 'error'
                      ? 'bg-red-400'
                      : activeToast.type === 'warning'
                      ? 'bg-amber-400'
                      : activeToast.type === 'success'
                      ? 'bg-emerald-400'
                      : activeToast.type === 'deadline'
                      ? 'bg-orange-400'
                      : 'bg-blue-400'
                  }
                `}
              />
              
              {/* Content */}
              <div className="relative px-5 py-4">
                <div className="flex items-start gap-4">
                  {/* Icon */}
                  <div
                    className={`
                      mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-xl shadow-lg
                      ${
                        activeToast.type === 'error'
                          ? 'bg-gradient-to-br from-red-500 to-red-600 text-white'
                          : activeToast.type === 'warning'
                          ? 'bg-gradient-to-br from-amber-500 to-amber-600 text-white'
                          : activeToast.type === 'success'
                          ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white'
                          : activeToast.type === 'deadline'
                          ? 'bg-gradient-to-br from-orange-500 to-orange-600 text-white'
                          : 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white'
                      }
                    `}
                  >
                    {activeToast.type === 'error' ? (
                      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    ) : activeToast.type === 'warning' ? (
                      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    ) : activeToast.type === 'success' ? (
                      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    ) : activeToast.type === 'deadline' ? (
                      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    ) : (
                      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    )}
                  </div>

                  {/* Text Content */}
                  <div className="flex-1 min-w-0">
                    {/* App Name / Title */}
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p
                        className={`
                          text-xs font-bold uppercase tracking-wider
                          ${
                            activeToast.type === 'error'
                              ? 'text-red-700'
                              : activeToast.type === 'warning'
                              ? 'text-amber-700'
                              : activeToast.type === 'success'
                              ? 'text-emerald-700'
                              : activeToast.type === 'deadline'
                              ? 'text-orange-700'
                              : 'text-blue-700'
                          }
                        `}
                      >
                        {activeToast.title || 'UCU Exam System'}
                      </p>
                      <button
                        onClick={() => setActiveToast(null)}
                        className="text-slate-400 hover:text-slate-600 transition-colors"
                        aria-label="Close notification"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    {/* Message */}
                    <p className="text-sm font-medium text-slate-900 leading-relaxed">
                      {activeToast.message}
                    </p>

                    {/* Timestamp */}
                    <p className="mt-1.5 text-[0.65rem] font-medium text-slate-500">
                      {new Date(activeToast.timestamp).toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
              </div>

              {/* Progress bar for auto-dismiss */}
              <motion.div
                className={`
                  h-1
                  ${
                    activeToast.type === 'error'
                      ? 'bg-red-500'
                      : activeToast.type === 'warning'
                      ? 'bg-amber-500'
                      : activeToast.type === 'success'
                      ? 'bg-emerald-500'
                      : activeToast.type === 'deadline'
                      ? 'bg-orange-500'
                      : 'bg-blue-500'
                  }
                `}
                initial={{ width: '100%' }}
                animate={{ width: '0%' }}
                transition={{ duration: 5, ease: 'linear' }}
              />
            </div>
          </motion.div>
        )}

        <main
          ref={mainContentRef}
          className={`flex-1 overflow-y-auto ${isVetterActive ? 'w-full px-0 py-0' : 'px-4 py-8 sm:px-6 lg:px-10'}`}
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

const syncPaperStatusToSupabase = async (paperId: string, status: ExamPaperStatus) => {
  if (!paperId) {
    return;
  }
  try {
    const { error } = await supabase
      .from('exam_papers')
      .update({ status })
      .eq('id', paperId);
    if (error) {
      console.error(`Error updating paper ${paperId} to status "${status}":`, error);
    }
  } catch (error) {
    console.error(`Unexpected error syncing paper ${paperId} status "${status}" to Supabase:`, error);
  }
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

  const _displayedLecturers = filterCategory === 'All' 
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

function _AdminAddLecturerPanel({
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
  onAddAdmin: (
    name: string,
    email: string,
    isSuperAdmin: boolean,
    campus: string,
    department: string
  ) => Promise<void>;
}

function AdminAddAdminPanel({ onAddAdmin }: AdminAddAdminPanelProps) {
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [isSuperAdminFlag, setIsSuperAdminFlag] = useState(false);
  const [adminCampus, setAdminCampus] = useState('');
  const [adminDepartment, setAdminDepartment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!adminName.trim() || !adminEmail.trim() || !adminCampus.trim() || !adminDepartment.trim()) return;

    setIsSubmitting(true);
    try {
      await onAddAdmin(adminName, adminEmail, isSuperAdminFlag, adminCampus, adminDepartment);
      setAdminName('');
      setAdminEmail('');
      setIsSuperAdminFlag(false);
      setAdminCampus('');
      setAdminDepartment('');
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

        <div className="grid gap-4 md:grid-cols-2 relative z-10">
          <div>
            <label className="text-[0.7rem] font-semibold uppercase tracking-wide text-slate-600">
              Campus *
            </label>
            <select
              value={adminCampus}
              onChange={(event) => setAdminCampus(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white/95 px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-400/40"
              required
            >
              <option value="">Select campus...</option>
              <option value="Main">Main</option>
              <option value="Kabale">Kabale</option>
              <option value="Kampala">Kampala</option>
              <option value="Mbale">Mbale</option>
              <option value="Arua">Arua</option>
            </select>
          </div>

          <div>
            <label className="text-[0.7rem] font-semibold uppercase tracking-wide text-slate-600">
              Department *
            </label>
            <input
              value={adminDepartment}
              onChange={(event) => setAdminDepartment(event.target.value)}
              placeholder="e.g. Computing and Technology"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white/95 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-500 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-400/40"
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
          disabled={
            !adminName.trim() ||
            !adminEmail.trim() ||
            !adminCampus.trim() ||
            !adminDepartment.trim() ||
            isSubmitting
          }
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

function _SuperUserChiefExaminerPanel({
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

function _SuperUserAccountsPanel({ users }: SuperUserAccountsPanelProps) {
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

function _SuperUserManageUsersPanel({ users, setUsers }: SuperUserManageUsersPanelProps) {
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

const defaultSystemSettings = {
  systemName: 'UCU Digital Paper Moderation System',
  sessionTimeout: 30,
  passwordPolicy: 'medium',
  emailNotifications: true,
  smsNotifications: false,
  maintenanceMode: false,
};

function AdminSystemSettingsPanel({}: AdminSystemSettingsPanelProps) {
  // Initialize state from localStorage or use defaults
  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem('ucu-system-settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { ...defaultSystemSettings, ...parsed };
      } catch (error) {
        console.error('Error loading settings:', error);
        return defaultSystemSettings;
      }
    }
    return defaultSystemSettings;
  });

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    // Save to localStorage
    localStorage.setItem('ucu-system-settings', JSON.stringify(settings));
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

function _AdminAuditLogPanel({ workflow }: AdminAuditLogPanelProps) {
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

function _AdminStaffManagementPanel({ users, setUsers }: AdminStaffManagementPanelProps) {
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
  submittedPapers: SubmittedPaper[];
  setSubmittedPapers: React.Dispatch<React.SetStateAction<SubmittedPaper[]>>;
  restrictedVetters?: Set<string>;
  onReactivateVetter?: (vetterId: string) => void;
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
  deadlinesActive: _deadlinesActive,
  deadlineDuration,
  repositoriesActive,
  onToggleDeadlines: _onToggleDeadlines,
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
  submittedPapers,
  setSubmittedPapers,
  restrictedVetters = new Set(),
  onReactivateVetter,
  sectionId,
}: ChiefExaminerConsoleProps) {
  const [awardUserId, setAwardUserId] = useState('');
  const [selectedCourseUnit, setSelectedCourseUnit] = useState('');
  const [awardRole, setAwardRole] = useState<Role>('Team Lead');
  const [_showDurationSettings, setShowDurationSettings] = useState(false);
  const [durationForm, _setDurationForm] = useState(deadlineDuration);
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

  // Helper to get existing operational roles for a lecturer
  const getExistingRoles = (user: User): string[] => {
    const operationalRoles: Role[] = ['Team Lead', 'Vetter', 'Setter'];
    return operationalRoles.filter(role => user.roles.includes(role));
  };

  // Helper to get role icon/indicator
  const getRoleIndicator = (role: string): string => {
    switch (role) {
      case 'Team Lead':
        return '👤';
      case 'Vetter':
        return '✓';
      case 'Setter':
        return '📝';
      default:
        return '';
    }
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

      // If a course unit is chosen, user must belong to that course unit
      // Use case-insensitive comparison and trim whitespace for robustness
      if (selectedCourseUnit) {
        const selectedUnit = selectedCourseUnit.trim().toLowerCase();
        const userUnit = (user.courseUnit || '').trim().toLowerCase();
        if (userUnit !== selectedUnit) {
          return false;
        }
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

  const _handleDurationSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSetDeadlineDuration(durationForm);
    setShowDurationSettings(false);
    alert(`Deadline duration set to ${durationForm.days} days, ${durationForm.hours} hours, ${durationForm.minutes} minutes`);
  };

  const _formatDuration = () => {
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
        <div className="space-y-6">
          {/* Award Operational Roles Section */}
          <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-lg">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/50 via-transparent to-sky-50/30"></div>
            <div className="relative p-6">
              <div className="mb-6 flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-sky-500 text-white shadow-lg">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m-9 8h10a2 2 0 002-2V7a2 2 0 00-2-2h-3.172a2 2 0 01-1.414-.586L9.586 3.586A2 2 0 008.172 3H6a2 2 0 00-2 2v13a2 2 0 002 2z"
                    />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-slate-900">
                    Award Operational Roles
                  </h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Elevate lecturers into Team Leads, Vetters, or Setters to activate the moderation pipeline.
                  </p>
                </div>
              </div>
              
              <form onSubmit={handleAward} className="space-y-5">
                <div className="grid gap-5 md:grid-cols-3">
                  <div className="space-y-2">
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                      Course Unit
                    </label>
                    <select
                      value={selectedCourseUnit}
                      onChange={(event) => {
                        setSelectedCourseUnit(event.target.value);
                        setAwardUserId('');
                      }}
                      className="w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 shadow-sm transition-all focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 hover:border-indigo-300"
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
                  
                  <div className="space-y-2">
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                      Lecturer
                    </label>
                    <select
                      value={awardUserId}
                      onChange={(event) => setAwardUserId(event.target.value)}
                      className="w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 shadow-sm transition-all focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 hover:border-indigo-300 disabled:bg-slate-50 disabled:text-slate-400"
                      disabled={!selectedCourseUnit}
                    >
                      <option value="">
                        {selectedCourseUnit ? 'Choose a lecturer...' : 'Select a course unit first'}
                      </option>
                      {eligibleUsers.map((user) => {
                        const isNetworkingCourse =
                          typeof selectedCourseUnit === 'string' &&
                          selectedCourseUnit.toLowerCase().includes('network');
                        
                        const existingRoles = getExistingRoles(user);
                        const roleIndicators = existingRoles.map(role => getRoleIndicator(role)).join(' ');
                        const roleLabels = existingRoles.length > 0 
                          ? ` [${existingRoles.join(', ')}]` 
                          : '';
                        
                        let label = user.name;
                        if (isNetworkingCourse && user.campus) {
                          label = `${user.name} • ${getCampusBadgeForLecturer(user.campus)}`;
                        }
                        if (existingRoles.length > 0) {
                          label = `${label} ${roleIndicators}${roleLabels}`;
                        }
                        
                        return (
                          <option key={user.id} value={user.id}>
                            {label}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  
                  <div className="space-y-2">
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                      Role
                    </label>
                    <select
                      value={awardRole}
                      onChange={(event) => setAwardRole(event.target.value as Role)}
                      className="w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-900 shadow-sm transition-all focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 hover:border-indigo-300"
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
                  className="w-full rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-700 px-6 py-3.5 text-sm font-bold text-white shadow-lg transition-all hover:from-indigo-700 hover:to-indigo-800 hover:shadow-xl disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-400 disabled:shadow-none"
                >
                  Assign Role
                </button>
              </form>
            </div>
          </div>

          {/* Currently Assigned Roles Section */}
          <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-lg">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/50 via-transparent to-teal-50/30"></div>
            <div className="relative p-6">
              <div className="mb-6 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-lg">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M17 20h5V4H2v16h5m10 0v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5m10 0H7"
                      />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">
                      Currently Assigned Roles
                    </h3>
                    <p className="mt-1 text-sm text-slate-600">
                      View all lecturers who have been assigned operational roles in the moderation workflow.
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-emerald-100 px-4 py-2 text-xs font-bold text-emerald-700 border-2 border-emerald-200 shadow-sm">
                  Live Overview
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
                <div className="text-center py-12">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 mb-4">
                    <svg className="h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5V4H2v16h5m10 0v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5m10 0H7" />
                    </svg>
                  </div>
                  <p className="text-base font-semibold text-slate-700">No Operational Roles Assigned</p>
                  <p className="text-sm text-slate-500 mt-2">Use the form above to assign roles to lecturers.</p>
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
              <div className="space-y-6">
                {operationalRoles.map(role => {
                  const usersWithRole = roleGroups[role];
                  if (usersWithRole.length === 0) return null;

                  const getRoleStyles = (r: Role) => {
                    switch (r) {
                      case 'Team Lead':
                        return {
                          title: 'text-indigo-800',
                          badge: 'bg-indigo-100 text-indigo-700 border-indigo-300',
                          active: 'bg-indigo-600 text-white border-indigo-600',
                          card: 'border-indigo-200 bg-indigo-50/30',
                        };
                      case 'Vetter':
                        return {
                          title: 'text-emerald-800',
                          badge: 'bg-emerald-100 text-emerald-700 border-emerald-300',
                          active: 'bg-emerald-600 text-white border-emerald-600',
                          card: 'border-emerald-200 bg-emerald-50/30',
                        };
                      case 'Setter':
                        return {
                          title: 'text-amber-800',
                          badge: 'bg-amber-100 text-amber-700 border-amber-300',
                          active: 'bg-amber-500 text-white border-amber-500',
                          card: 'border-amber-200 bg-amber-50/30',
                        };
                      default:
                        return {
                          title: 'text-slate-800',
                          badge: 'bg-slate-100 text-slate-700 border-slate-300',
                          active: 'bg-slate-700 text-white border-slate-700',
                          card: 'border-slate-200 bg-slate-50/30',
                        };
                    }
                  };

                  const roleStyles = getRoleStyles(role);

                  return (
                    <div key={role} className="rounded-xl border-2 border-slate-200 bg-white p-5 shadow-sm">
                      <div className="mb-4 flex items-center justify-between">
                        <h4 className={`text-base font-bold ${roleStyles.title}`}>
                          {role}
                        </h4>
                        <span className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 ${roleStyles.badge} shadow-sm`}>
                          {usersWithRole.length} {usersWithRole.length === 1 ? 'Person' : 'People'}
                        </span>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {usersWithRole.map((user) => (
                          <div
                            key={user.id}
                            className="group relative overflow-hidden rounded-xl border-2 border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-slate-300 hover:shadow-md"
                          >
                            <div className="flex items-start justify-between gap-3 mb-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-slate-100 to-slate-200 text-slate-600">
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
                                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                                      />
                                    </svg>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-bold text-slate-900 truncate">
                                      {user.name}
                                    </p>
                                    {user.email && (
                                      <p className="text-xs text-slate-500 truncate">
                                        {user.email}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <span
                                className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-bold border-2 ${roleStyles.active} shadow-sm whitespace-nowrap`}
                              >
                                {role}
                              </span>
                            </div>

                            {user.lecturerCategory || user.department || user.courseUnit ? (
                              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5">
                                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-600">
                                  Details
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
                            ) : null}

                            <button
                              type="button"
                              onClick={() => onUnassignRole(user.id, role)}
                              className="mt-3 w-full rounded-lg border-2 border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 shadow-sm transition-all hover:border-red-300 hover:bg-red-100 hover:shadow-md"
                              title={`Remove ${role} role from ${user.name}`}
                            >
                              <span className="flex items-center justify-center gap-1.5">
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
          </div>

          {/* Restricted Vetters Section - Always visible */}
          <div className="mt-6 rounded-xl border-2 border-red-300 bg-red-50/50 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-lg">
                  <span className="text-xl">🚫</span>
                </div>
                <div>
                  <h4 className="text-base font-bold text-red-800">
                    Restricted Vetters
                  </h4>
                  <p className="text-sm text-red-700 mt-1">
                    Vetters with restricted access due to violations
                  </p>
                </div>
              </div>
              <span className="rounded-full bg-red-100 px-4 py-2 text-xs font-bold text-red-700 border-2 border-red-200 shadow-sm">
                {restrictedVetters ? restrictedVetters.size : 0} Restricted
              </span>
            </div>
            {restrictedVetters && restrictedVetters.size > 0 ? (
              <div className="space-y-3">
                {Array.from(restrictedVetters).map((vetterId) => {
                  const vetter = users.find((u: User) => u.id === vetterId);
                  if (!vetter) return null;
                  return (
                    <div key={vetterId} className="flex items-center justify-between rounded-lg border-2 border-red-200 bg-white p-4 shadow-sm">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100 text-red-600">
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900">{vetter.name}</p>
                          <p className="text-xs text-red-600">Access restricted due to violation</p>
                        </div>
                      </div>
                      {onReactivateVetter && (
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(`Reactivate ${vetter.name}? They will be able to join vetting sessions again.`)) {
                              onReactivateVetter(vetterId);
                            }
                          }}
                          className="rounded-lg bg-green-500 px-4 py-2 text-xs font-bold text-white shadow hover:bg-green-600 transition"
                        >
                          Reactivate
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border-2 border-dashed border-red-200 bg-white/50 p-8 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 mb-4">
                  <svg className="h-8 w-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                </div>
                <p className="text-base font-semibold text-red-700">No Restricted Vetters</p>
                <p className="text-sm text-red-600 mt-2">All vetters currently have full access to vetting sessions.</p>
              </div>
            )}
          </div>
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

      {/* Similarity Detection */}
      <AISimilarityDetectionPanel 
        repositoryPapers={repositoryPapers} 
        submittedPapers={submittedPapers}
        setSubmittedPapers={setSubmittedPapers}
      />
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
  submittedPapers: SubmittedPaper[];
  setterSubmissions: Array<{
    id: string;
    fileName: string;
    submittedBy: string;
    submittedAt: string;
    fileContent?: string;
  }>;
  workflowStage: WorkflowStage;
  onSubmitPDF: (file: File, courseUnit: string, courseCode: string, semester: string, year: string) => void;
  vettingSessionRecords?: VettingSessionRecord[];
  customChecklistPdf?: { url: string; name: string; isWordDoc?: boolean } | null;
  checklistForwarded?: boolean;
}

function TeamLeadPanel({
  deadlinesActive,
  deadlineStartTime,
  deadlineDuration,
  repositoriesActive,
  onTeamLeadCompile: _onTeamLeadCompile,
  submittedPapers,
  setterSubmissions,
  workflowStage: _workflowStage,
  onSubmitPDF,
  vettingSessionRecords = [],
  customChecklistPdf,
  checklistForwarded = false,
}: TeamLeadPanelProps) {
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [courseUnit, setCourseUnit] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [semester, setSemester] = useState('');
  const [year, setYear] = useState('');
  const [cacheVersion, setCacheVersion] = useState(0); // Version counter to force re-renders
  
  // Cache for user names fetched from database (using object for React state updates)
  const [userNameCache, setUserNameCache] = useState<Record<string, string>>({});
  const userNameCacheRef = useRef<Record<string, string>>({});
  const fetchedUserIdsRef = useRef<Set<string>>(new Set());
  
  // Sync ref with state
  useEffect(() => {
    userNameCacheRef.current = userNameCache;
  }, [userNameCache]);
  
  // Fetch user names for all UUIDs in submitted papers
  useEffect(() => {
    const fetchUserNames = async () => {
      // Collect all UUIDs from submitted papers that we haven't fetched yet
      const userIds = new Set<string>();
      submittedPapers.forEach(paper => {
        // Check if submittedBy looks like a UUID
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paper.submittedBy);
        if (isUUID) {
          // Check if we've already fetched this UUID
          const alreadyFetched = fetchedUserIdsRef.current.has(paper.submittedBy);
          // Check if we have it in cache (using ref to avoid stale closure)
          const hasCached = userNameCacheRef.current[paper.submittedBy];
          
          if (!alreadyFetched && !hasCached) {
            userIds.add(paper.submittedBy);
          }
        }
      });
      
      if (userIds.size === 0) return;
      
      console.log('🔍 Fetching user names for UUIDs:', Array.from(userIds));
      
      // Mark these UUIDs as being fetched
      userIds.forEach(id => fetchedUserIdsRef.current.add(id));
      
      // Fetch user names from database
      try {
        const { data: profiles, error } = await supabase
          .from('user_profiles')
          .select('id, name')
          .in('id', Array.from(userIds));
        
        if (error) {
          console.error('❌ Error fetching user names:', error);
          // Remove from fetched set on error so we can retry
          userIds.forEach(id => fetchedUserIdsRef.current.delete(id));
          return;
        }
        
        if (profiles && profiles.length > 0) {
          console.log('✅ Fetched user names:', profiles.map(p => ({ id: p.id, name: p.name })));
          setUserNameCache(prev => {
            // Always create a new object to ensure React detects the change
            const updated = { ...prev };
            let hasNewNames = false;
            profiles.forEach(profile => {
              if (profile.name && updated[profile.id] !== profile.name) {
                updated[profile.id] = profile.name;
                hasNewNames = true;
              }
            });
            // Always return a new object reference to trigger re-render
            if (hasNewNames) {
              setCacheVersion(v => v + 1); // Increment version to force re-render
            }
            return { ...updated };
          });
        } else {
          console.warn('⚠️ No user profiles found for UUIDs:', Array.from(userIds));
        }
      } catch (error) {
        console.error('❌ Exception fetching user names from database:', error);
        // Remove from fetched set on error so we can retry
        userIds.forEach(id => fetchedUserIdsRef.current.delete(id));
      }
    };
    
    fetchUserNames();
  }, [submittedPapers]);

  useEffect(() => {
    if (deadlinesActive && deadlineStartTime) {
      const timer = setInterval(() => {
        setCurrentTime(Date.now());
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [deadlinesActive, deadlineStartTime]);

  // Auto-populate metadata from the most recent submitted paper
  // so the Team Lead does not have to type course details again.
  useEffect(() => {
    if (!submittedPapers.length) return;
    const latest = submittedPapers[0];

    setCourseUnit((prev) => prev || latest.courseUnit || '');
    setCourseCode((prev) => prev || latest.courseCode || '');
    setSemester((prev) => prev || latest.semester || '');
    setYear((prev) => prev || latest.year || '');
  }, [submittedPapers]);

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

  // Map a stored paper status (from Supabase) to a more precise workflow stage
  // so that the submission history reflects the real position of each paper,
  // even after a page refresh (when the in-memory workflow state resets).
  const getWorkflowStageForPaper = (paper: SubmittedPaper): string => {
    // If paper is submitted by Team Lead, it's a submission TO Chief Examiner
    if (paper.submittedRole === 'Team Lead' && paper.status === 'submitted') {
      return 'Submitted to Chief Examiner';
    }
    
    switch (paper.status) {
      case 'submitted':
        // Setter has lodged the draft and it has been forwarded to the Team Lead
        return 'Submitted to Team Lead';
      case 'in-vetting':
        return 'Vetting in Progress';
      case 'vetted':
        return 'Vetted & Returned to Chief Examiner';
      case 'approved':
        return 'Approved';
      default:
        return 'Unknown';
    }
  };

  const getSubmitterName = useCallback((paper: SubmittedPaper): string => {
    // Check if submittedBy looks like a UUID (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paper.submittedBy);
    
    // If it's a UUID, try to find the user in cache
    if (isUUID) {
      // Check cache
      const cachedName = userNameCache[paper.submittedBy];
      if (cachedName) {
        return cachedName;
      }
      
      // Check if we're currently fetching this user
      const isFetching = fetchedUserIdsRef.current.has(paper.submittedBy);
      if (isFetching) {
        return 'Loading...'; // Show loading state while fetching
      }
      
      // Name not found yet and not being fetched
      return 'Unknown User';
    }
    
    // If it's not a UUID, return the submittedBy value (might already be a name)
    return paper.submittedBy || 'Unknown';
  }, [userNameCache]);

  const handleDownloadModerationChecklist = () => {
    if (!checklistForwarded) {
      alert('The moderation checklist has not been forwarded by the Chief Examiner yet. Please wait for notification.');
      return;
    }
    
    // Find the most recent vetting session record that matches the current course
    // Try to match by course code and course unit from submitted papers or form fields
    const currentCourseCode = courseCode.toLowerCase().trim();
    const currentCourseUnit = courseUnit.toLowerCase().trim();
    
    // Also check submitted papers for matching course info
    const paperCourseCode = submittedPapers.find(p => p.courseCode)?.courseCode?.toLowerCase().trim();
    const paperCourseUnit = submittedPapers.find(p => p.courseUnit)?.courseUnit?.toLowerCase().trim();
    
    const searchCourseCode = currentCourseCode || paperCourseCode || '';
    const searchCourseUnit = currentCourseUnit || paperCourseUnit || '';
    
    // Find matching vetting session record - prioritize exact matches
    let matchingRecord = vettingSessionRecords.find((record) => {
      const recordCourseCode = (record.courseCode || '').toLowerCase().trim();
      const recordCourseUnit = (record.courseUnit || '').toLowerCase().trim();
      // Try exact match first
      if (searchCourseCode && recordCourseCode && recordCourseCode === searchCourseCode) {
        return true;
      }
      if (searchCourseUnit && recordCourseUnit && recordCourseUnit === searchCourseUnit) {
        return true;
      }
      return false;
    });

    // If no exact match, try partial match or use most recent record
    if (!matchingRecord && vettingSessionRecords.length > 0) {
      matchingRecord = vettingSessionRecords[0]; // Use most recent
    }

    if (!matchingRecord || !matchingRecord.checklistComments || matchingRecord.checklistComments.size === 0) {
      alert('No moderation checklist with comments is available yet. The checklist will be available after the vetting process is completed and the Chief Examiner has forwarded it.');
      return;
    }

    // Generate PDF with UCU cover page and checklist content
    const pdf = generateChecklistPDF({
      comments: matchingRecord.checklistComments,
      hasCustomChecklistPdf: Boolean(customChecklistPdf?.url),
      hideVetterNames: true, // Hide vetter names when team lead downloads
      courseCode: matchingRecord.courseCode,
      courseUnit: matchingRecord.courseUnit,
      paperName: matchingRecord.paperName,
    });

    if (!pdf) {
      alert('Failed to generate PDF. Please try again.');
      return;
    }

    // Generate filename with course code and date
    const courseCodeForFilename = (matchingRecord.courseCode || 'checklist').replace(/\s+/g, '-');
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `moderation-checklist-${courseCodeForFilename}-${dateStr}.pdf`;
    
    // Save PDF
    pdf.save(filename);
    alert('Moderation checklist PDF downloaded successfully!');
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
                {checklistForwarded 
                  ? 'Download the moderation checklist with comments and feedback from the vetting process.'
                  : 'The moderation checklist will be available for download after the Chief Examiner forwards it to you. You will receive a notification when it\'s ready.'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleDownloadModerationChecklist}
              disabled={!checklistForwarded}
              className={`w-full rounded-xl px-6 py-4 text-sm font-semibold transition ${
                checklistForwarded
                  ? 'bg-amber-400/90 text-amber-950 hover:bg-amber-300'
                  : 'bg-slate-300 text-slate-500 cursor-not-allowed'
              }`}
              title={checklistForwarded ? 'Download moderation checklist' : 'Checklist not yet forwarded by Chief Examiner'}
            >
              {checklistForwarded ? 'Download Moderation Checklist' : 'Download (Awaiting Chief Examiner)'}
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

      {/* Setter Submissions Section */}
      {submittedPapers.filter((p) => p.submittedRole === 'Setter' || !p.submittedRole || p.submittedRole === 'Unknown').length > 0 && (
        <SectionCard
          title="Submissions from Setters"
          kicker="Submission History"
          description="View all drafts lodged by setters and follow their journey through the vetting workflow."
        >
          <CompactPaperCards 
            key={`setter-papers-${cacheVersion}`}
            papers={submittedPapers.filter((p) => p.submittedRole === 'Setter' || !p.submittedRole || p.submittedRole === 'Unknown')}
            getSubmitterName={getSubmitterName}
            getStatusLabel={getStatusLabel}
            getStatusColor={getStatusColor}
            getWorkflowStageForPaper={getWorkflowStageForPaper}
            resolvePaperUrl={resolvePaperUrl}
          />
        </SectionCard>
      )}

      {/* Team Lead Submissions Section */}
      {submittedPapers.filter((p) => p.submittedRole === 'Team Lead').length > 0 && (
        <SectionCard
          title="Submissions from Team Lead"
          kicker="Compiled Papers for Chief Examiner"
          description="View all papers compiled and submitted by Team Lead. These papers are ready for Chief Examiner AI similarity analysis before vetting."
        >
          <CompactPaperCards 
            key={`teamlead-papers-${cacheVersion}`}
            papers={submittedPapers.filter((p) => p.submittedRole === 'Team Lead')}
            getSubmitterName={getSubmitterName}
            getStatusLabel={getStatusLabel}
            getStatusColor={getStatusColor}
            getWorkflowStageForPaper={getWorkflowStageForPaper}
            resolvePaperUrl={resolvePaperUrl}
          />
        </SectionCard>
      )}
    </div>
  );
}

interface TeamLeadDashboardPanelProps {
  workflow: WorkflowState;
  submittedPapers: SubmittedPaper[];
  setterSubmissions: SetterSubmission[];
  users?: User[];
  teamLeadDeadlineActive?: boolean;
  teamLeadDeadlineStartTime?: number | null;
  teamLeadDeadlineDuration?: { days: number; hours: number; minutes: number };
}

function TeamLeadDashboardPanel({
  workflow,
  submittedPapers,
  setterSubmissions,
  users = [],
  teamLeadDeadlineActive = false,
  teamLeadDeadlineStartTime = null,
  teamLeadDeadlineDuration = { days: 7, hours: 0, minutes: 0 },
}: TeamLeadDashboardPanelProps) {
  // Cache for user names fetched from database (using object for React state updates)
  const [userNameCache, setUserNameCache] = useState<Record<string, string>>({});
  const [cacheVersion, setCacheVersion] = useState(0); // Version counter to force re-renders
  const userNameCacheRef = useRef<Record<string, string>>({});
  const fetchedUserIdsRef = useRef<Set<string>>(new Set());
  
  // Sync ref with state
  useEffect(() => {
    userNameCacheRef.current = userNameCache;
  }, [userNameCache]);
  
  // Fetch user names for all UUIDs in submitted papers
  useEffect(() => {
    const fetchUserNames = async () => {
      // Collect all UUIDs from submitted papers that we haven't fetched yet
      const userIds = new Set<string>();
      submittedPapers.forEach(paper => {
        // Check if submittedBy looks like a UUID
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paper.submittedBy);
        if (isUUID) {
          // Check if we already have this user in local array
          const hasUser = users.find(u => u.id === paper.submittedBy && u.name);
          // Check if we've already fetched this UUID
          const alreadyFetched = fetchedUserIdsRef.current.has(paper.submittedBy);
          // Check if we have it in cache (using ref to avoid stale closure)
          const hasCached = userNameCacheRef.current[paper.submittedBy];
          
          if (!hasUser && !alreadyFetched && !hasCached) {
            userIds.add(paper.submittedBy);
          }
        }
      });
      
      if (userIds.size === 0) return;
      
      console.log('🔍 Fetching user names for UUIDs:', Array.from(userIds));
      
      // Mark these UUIDs as being fetched
      userIds.forEach(id => fetchedUserIdsRef.current.add(id));
      
      // Fetch user names from database
      try {
        const { data: profiles, error } = await supabase
          .from('user_profiles')
          .select('id, name')
          .in('id', Array.from(userIds));
        
        if (error) {
          console.error('❌ Error fetching user names:', error);
          // Remove from fetched set on error so we can retry
          userIds.forEach(id => fetchedUserIdsRef.current.delete(id));
          return;
        }
        
        if (profiles && profiles.length > 0) {
          console.log('✅ Fetched user names:', profiles.map(p => ({ id: p.id, name: p.name })));
          setUserNameCache(prev => {
            // Always create a new object to ensure React detects the change
            const updated = { ...prev };
            let hasNewNames = false;
            profiles.forEach(profile => {
              if (profile.name && updated[profile.id] !== profile.name) {
                updated[profile.id] = profile.name;
                hasNewNames = true;
              }
            });
            // Always return a new object reference to trigger re-render
            if (hasNewNames) {
              setCacheVersion(v => v + 1); // Increment version to force re-render
            }
            return { ...updated };
          });
        } else {
          console.warn('⚠️ No user profiles found for UUIDs:', Array.from(userIds));
        }
      } catch (error) {
        console.error('❌ Exception fetching user names from database:', error);
        // Remove from fetched set on error so we can retry
        userIds.forEach(id => fetchedUserIdsRef.current.delete(id));
      }
    };
    
    fetchUserNames();
  }, [submittedPapers, users]);
  
  // Helper functions for paper cards
  const _getStatusColor = (status: string) => {
    switch (status) {
      case 'submitted':
        return 'text-violet-400 bg-violet-500/10 border-violet-500/30';
      case 'in-vetting':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
      case 'vetted':
        return 'text-blue-600 bg-blue-500/10 border-blue-500/30';
      case 'approved':
        return 'text-green-600 bg-green-500/10 border-green-500/30';
      default:
        return 'text-slate-600 bg-slate-500/10 border-slate-500/30';
    }
  };

  const _getStatusLabel = (status: string) => {
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

  const _getWorkflowStageForPaper = (paper: SubmittedPaper): string => {
    // If paper is submitted by Team Lead, it's a submission TO Chief Examiner
    if (paper.submittedRole === 'Team Lead' && paper.status === 'submitted') {
      return 'Submitted to Chief Examiner';
    }
    
    switch (paper.status) {
      case 'submitted':
        return 'Submitted to Team Lead';
      case 'in-vetting':
        return 'Vetting in Progress';
      case 'vetted':
        return 'Vetted & Returned to Chief Examiner';
      case 'approved':
        return 'Approved';
      default:
        return 'Unknown';
    }
  };

  const getSubmitterName = useCallback((paper: SubmittedPaper): string => {
    // Check if submittedBy looks like a UUID (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paper.submittedBy);
    
    // If it's a UUID, try to find the user
    if (isUUID) {
      // First check local users array
      const user = users.find(u => u.id === paper.submittedBy);
      if (user && user.name) {
        return user.name;
      }
      
      // Then check cache
      const cachedName = userNameCache[paper.submittedBy];
      if (cachedName) {
        return cachedName;
      }
      
      // Check if we're currently fetching this user
      const isFetching = fetchedUserIdsRef.current.has(paper.submittedBy);
      if (isFetching) {
        return 'Loading...'; // Show loading state while fetching
      }
      
      // Name not found yet and not being fetched
      return 'Unknown User';
    }
    
    // If it's not a UUID, return the submittedBy value (might already be a name)
    return paper.submittedBy || 'Unknown';
  }, [users, userNameCache]);

  // Derive effective metrics from both in-memory submissions and persisted papers
  const dbSetterDrafts = useMemo(
    () => submittedPapers.filter((p) => p.status === 'submitted').length,
    [submittedPapers]
  );

  const compiledCount = useMemo(
    () => submittedPapers.filter((p) => p.submittedRole === 'Team Lead' && p.status === 'submitted').length,
    [submittedPapers]
  );

  // Prefer live in-memory drafts if present (same session as setter),
  // otherwise fall back to drafts inferred from persisted papers.
  const setterDrafts = setterSubmissions.length > 0 ? setterSubmissions.length : dbSetterDrafts;

  // If workflow hasn't been advanced (e.g. fresh Team Lead session) but there
  // are drafts already lodged by setters, reflect that in the snapshot using
  // the same effective-stage logic the rest of the dashboards use.
  const effectiveStage = getEffectiveWorkflowStage(submittedPapers, workflow.stage);

  // Build a synthetic journey line from known stages so the chart always shows
  // a meaningful path up to the current/effective stage, even after refresh.
  const timelineData = useMemo(() => {
    const orderedStages: WorkflowStage[] = [
      'Awaiting Setter',
      'Submitted to Team Lead',
      'Compiled for Vetting',
      'Vetting in Progress',
      'Vetted & Returned to Chief Examiner',
      'Revision Complete',
      'Approved',
    ];

    const currentIndex = orderedStages.indexOf(effectiveStage as WorkflowStage);
    const lastIndex = currentIndex === -1 ? 0 : currentIndex;

    return orderedStages.slice(0, lastIndex + 1).map((stage, index) => ({
      step: index + 1,
      label: stage,
      stageIndex: index + 1,
    }));
  }, [effectiveStage]);

  // Calculate countdown for rejected papers
  const [countdownNow, setCountdownNow] = useState(Date.now());
  
  useEffect(() => {
    if (teamLeadDeadlineActive && teamLeadDeadlineStartTime) {
      const timer = window.setInterval(() => {
        setCountdownNow(Date.now());
      }, 1000);
      return () => window.clearInterval(timer);
    }
  }, [teamLeadDeadlineActive, teamLeadDeadlineStartTime]);

  const calculateTimeRemaining = () => {
    if (!teamLeadDeadlineActive || !teamLeadDeadlineStartTime) {
      return null;
    }

    const totalMs =
      teamLeadDeadlineDuration.days * 24 * 60 * 60 * 1000 +
      teamLeadDeadlineDuration.hours * 60 * 60 * 1000 +
      teamLeadDeadlineDuration.minutes * 60 * 1000;
    
    const elapsed = countdownNow - teamLeadDeadlineStartTime;
    const remaining = Math.max(totalMs - elapsed, 0);

    const days = Math.floor(remaining / (24 * 60 * 60 * 1000));
    const hours = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
    const seconds = Math.floor((remaining % (60 * 1000)) / 1000);

    return {
      days,
      hours,
      minutes,
      seconds,
      expired: remaining <= 0,
    };
  };

  const timeRemaining = calculateTimeRemaining();
  // Check for rejection - either stage is Rejected, or lastDecision is Rejected, or stage is Submitted to Team Lead with Rejected decision
  const hasRejection = workflow.stage === 'Rejected' || 
    workflow.lastDecision?.type === 'Rejected' || 
    (workflow.stage === 'Submitted to Team Lead' && workflow.lastDecision?.type === 'Rejected');
  // Show countdown if there's a rejection AND deadline is active
  const showCountdown = hasRejection && teamLeadDeadlineActive && teamLeadDeadlineStartTime;

  return (
    <SectionCard
      title="Team Lead Dashboard"
      kicker="Coordination & Submission Flow"
      description="Soft overview of drafts coming from setters and compiled packages forwarded to the Chief Examiner."
    >
      {showCountdown && (
        <div className="mb-6 rounded-2xl border-2 border-rose-200 bg-gradient-to-br from-rose-50 via-red-50 to-orange-50 p-6 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-rose-600 mb-1">
                Revision Deadline
              </p>
              <p className="text-sm text-rose-800">
                Paper rejected by Chief Examiner. Time remaining to submit revised version:
              </p>
            </div>
          </div>
          {timeRemaining?.expired ? (
            <div className="text-center py-4">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-rose-500/20 border-2 border-rose-500/50 mb-3">
                <span className="text-2xl">⏰</span>
              </div>
              <p className="text-lg font-semibold text-rose-700">Deadline Expired</p>
              <p className="text-sm text-rose-600 mt-1">The revision deadline has passed.</p>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-4">
              <div className="text-center">
                <div className="rounded-xl border border-rose-200 bg-white p-4">
                  <p className="text-3xl font-bold text-rose-700">{String(timeRemaining?.days ?? 0).padStart(2, '0')}</p>
                  <p className="text-xs text-slate-600 mt-1 uppercase tracking-wide">Days</p>
                </div>
              </div>
              <div className="text-center">
                <div className="rounded-xl border border-rose-200 bg-white p-4">
                  <p className="text-3xl font-bold text-rose-700">{String(timeRemaining?.hours ?? 0).padStart(2, '0')}</p>
                  <p className="text-xs text-slate-600 mt-1 uppercase tracking-wide">Hours</p>
                </div>
              </div>
              <div className="text-center">
                <div className="rounded-xl border border-rose-200 bg-white p-4">
                  <p className="text-3xl font-bold text-rose-700">{String(timeRemaining?.minutes ?? 0).padStart(2, '0')}</p>
                  <p className="text-xs text-slate-600 mt-1 uppercase tracking-wide">Minutes</p>
                </div>
              </div>
              <div className="text-center">
                <div className="rounded-xl border border-rose-200 bg-white p-4">
                  <p className="text-3xl font-bold text-rose-700">{String(timeRemaining?.seconds ?? 0).padStart(2, '0')}</p>
                  <p className="text-xs text-slate-600 mt-1 uppercase tracking-wide">Seconds</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-sky-50 to-blue-50 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-600">
            Role Snapshot
          </p>
          <p className="text-sm text-slate-700">
            Current workflow stage:{' '}
            <span className="font-semibold text-indigo-700">
              {effectiveStage}
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

        <div className="col-span-1 relative overflow-hidden rounded-2xl border-2 border-indigo-100 bg-gradient-to-br from-indigo-50 via-sky-50 to-emerald-50 p-4 shadow-md ring-1 ring-indigo-100">
          <div className="pointer-events-none absolute inset-0 opacity-50 bg-[radial-gradient(circle_at_top,_#38bdf8_0,_transparent_45%),radial-gradient(circle_at_bottom,_#a855f7_0,_transparent_55%)]" />
          <p className="relative text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-indigo-600">
            Journey Line
          </p>
          <p className="relative text-xs text-slate-700">
            Light line view of how this paper has moved through the stages.
          </p>
          <div className="relative mt-3 h-44">
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
                  strokeWidth={2.5}
                  dot={{ r: 4, strokeWidth: 1.5, stroke: '#166534', fill: '#4ade80' }}
                  isAnimationActive
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="relative space-y-3 rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 via-sky-50 to-violet-50 p-4 shadow-md ring-1 ring-slate-100">
          <div className="pointer-events-none absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_top,_#38bdf8_0,_transparent_50%),radial-gradient(circle_at_bottom,_#22c55e_0,_transparent_55%)]" />
          <p className="relative text-[0.7rem] font-semibold uppercase tracking-wide text-slate-600">
            Next Coordination Step
          </p>
          <p className="relative text-sm text-slate-800">
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
  submittedPapers: SubmittedPaper[];
  setSubmittedPapers: React.Dispatch<React.SetStateAction<SubmittedPaper[]>>;
}

function AISimilarityDetectionPanel({ repositoryPapers, submittedPapers, setSubmittedPapers }: AISimilarityDetectionPanelProps) {
  const [selectedCourse, setSelectedCourse] = useState<string>('');
  const [isScanning, setIsScanning] = useState(false);
  const [similarityResults, setSimilarityResults] = useState<SimilarityResult[]>([]);
  const [showDetails, setShowDetails] = useState<string | null>(null);
  const [scanCompleted, setScanCompleted] = useState(false);

  // Helper functions for paper cards
  const _getStatusColor = (status: string) => {
    switch (status) {
      case 'submitted':
        return 'text-violet-400 bg-violet-500/10 border-violet-500/30';
      case 'in-vetting':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
      case 'vetted':
        return 'text-blue-600 bg-blue-500/10 border-blue-500/30';
      case 'approved':
        return 'text-green-600 bg-green-500/10 border-green-500/30';
      default:
        return 'text-slate-600 bg-slate-500/10 border-slate-500/30';
    }
  };

  const _getStatusLabel = (status: string) => {
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

  const _getWorkflowStageForPaper = (paper: SubmittedPaper): string => {
    // If paper is submitted by Team Lead, it's a submission TO Chief Examiner
    if (paper.submittedRole === 'Team Lead' && paper.status === 'submitted') {
      return 'Submitted to Chief Examiner';
    }
    
    switch (paper.status) {
      case 'submitted':
        return 'Submitted to Team Lead';
      case 'in-vetting':
        return 'Vetting in Progress';
      case 'vetted':
        return 'Vetted & Returned to Chief Examiner';
      case 'approved':
        return 'Approved';
      default:
        return 'Unknown';
    }
  };

  const _getSubmitterName = (paper: SubmittedPaper): string => {
    return paper.submittedBy || 'Unknown';
  };

  // Convert repository papers to Paper format for comparison
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

  // Get course units from submitted papers (including Team Lead submissions)
  const courseUnits = Array.from(
    new Set(
      submittedPapers
        .filter(p => p.courseCode && p.courseUnit)
        .map(p => `${p.courseCode} - ${p.courseUnit}`)
    )
  );

  // Enhanced Similarity Detection Algorithm
  const detectSimilarity = (
    submittedPaper: SubmittedPaper, 
    repositoryPaper: Paper
  ): SimilarityResult | null => {
    // Skip if comparing paper with itself
    if (submittedPaper.id === repositoryPaper.id) return null;

    // Get content from submitted paper (try to get from repository or use placeholder)
    const submittedContent = repositoryPapers.find(rp => rp.id === submittedPaper.id)?.content || 
                             `Paper: ${submittedPaper.fileName}`;
    const repoContent = repositoryPaper.content;

    // Normalize and tokenize content
    const normalizeText = (text: string): string[] => {
      return text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 2); // Filter out very short words
    };

    const submittedWords = normalizeText(submittedContent);
    const repoWords = normalizeText(repoContent);

    // Calculate word overlap
    const submittedSet = new Set(submittedWords);
    const repoSet = new Set(repoWords);
    
    let commonWords = 0;
    submittedSet.forEach(word => {
      if (repoSet.has(word)) commonWords++;
    });

    // Calculate similarity using Jaccard similarity and word frequency
    const unionSize = new Set([...submittedWords, ...repoWords]).size;
    const jaccardSimilarity = unionSize > 0 ? (commonWords / unionSize) * 100 : 0;
    
    // Also calculate word frequency similarity
    const submittedWordFreq = new Map<string, number>();
    submittedWords.forEach(word => {
      submittedWordFreq.set(word, (submittedWordFreq.get(word) || 0) + 1);
    });

    const repoWordFreq = new Map<string, number>();
    repoWords.forEach(word => {
      repoWordFreq.set(word, (repoWordFreq.get(word) || 0) + 1);
    });

    let freqSimilarity = 0;
    let totalFreq = 0;
    submittedWordFreq.forEach((freq, word) => {
      if (repoWordFreq.has(word)) {
        const repoFreq = repoWordFreq.get(word) || 0;
        freqSimilarity += Math.min(freq, repoFreq);
        totalFreq += Math.max(freq, repoFreq);
      }
    });
    const freqScore = totalFreq > 0 ? (freqSimilarity / totalFreq) * 100 : 0;

    // Combine both metrics (weighted average)
    const similarityScore = (jaccardSimilarity * 0.4 + freqScore * 0.6);

    // Only return if similarity is significant (>= 20%)
    if (similarityScore < 20) return null;

    // Determine matched sections based on similarity
    const matchedSections: string[] = [];
    if (similarityScore > 70) matchedSections.push('Question Structure');
    if (similarityScore > 60) matchedSections.push('Key Concepts');
    if (similarityScore > 50) matchedSections.push('Terminology');
    if (similarityScore > 40) matchedSections.push('General Content');

    // Determine risk level
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (similarityScore >= 85) riskLevel = 'critical';
    else if (similarityScore >= 70) riskLevel = 'high';
    else if (similarityScore >= 50) riskLevel = 'medium';

    return {
      paperId: submittedPaper.id,
      historicalPaperId: repositoryPaper.id,
      similarityScore: Math.round(similarityScore * 10) / 10, // Round to 1 decimal
      matchedSections,
      riskLevel,
    };
  };

  const handleScan = async () => {
    if (!selectedCourse) {
      alert('Please select a course unit first');
      return;
    }

    setIsScanning(true);
    setSimilarityResults([]);
    setScanCompleted(false);

    // Simulate AI processing with actual comparison
    setTimeout(() => {
      const [courseCode] = selectedCourse.split(' - ');
      
      // Get submitted papers for this course (including Team Lead submissions)
      const papersToScan = submittedPapers.filter(p => p.courseCode && p.courseCode === courseCode);
      
      // Get ALL repository papers for this course (both current and historical)
      const repositoryPapersForCourse = allRepositoryPapers.filter(p => p.courseCode === courseCode);

      if (papersToScan.length === 0) {
        alert('No submitted papers found for this course unit.');
        setIsScanning(false);
        return;
      }

      if (repositoryPapersForCourse.length === 0) {
        alert('No repository papers found for comparison.');
        setIsScanning(false);
        return;
      }

      const results: SimilarityResult[] = [];

      // Compare each submitted paper with all repository papers
      papersToScan.forEach(submittedPaper => {
        repositoryPapersForCourse.forEach(repoPaper => {
          const result = detectSimilarity(submittedPaper, repoPaper);
          if (result) {
            results.push(result);
          }
        });
      });

      // Sort by similarity score (highest first)
      results.sort((a, b) => b.similarityScore - a.similarityScore);

      setSimilarityResults(results);
      setScanCompleted(true);
      setIsScanning(false);

      if (results.length === 0) {
        alert('No significant similarities found. All papers appear to be original.');
      } else {
        alert(`Scan complete! Found ${results.length} similarity match${results.length !== 1 ? 'es' : ''} with similarity scores ranging from ${Math.min(...results.map(r => r.similarityScore)).toFixed(1)}% to ${Math.max(...results.map(r => r.similarityScore)).toFixed(1)}%.`);
      }
    }, 2500); // Slightly longer delay to simulate AI processing
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

  const handleSendToVetting = (paperId: string) => {
    setSubmittedPapers((prev) => {
      const base = stripDemoPaper(prev);
      const updated = base.map((paper) => {
        if (paper.id === paperId) {
          return { ...paper, status: 'in-vetting' as const };
        }
        return paper;
      });
      return ensureDemoPaper(updated);
    });
    
    void syncPaperStatusToSupabase(paperId, 'vetting_in_progress');
    alert('Paper has been sent to vetting successfully! It will remain in the vetting suite until the session is completed or advanced.');
  };

  return (
    <SectionCard
      title="Similarity Detection"
      kicker="Academic Integrity Check"
      description="Compare submitted exam papers with historical papers from previous semesters to detect potential similarities and ensure academic integrity."
    >
      <div className="space-y-4">
        <div className="relative overflow-hidden rounded-2xl border border-white/20 bg-gradient-to-br from-blue-50/80 via-indigo-50/70 to-purple-50/80 backdrop-blur-xl p-6 shadow-2xl shadow-blue-500/10">
          {/* Glassmorphism background effects */}
          <div className="absolute inset-0 bg-gradient-to-br from-white/40 via-transparent to-transparent"></div>
          <div className="absolute -top-20 -right-20 h-40 w-40 rounded-full bg-gradient-to-br from-blue-400/30 to-indigo-400/20 blur-3xl"></div>
          <div className="absolute -bottom-20 -left-20 h-40 w-40 rounded-full bg-gradient-to-br from-purple-400/30 to-pink-400/20 blur-3xl"></div>
          
          <div className="relative z-10">
            <h3 className="text-sm font-semibold text-slate-800 mb-4">Course Unit Selection</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs text-slate-600 mb-2">Select Course Unit</label>
                <select
                  value={selectedCourse}
                  onChange={(e) => {
                    setSelectedCourse(e.target.value);
                    setSimilarityResults([]);
                    setScanCompleted(false);
                  }}
                  className="w-full rounded-xl border border-white/40 bg-white/60 backdrop-blur-sm px-3 py-2.5 text-sm text-slate-800 shadow-lg focus:border-blue-400/60 focus:outline-none focus:ring-2 focus:ring-blue-400/30 transition-all"
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
                  className="w-full rounded-xl bg-gradient-to-r from-blue-500/80 via-indigo-500/80 to-purple-500/80 backdrop-blur-sm px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition-all hover:from-blue-500 hover:via-indigo-500 hover:to-purple-500 hover:shadow-xl hover:shadow-blue-500/40 hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                >
                  {isScanning ? 'Scanning...' : 'Run Similarity Scan'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {selectedCourse && (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-4">Team Lead Submissions (Current Semester)</h3>
            <div className="space-y-3">
              {submittedPapers
                .filter(p => {
                  if (!p.courseCode) return false;
                  // Only show Team Lead submissions in similarity detection
                  if (p.submittedRole !== 'Team Lead') return false;
                  return selectedCourse.includes(p.courseCode);
                })
                .map((paper) => {
                  // Check if this paper has similarity results
                  const paperResults = similarityResults.filter(r => r.paperId === paper.id);
                  const maxSimilarity = paperResults.length > 0 
                    ? Math.max(...paperResults.map(r => r.similarityScore))
                    : null;

                  return (
                    <div key={paper.id} className="group relative rounded-xl border-2 border-slate-200 bg-gradient-to-br from-white via-slate-50 to-blue-50 p-4 shadow-sm hover:shadow-xl hover:border-blue-300 transition-all duration-300 overflow-hidden">
                      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/0 via-indigo-500/0 to-purple-500/0 group-hover:from-blue-500/5 group-hover:via-indigo-500/5 group-hover:to-purple-500/5 transition-all duration-500"></div>
                      <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-blue-400/0 to-purple-400/0 group-hover:from-blue-400/10 group-hover:to-purple-400/10 rounded-full blur-2xl transition-all duration-500 -translate-y-1/2 translate-x-1/2"></div>
                      <div className="relative flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-slate-800">{paper.courseCode}</p>
                          <p className="text-xs text-slate-600 mt-1">{paper.fileName}</p>
                          <p className="text-xs text-slate-500 mt-1">
                            Submitted by: {paper.submittedBy}
                            {paper.submittedRole && (
                              <span className="ml-1 px-1.5 py-0.5 rounded text-[0.65rem] bg-indigo-100 text-indigo-700">
                                {paper.submittedRole}
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-slate-500">
                            {new Date(paper.submittedAt).toLocaleDateString()}
                          </p>
                          {maxSimilarity !== null && (
                            <p className="text-xs font-semibold mt-1">
                              Max Similarity: <span className={maxSimilarity >= 70 ? 'text-amber-600' : maxSimilarity >= 50 ? 'text-yellow-600' : 'text-blue-600'}>
                                {maxSimilarity.toFixed(1)}%
                              </span>
                            </p>
                          )}
                          {/* Send to Vetting Button - appears when similarity <= 30% OR scan completed with no results */}
                          {((maxSimilarity !== null && maxSimilarity <= 30) || (scanCompleted && maxSimilarity === null && similarityResults.length === 0)) && paper.status !== 'in-vetting' && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleSendToVetting(paper.id);
                              }}
                              className="mt-3 w-full rounded-xl bg-gradient-to-r from-green-500 via-emerald-500 to-teal-500 px-4 py-3 text-sm font-bold text-white shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all duration-300 flex items-center justify-center gap-2 relative overflow-hidden group"
                            >
                              <span className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000"></span>
                              <span className="text-lg relative z-10">✓</span>
                              <span className="relative z-10">Send to Vetting</span>
                            </button>
                          )}
                          {paper.status === 'in-vetting' && (
                            <div className="mt-3 px-3 py-2 rounded-lg bg-green-100 border-2 border-green-400">
                              <p className="text-xs font-bold text-green-800 flex items-center gap-1.5">
                                <span className="text-base">✓</span>
                                <span>Sent to Vetting</span>
                              </p>
                            </div>
                          )}
                        </div>
                        <span className={`text-xs ${maxSimilarity !== null ? (maxSimilarity >= 70 ? 'text-amber-600' : maxSimilarity >= 50 ? 'text-yellow-600' : 'text-blue-600') : 'text-blue-600'}`}>
                          {maxSimilarity !== null ? `Scanned (${maxSimilarity.toFixed(1)}%)` : 'Ready for Scan'}
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {(similarityResults.length > 0 || scanCompleted) && (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">Similarity Detection Results</h3>
              {similarityResults.length > 0 && (
                <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-gradient-to-r from-blue-50 to-indigo-50 text-indigo-700 border border-indigo-200">
                  {similarityResults.length} match{similarityResults.length !== 1 ? 'es' : ''} found
                </span>
              )}
            </div>
            {similarityResults.length === 0 && scanCompleted ? (
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 border-2 border-green-200 p-8 text-center">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(16,185,129,0.1),transparent_50%)]"></div>
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,_rgba(5,150,105,0.1),transparent_50%)]"></div>
                <div className="relative z-10">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 mb-4 shadow-lg">
                    <span className="text-3xl">✓</span>
                  </div>
                  <p className="text-lg font-bold text-green-700 mb-2">Scan Complete</p>
                  <p className="text-sm text-slate-700 mb-6">
                    No significant similarities found. All papers appear to be original and ready for vetting.
                  </p>
                  {/* Show Send to Vetting buttons for all scanned papers */}
                  <div className="space-y-3">
                    {submittedPapers
                      .filter(p => {
                        if (!p.courseCode) return false;
                        const [courseCode] = selectedCourse.split(' - ');
                        return p.courseCode === courseCode && p.status !== 'in-vetting';
                      })
                      .map((paper) => (
                        <button
                          key={paper.id}
                          type="button"
                          onClick={() => void handleSendToVetting(paper.id)}
                          className="w-full rounded-xl bg-gradient-to-r from-green-500 via-emerald-500 to-teal-500 px-6 py-3 text-sm font-bold text-white shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all duration-300 flex items-center justify-center gap-2 relative overflow-hidden group"
                        >
                          <span className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000"></span>
                          <span className="text-lg relative z-10">✓</span>
                          <span className="relative z-10">Send {paper.fileName} to Vetting</span>
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-96 overflow-y-auto pr-2">
              {similarityResults.map((result, idx) => {
                const currentPaper = submittedPapers.find(p => p.id === result.paperId);
                const historicalPaper = allRepositoryPapers.find(p => p.id === result.historicalPaperId);
                
                const getRiskIcon = (risk: string) => {
                  switch (risk) {
                    case 'critical': return '🔴';
                    case 'high': return '🟠';
                    case 'medium': return '🟡';
                    case 'low': return '🔵';
                    default: return '⚪';
                  }
                };

                const getRiskGradient = (risk: string) => {
                  switch (risk) {
                    case 'critical': return 'from-rose-50 via-red-50 to-pink-50 border-rose-300';
                    case 'high': return 'from-amber-50 via-orange-50 to-yellow-50 border-amber-300';
                    case 'medium': return 'from-yellow-50 via-amber-50 to-orange-50 border-yellow-300';
                    case 'low': return 'from-blue-50 via-indigo-50 to-cyan-50 border-blue-300';
                    default: return 'from-slate-50 to-gray-50 border-slate-300';
                  }
                };

                const getRiskIconBg = (risk: string) => {
                  switch (risk) {
                    case 'critical': return 'bg-gradient-to-br from-rose-500 to-red-600';
                    case 'high': return 'bg-gradient-to-br from-amber-500 to-orange-600';
                    case 'medium': return 'bg-gradient-to-br from-yellow-500 to-amber-600';
                    case 'low': return 'bg-gradient-to-br from-blue-500 to-indigo-600';
                    default: return 'bg-gradient-to-br from-slate-400 to-gray-500';
                  }
                };
                
                return (
                  <div
                    key={idx}
                    className={`group relative rounded-2xl border-2 bg-gradient-to-br ${getRiskGradient(result.riskLevel)} p-4 shadow-lg hover:shadow-2xl transition-all duration-300 cursor-pointer overflow-hidden transform hover:scale-[1.02]`}
                    onClick={() => setShowDetails(showDetails === `${idx}` ? null : `${idx}`)}
                  >
                    {/* Animated background effects */}
                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500">
                      <div className="absolute inset-0 bg-gradient-to-br from-white/20 via-transparent to-transparent"></div>
                      <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-white/10 to-transparent rounded-full blur-3xl transform translate-x-1/2 -translate-y-1/2"></div>
                    </div>
                    
                    {/* Icon Badge */}
                    <div className={`absolute -top-3 -right-3 w-12 h-12 ${getRiskIconBg(result.riskLevel)} rounded-full flex items-center justify-center text-white text-xl shadow-2xl transform group-hover:scale-125 group-hover:rotate-12 transition-all duration-300 z-10`}>
                      {getRiskIcon(result.riskLevel)}
                    </div>

                    {/* Main Content */}
                    <div className="pr-10 relative z-10">
                      {/* Score Display */}
                      <div className="flex items-baseline gap-2 mb-3">
                        <span className={`text-4xl font-black ${getScoreColor(result.similarityScore)} drop-shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                          {result.similarityScore}%
                        </span>
                        <span className={`px-3 py-1 rounded-full text-[0.65rem] font-bold uppercase tracking-wide ${getRiskColor(result.riskLevel)} border-2 shadow-md`}>
                          {result.riskLevel}
                        </span>
                      </div>

                      {/* File Names */}
                      <div className="space-y-2 mb-4">
                        <div className="flex items-start gap-2 p-2 rounded-lg bg-white/60 backdrop-blur-sm border border-white/50 group-hover:bg-white/80 transition-all duration-300">
                          <span className="text-lg mt-0.5">📄</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[0.7rem] font-bold text-slate-800 truncate" title={currentPaper?.fileName}>
                              {currentPaper?.fileName}
                            </p>
                            <p className="text-[0.65rem] text-slate-600 font-medium">Current</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-2 p-2 rounded-lg bg-white/60 backdrop-blur-sm border border-white/50 group-hover:bg-white/80 transition-all duration-300">
                          <span className="text-lg mt-0.5">📚</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[0.7rem] font-bold text-slate-800 truncate" title={`${historicalPaper?.fileName} (${historicalPaper?.semester} ${historicalPaper?.year})`}>
                              {historicalPaper?.fileName}
                            </p>
                            <p className="text-[0.65rem] text-slate-600 font-medium">{historicalPaper?.semester} {historicalPaper?.year}</p>
                          </div>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="space-y-2 relative z-10">
                        {/* Send to Vetting Button - appears when similarity <= 30% */}
                        {result.similarityScore <= 30 && currentPaper && currentPaper.status !== 'in-vetting' && (
                          <button
                            type="button"
                            className="w-full rounded-xl bg-gradient-to-r from-green-500 via-emerald-500 to-teal-500 px-3 py-2.5 text-[0.7rem] font-bold text-white shadow-lg hover:shadow-xl hover:scale-[1.03] transition-all duration-300 flex items-center justify-center gap-1.5 relative overflow-hidden group"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleSendToVetting(result.paperId);
                            }}
                          >
                            <span className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000"></span>
                            <span className="text-base relative z-10">✓</span>
                            <span className="relative z-10">Send to Vetting</span>
                          </button>
                        )}
                        {currentPaper && currentPaper.status === 'in-vetting' && (
                          <div className="w-full px-3 py-2 rounded-xl bg-gradient-to-r from-green-100 to-emerald-100 border-2 border-green-400 shadow-md">
                            <p className="text-[0.65rem] font-bold text-green-800 flex items-center justify-center gap-1.5">
                              <span className="text-base">✓</span>
                              <span>Sent to Vetting</span>
                            </p>
                          </div>
                        )}
                        <button
                          type="button"
                          className="w-full text-[0.7rem] font-semibold text-slate-700 hover:text-slate-900 py-2 px-3 rounded-xl bg-white/70 hover:bg-white/90 backdrop-blur-sm transition-all duration-300 border border-slate-300/50 hover:border-slate-400 hover:shadow-md"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowDetails(showDetails === `${idx}` ? null : `${idx}`);
                          }}
                        >
                          {showDetails === `${idx}` ? '▲ Hide Details' : '▼ Show Details'}
                        </button>
                      </div>
                    </div>
                    
                    {/* Expanded Details */}
                    {showDetails === `${idx}` && (
                      <div className="mt-4 pt-4 border-t-2 border-white/60 space-y-3 relative z-10 animate-in">
                        <div>
                          <p className="text-[0.7rem] font-bold text-slate-700 mb-1.5 flex items-center gap-1">
                            <span>🔍</span> Matched Sections
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {result.matchedSections.map((section, sIdx) => (
                              <span key={sIdx} className="px-2 py-0.5 rounded-md bg-white/80 text-[0.65rem] text-slate-700 border border-slate-200 shadow-sm">
                                {section}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[0.65rem]">
                          <div className="p-2 rounded-lg bg-white/60 border border-slate-200/50">
                            <p className="font-semibold text-slate-600 mb-0.5">Current Paper</p>
                            <p className="text-slate-800">{currentPaper?.courseCode}</p>
                            <p className="text-slate-600">{currentPaper?.semester} {currentPaper?.year}</p>
                          </div>
                          <div className="p-2 rounded-lg bg-white/60 border border-slate-200/50">
                            <p className="font-semibold text-slate-600 mb-0.5">Historical Paper</p>
                            <p className="text-slate-800">{historicalPaper?.courseCode}</p>
                            <p className="text-slate-600">{historicalPaper?.semester} {historicalPaper?.year}</p>
                          </div>
                        </div>
                        {result.similarityScore >= 70 && (
                          <div className="mt-2 p-2 rounded-lg bg-gradient-to-r from-amber-100 to-orange-100 border-2 border-amber-300/50 shadow-sm">
                            <p className="text-[0.65rem] font-semibold text-amber-800 flex items-center gap-1">
                              <span className="text-base">⚠️</span> High similarity detected. Review recommended before approval.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            )}
          </div>
        )}

        {!isScanning && !scanCompleted && similarityResults.length === 0 && selectedCourse && (
          <div className="rounded-xl border border-slate-200 bg-white p-5 text-center">
            <p className="text-sm text-slate-600">
              Click "Run Similarity Scan" to compare submitted papers with historical papers.
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

function _LecturerDashboardPanel({
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

interface RepositoryPapersPanelProps {
  repositoryPapers: RepositoryPaper[];
  users: User[];
}

function RepositoryPapersPanel({ repositoryPapers, users }: RepositoryPapersPanelProps) {
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [userNameCache, setUserNameCache] = useState<Record<string, string>>({});
  const fetchedUserIdsRef = useRef<Set<string>>(new Set());

  // Helper function to get submitter name from UUID or name
  const getSubmitterName = useCallback((submittedBy: string): string => {
    // Check if submittedBy looks like a UUID (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(submittedBy);
    
    // If it's a UUID, try to find the user
    if (isUUID) {
      // First check local users array
      const user = users.find(u => u.id === submittedBy);
      if (user && user.name) {
        return user.name;
      }
      
      // Then check cache
      const cachedName = userNameCache[submittedBy];
      if (cachedName) {
        return cachedName;
      }
      
      // If not found, fetch from Supabase
      if (!fetchedUserIdsRef.current.has(submittedBy)) {
        fetchedUserIdsRef.current.add(submittedBy);
        
        (async () => {
          try {
            const { data, error } = await supabase
              .from('user_profiles')
              .select('id, name')
              .eq('id', submittedBy)
              .single();
            
            if (!error && data && data.name) {
              setUserNameCache(prev => ({ ...prev, [submittedBy]: data.name }));
            }
          } catch (err: unknown) {
            console.error('Error fetching user name:', err);
          } finally {
            fetchedUserIdsRef.current.delete(submittedBy);
          }
        })();
      }
      
      return 'Loading...';
    }
    
    // If it's not a UUID, return the submittedBy value (might already be a name)
    return submittedBy || 'Unknown';
  }, [users, userNameCache]);

  const toggleCard = (paperId: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(paperId)) {
        next.delete(paperId);
      } else {
        next.add(paperId);
      }
      return next;
    });
  };

  return (
    <SectionCard
      title="Repository Papers"
      kicker="Central Exam Repository"
      description="View all papers compiled and submitted by Team Lead. These papers are ready for Chief Examiner AI similarity analysis before vetting."
    >
      {repositoryPapers.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          No papers are currently in the repository for this semester.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {repositoryPapers.map((paper) => {
            const isExpanded = expandedCards.has(paper.id);
            const submitterName = getSubmitterName(paper.submittedBy);
            return (
              <div
                key={paper.id}
                className={`relative overflow-hidden rounded-xl border border-purple-200/50 bg-gradient-to-br from-purple-50 via-indigo-50 to-pink-50 p-4 transition-all duration-300 cursor-pointer hover:shadow-lg ${
                  isExpanded ? 'shadow-lg ring-2 ring-purple-300' : 'shadow-sm'
                }`}
                onClick={() => toggleCard(paper.id)}
              >
                {/* Document Icon */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100 text-purple-600 flex-shrink-0">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </span>
                    <h4 className="text-sm font-bold text-slate-800 truncate">{paper.fileName}</h4>
                  </div>
                </div>

                {/* Status Tags */}
                <div className="flex flex-wrap items-center gap-1.5 mb-3">
                  <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-purple-100 text-purple-700 border border-purple-200">
                    Repository
                  </span>
                  {paper.courseCode && (
                    <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-purple-200 text-purple-800 border border-purple-300">
                      {paper.courseCode}
                    </span>
                  )}
                  {paper.submittedRole && (
                    <span className={`px-2 py-0.5 rounded-md text-xs font-semibold border ${
                      paper.submittedRole === 'Team Lead' 
                        ? 'bg-blue-100 text-blue-700 border-blue-300' 
                        : paper.submittedRole === 'Setter'
                        ? 'bg-yellow-100 text-yellow-700 border-yellow-300'
                        : 'bg-indigo-100 text-indigo-700 border-indigo-300'
                    }`}>
                      {paper.submittedRole === 'Team Lead' ? 'Lead' : paper.submittedRole}
                    </span>
                  )}
                </div>

                {/* Author */}
                <p className="text-xs text-slate-600 mb-3">
                  <span className="font-medium">By:</span> {submitterName}
                </p>

                {/* Dropdown Chevron */}
                <div className="absolute bottom-3 right-3">
                  <svg
                    className={`h-5 w-5 text-purple-600 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-purple-200/50 space-y-2.5 animate-in fade-in slide-in-from-top-2" onClick={(e) => e.stopPropagation()}>
                    <div className="space-y-1.5 text-xs">
                      <p className="flex items-center gap-1.5 text-slate-700">
                        <span className="text-indigo-500">📚</span>
                        <span className="font-medium">Course:</span>
                        <span>{paper.courseUnit}</span>
                      </p>
                      <p className="flex items-center gap-1.5 text-slate-700">
                        <span className="text-emerald-500">👤</span>
                        <span className="font-medium">Submitted by:</span>
                        <span>{submitterName}</span>
                      </p>
                      <p className="flex items-center gap-1.5 text-slate-700">
                        <span className="text-blue-500">📅</span>
                        <span className="font-medium">Semester:</span>
                        <span>{paper.semester} {paper.year}</span>
                      </p>
                      <p className="flex items-center gap-1.5 text-slate-700">
                        <span className="text-violet-500">🕒</span>
                        <span className="font-medium">Added:</span>
                        <span>{new Date(paper.submittedAt).toLocaleString()}</span>
                      </p>
                      {paper.fileSize && (
                        <p className="flex items-center gap-1.5 text-slate-700">
                          <span className="text-amber-500">💾</span>
                          <span className="font-medium">Size:</span>
                          <span>{(paper.fileSize / 1024).toFixed(2)} KB</span>
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2 pt-2">
                      <button
                        type="button"
                        className="flex-1 px-3 py-2 rounded-lg bg-purple-500 hover:bg-purple-600 text-xs font-medium text-white transition"
                        onClick={(e) => {
                          e.stopPropagation();
                          const blob = new Blob([paper.content], {
                            type: 'application/pdf',
                          });
                          const url = URL.createObjectURL(blob);
                          window.open(url, '_blank');
                          setTimeout(() => URL.revokeObjectURL(url), 100);
                        }}
                      >
                        View PDF
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

// Compact Paper Cards Component - Shared component
function CompactPaperCards({ 
    papers, 
    getSubmitterName, 
    getStatusLabel, 
    getStatusColor, 
    getWorkflowStageForPaper,
    resolvePaperUrl 
  }: {
    papers: SubmittedPaper[];
    getSubmitterName: (paper: SubmittedPaper) => string;
    getStatusLabel: (status: string) => string;
    getStatusColor: (status: string) => string;
    getWorkflowStageForPaper: (paper: SubmittedPaper) => string;
    resolvePaperUrl: (url?: string) => string | null;
  }): JSX.Element {
    const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

    const toggleCard = (paperId: string) => {
      setExpandedCards(prev => {
        const next = new Set(prev);
        if (next.has(paperId)) {
          next.delete(paperId);
        } else {
          next.add(paperId);
        }
        return next;
      });
    };

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {papers.map((paper) => {
          const isExpanded = expandedCards.has(paper.id);
          const submitterName = getSubmitterName(paper);
          
          return (
            <div
              key={paper.id}
              className={`relative overflow-hidden rounded-xl border border-purple-200/50 bg-gradient-to-br from-purple-50 via-indigo-50 to-pink-50 p-4 transition-all duration-300 cursor-pointer hover:shadow-lg ${
                isExpanded ? 'shadow-lg ring-2 ring-purple-300' : 'shadow-sm'
              }`}
              onClick={() => toggleCard(paper.id)}
            >
              {/* Compact View */}
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-purple-100 text-purple-600 text-xs font-bold flex-shrink-0">
                      📄
                    </span>
                    <h4 className="text-sm font-semibold text-slate-800 truncate">{paper.fileName}</h4>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`px-2 py-0.5 rounded-md text-[0.65rem] font-medium ${getStatusColor(paper.status)}`}>
                      {getStatusLabel(paper.status)}
                    </span>
                    <span className="px-2 py-0.5 rounded-md text-[0.65rem] font-semibold bg-purple-100 text-purple-700 border border-purple-200">
                      {paper.submittedRole === 'Team Lead' ? 'Team Lead' : paper.submittedRole === 'Setter' ? 'Setter' : paper.submittedRole || 'Unknown'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-2 truncate">
                    <span className="font-medium">By:</span> {submitterName}
                  </p>
                </div>
                <div className="ml-2 flex-shrink-0">
                  <svg
                    className={`h-5 w-5 text-purple-600 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {/* Expanded Details */}
              {isExpanded && (
                <div className="mt-4 pt-4 border-t border-purple-200/50 space-y-2.5 animate-in fade-in slide-in-from-top-2">
                  <div className="space-y-1.5 text-xs">
                    <p className="flex items-center gap-1.5 text-slate-700">
                      <span className="text-indigo-500">📅</span>
                      <span className="font-medium">Submitted:</span>
                      <span>{new Date(paper.submittedAt).toLocaleString()}</span>
                    </p>
                    <p className="flex items-center gap-1.5 text-slate-700">
                      <span className="text-emerald-500">👤</span>
                      <span className="font-medium">By:</span>
                      <span>{submitterName}</span>
                    </p>
                    {paper.fileSize && (
                      <p className="flex items-center gap-1.5 text-slate-700">
                        <span className="text-blue-500">💾</span>
                        <span className="font-medium">Size:</span>
                        <span>{(paper.fileSize / 1024).toFixed(2)} KB</span>
                      </p>
                    )}
                    {paper.courseCode && paper.courseUnit && (
                      <p className="flex items-center gap-1.5 text-slate-700">
                        <span className="text-violet-500">📚</span>
                        <span className="font-medium">Course:</span>
                        <span>{paper.courseCode} - {paper.courseUnit}</span>
                      </p>
                    )}
                    <p className="flex items-center gap-1.5 text-slate-700">
                      <span className="text-amber-500">⚙️</span>
                      <span className="font-medium">Stage:</span>
                      <span>{getWorkflowStageForPaper(paper)}</span>
                    </p>
                  </div>
                  <div className="flex gap-2 pt-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-medium transition shadow-sm"
                      onClick={() => {
                        const publicUrl = resolvePaperUrl(paper.fileUrl);
                        if (!publicUrl) {
                          alert('No file is available to view for this paper yet.');
                          return;
                        }
                        window.open(publicUrl, '_blank');
                      }}
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                      View
                    </button>
                    <button
                      type="button"
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium transition shadow-sm"
                      onClick={() => {
                        const publicUrl = resolvePaperUrl(paper.fileUrl);
                        if (!publicUrl) {
                          alert('No file is available to download for this paper yet.');
                          return;
                        }
                        const link = document.createElement('a');
                        link.href = publicUrl;
                        link.download = paper.fileName || 'exam-paper.pdf';
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                      }}
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Download
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
}

interface ChiefExaminerDashboardPanelProps {
  workflow: WorkflowState;
  submittedPapers: SubmittedPaper[];
  setterSubmissions: SetterSubmission[];
  annotations: Annotation[];
  users: User[];
}

function ChiefExaminerDashboardPanel({
  workflow,
  submittedPapers,
  setterSubmissions,
  annotations,
  users,
}: ChiefExaminerDashboardPanelProps) {
  const effectiveStage = getEffectiveWorkflowStage(submittedPapers, workflow.stage);
  
  // Cache for user names fetched from database (using object for React state updates)
  const [userNameCache, setUserNameCache] = useState<Record<string, string>>({});
  const [cacheVersion, setCacheVersion] = useState(0); // Version counter to force re-renders
  const userNameCacheRef = useRef<Record<string, string>>({});
  const fetchedUserIdsRef = useRef<Set<string>>(new Set());
  
  // Sync ref with state
  useEffect(() => {
    userNameCacheRef.current = userNameCache;
  }, [userNameCache]);
  
  // Fetch user names for all UUIDs in submitted papers
  useEffect(() => {
    const fetchUserNames = async () => {
      // Collect all UUIDs from submitted papers that we haven't fetched yet
      const userIds = new Set<string>();
      submittedPapers.forEach(paper => {
        // Check if submittedBy looks like a UUID
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paper.submittedBy);
        if (isUUID) {
          // Check if we already have this user in local array
          const hasUser = users.find(u => u.id === paper.submittedBy && u.name);
          // Check if we've already fetched this UUID
          const alreadyFetched = fetchedUserIdsRef.current.has(paper.submittedBy);
          // Check if we have it in cache (using ref to avoid stale closure)
          const hasCached = userNameCacheRef.current[paper.submittedBy];
          
          if (!hasUser && !alreadyFetched && !hasCached) {
            userIds.add(paper.submittedBy);
          }
        }
      });
      
      if (userIds.size === 0) return;
      
      console.log('🔍 Fetching user names for UUIDs:', Array.from(userIds));
      
      // Mark these UUIDs as being fetched
      userIds.forEach(id => fetchedUserIdsRef.current.add(id));
      
      // Fetch user names from database
      try {
        const { data: profiles, error } = await supabase
          .from('user_profiles')
          .select('id, name')
          .in('id', Array.from(userIds));
        
        if (error) {
          console.error('❌ Error fetching user names:', error);
          // Remove from fetched set on error so we can retry
          userIds.forEach(id => fetchedUserIdsRef.current.delete(id));
          return;
        }
        
        if (profiles && profiles.length > 0) {
          console.log('✅ Fetched user names:', profiles.map(p => ({ id: p.id, name: p.name })));
          setUserNameCache(prev => {
            // Always create a new object to ensure React detects the change
            const updated = { ...prev };
            let hasNewNames = false;
            profiles.forEach(profile => {
              if (profile.name && updated[profile.id] !== profile.name) {
                updated[profile.id] = profile.name;
                hasNewNames = true;
              }
            });
            // Always return a new object reference to trigger re-render
            if (hasNewNames) {
              setCacheVersion(v => v + 1); // Increment version to force re-render
            }
            return { ...updated };
          });
        } else {
          console.warn('⚠️ No user profiles found for UUIDs:', Array.from(userIds));
        }
      } catch (error) {
        console.error('❌ Exception fetching user names from database:', error);
        // Remove from fetched set on error so we can retry
        userIds.forEach(id => fetchedUserIdsRef.current.delete(id));
      }
    };
    
    fetchUserNames();
  }, [submittedPapers, users]);
  
  // Helper to get user name from ID or submittedBy field
  const getSubmitterName = useCallback((paper: SubmittedPaper): string => {
    // Check if submittedBy looks like a UUID (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paper.submittedBy);
    
    // If it's a UUID, try to find the user
    if (isUUID) {
      // First check local users array
      const user = users.find(u => u.id === paper.submittedBy);
      if (user && user.name) {
        return user.name;
      }
      
      // Then check cache
      const cachedName = userNameCache[paper.submittedBy];
      if (cachedName) {
        return cachedName;
      }
      
      // Check if we're currently fetching this user
      const isFetching = fetchedUserIdsRef.current.has(paper.submittedBy);
      if (isFetching) {
        return 'Loading...'; // Show loading state while fetching
      }
      
      // Name not found yet and not being fetched
      return 'Unknown User';
    }
    
    // If it's not a UUID, return the submittedBy value (might already be a name)
    return paper.submittedBy || 'Unknown';
  }, [users, userNameCache]);

  // Helper functions for displaying paper status
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
        return 'Unknown';
    }
  };

  const getWorkflowStageForPaper = (paper: SubmittedPaper): string => {
    // If paper is submitted by Team Lead, it's a submission TO Chief Examiner
    if (paper.submittedRole === 'Team Lead' && paper.status === 'submitted') {
      return 'Submitted to Chief Examiner';
    }
    
    switch (paper.status) {
      case 'submitted':
        return 'Submitted to Team Lead';
      case 'in-vetting':
        return 'Vetting in Progress';
      case 'vetted':
        return 'Vetted & Returned to Chief Examiner';
      case 'approved':
        return 'Approved';
      default:
        return 'Unknown';
    }
  };

  const paperStatusData = useMemo(() => {
    const statusCounts: Record<SubmittedPaper['status'], number> = {
      'submitted': 0,
      'in-vetting': 0,
      'vetted': 0,
      'approved': 0,
    };

    // Count papers by status
    // For 'submitted' status, exclude Team Lead papers (they're shown separately as "Lead Submissions")
    // For 'in-vetting', 'vetted', and 'approved', include ALL papers regardless of role
    submittedPapers.forEach((paper) => {
      if (paper.status === 'submitted') {
        // Only count non-Team Lead papers in 'submitted' status
      if (paper.submittedRole !== 'Team Lead') {
          statusCounts[paper.status] += 1;
        }
      } else {
        // For 'in-vetting', 'vetted', and 'approved', count ALL papers
        statusCounts[paper.status] += 1;
      }
    });

    // Get Team Lead submissions count (only papers with status 'submitted')
    const leadSubmissionsCount = submittedPapers.filter(
      (p) => p.submittedRole === 'Team Lead' && p.status === 'submitted'
    ).length;

    // Build the data array with ALL status counts (show all stages)
    const data = Object.entries(statusCounts).map(([name, value]) => ({
      name,
      value,
    }));

    // Always add Team Lead submissions as a separate entry (even if 0, to show in legend)
    data.push({
      name: 'lead submissions',
      value: leadSubmissionsCount,
    });

    return data;
  }, [submittedPapers]);

  // Synthetic journey line so the chief examiner always sees progress up to
  // the current effective stage, even if the in-memory workflow was reset.
  const timelineData = useMemo(() => {
    const orderedStages: WorkflowStage[] = [
      'Awaiting Setter',
      'Submitted to Team Lead',
      'Compiled for Vetting',
      'Vetting in Progress',
      'Vetted & Returned to Chief Examiner',
      'Revision Complete',
      'Approved',
    ];

    const currentIndex = orderedStages.indexOf(effectiveStage as WorkflowStage);
    const lastIndex = currentIndex === -1 ? 0 : currentIndex;

    return orderedStages.slice(0, lastIndex + 1).map((stage, index) => ({
      step: index + 1,
      label: stage,
      stageIndex: index + 1,
    }));
  }, [effectiveStage]);

  // Setter submissions: only count papers submitted by Setters (not Team Lead)
  const totalSubmissions =
    setterSubmissions.length > 0
      ? setterSubmissions.length
      : submittedPapers.filter(
          (p) => p.status === 'submitted' && (p.submittedRole === 'Setter' || !p.submittedRole || p.submittedRole === 'Unknown')
        ).length;

  // Lead submissions: count all papers submitted by Team Lead (regardless of status)
  // This separates Team Lead submissions from Setter submissions
  const _totalLeadSubmissions = submittedPapers.filter(
    (p) => p.submittedRole === 'Team Lead'
  ).length;
  const totalAnnotations = annotations.length;

  const pieColours = ['#6366f1', '#22c55e', '#eab308', '#f97316', '#38bdf8']; // Added sky-400 for Team Lead submissions
  const lastEvent = workflow.timeline[workflow.timeline.length - 1];

  const nextSuggestedStep = (() => {
    switch (effectiveStage) {
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

  const teamLeadSubmissions = submittedPapers.filter((p) => p.submittedRole === 'Team Lead');
  const hasTeamLeadSubmissions = teamLeadSubmissions.length > 0;

  return (
    <SectionCard
      title="Chief Examiner Dashboard"
      kicker="Exam Processes & Overview"
      description="AI-styled cockpit showing how papers move through setting, vetting, approval and secure print preparation."
    >
      <div className="space-y-5">
        {/* Alert for Team Lead Submissions */}
        {hasTeamLeadSubmissions && (
          <div className="rounded-2xl border-2 border-indigo-300 bg-gradient-to-r from-indigo-100 via-purple-100 to-pink-100 px-5 py-4 shadow-lg">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  className="h-6 w-6 text-indigo-600"
                  fill="currentColor"
                >
                  <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8Zm1-13a1 1 0 0 0-2 0v4a1 1 0 0 0 .293.707l2.828 2.829a1 1 0 1 0 1.415-1.415L13 11.586V7Z" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-bold text-indigo-900 mb-1">
                  Team Lead Submissions Awaiting Your Review
                </h3>
                <p className="text-xs text-indigo-700 mb-2">
                  {teamLeadSubmissions.length} paper{teamLeadSubmissions.length !== 1 ? 's' : ''} submitted by Team Lead {teamLeadSubmissions.length !== 1 ? 'are' : 'is'} ready for your AI similarity analysis before forwarding to vetting.
                </p>
                <p className="text-xs font-semibold text-indigo-800">
                  📍 Scroll down to the <strong>"Submissions from Team Lead"</strong> section below to view and process these papers.
                </p>
              </div>
            </div>
          </div>
        )}

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
                {effectiveStage}
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
            {/* Legend for statuses including lead submissions */}
            <div className="relative mt-3 grid grid-cols-2 gap-2 text-[0.7rem] text-slate-600">
              {paperStatusData.map((entry, index) => (
                <div key={entry.name} className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: pieColours[index % pieColours.length] }}
                  />
                  <span className="capitalize">
                    {entry.name === 'lead submissions' 
                      ? 'Lead submissions (compiled / forwarded)' 
                      : entry.name}
                  </span>
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

      {/* Team Lead Submissions Section - Added to Dashboard for visibility */}
      {submittedPapers.filter((p) => p.submittedRole === 'Team Lead').length > 0 && (
        <div className="mt-6">
          <SectionCard
            title="Submissions from Team Lead"
            kicker="Compiled Papers for Chief Examiner"
            description="View all papers compiled and submitted by Team Lead. These papers are ready for Chief Examiner AI similarity analysis before vetting."
          >
            <CompactPaperCards 
              papers={submittedPapers.filter((p) => p.submittedRole === 'Team Lead')}
              getSubmitterName={getSubmitterName}
              getStatusLabel={getStatusLabel}
              getStatusColor={getStatusColor}
              getWorkflowStageForPaper={getWorkflowStageForPaper}
              resolvePaperUrl={resolvePaperUrl}
            />
          </SectionCard>
        </div>
      )}
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
  const effectiveStage = getEffectiveWorkflowStage(submittedPapers, workflow.stage);

  const stages: Array<{ id: WorkflowStage | 'Printing'; label: string }> = [
    { id: 'Awaiting Setter', label: 'Paper is being set' },
    { id: 'Submitted to Team Lead', label: 'Team Lead collecting drafts' },
    { id: 'Compiled for Vetting', label: 'Compiled for moderation' },
    { id: 'Vetting in Progress', label: 'Vetting & annotations' },
    { id: 'Revision Complete', label: 'Revised & sanitized' },
    { id: 'Approved', label: 'Approved by Chief Examiner' },
    { id: 'Printing', label: 'Released for secure printing' },
  ];

  const currentIndex = stages.findIndex((s) => s.id === effectiveStage);
  const effectiveIndex =
    currentIndex === -1 && effectiveStage === 'Vetted & Returned to Chief Examiner'
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
            <span className="font-semibold text-indigo-700">{effectiveStage}</span>
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

function _LoginPortal({
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
  onReject: (notes: string) => Promise<void>;
  onRestartWorkflow: () => void;
  sectionId?: string;
}

function WorkflowOrchestration({
  workflow,
  annotations,
  versionHistory,
  currentUser: _currentUser,
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
                onClick={async () => {
                  await onReject(approvalNotes);
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
  workflow?: WorkflowState;
  vettingSession: VettingSessionState;
  annotations: Annotation[];
  safeBrowserPolicies: string[];
  checklist: typeof digitalChecklist;
  customChecklistPdf?: { url: string; name: string; isWordDoc?: boolean } | null;
  vettingCountdown: string | null;
  userHasRole: (role: Role) => boolean;
  onStartVetting: (minutes: number) => void;
  onCompleteVetting: () => void;
  onAddAnnotation: (comment: string) => void;
  submittedPapers?: SubmittedPaper[];
  moderationSchedule?: ModerationSchedule;
  onScheduleModeration?: (startDateTime: string) => void;
  moderationStartCountdown?: string | null;
  moderationEndCountdown?: string | null;
  sectionId?: string;
  currentUserId?: string;
  joinedVetters?: Set<string>;
  restrictedVetters?: Set<string>;
  vetterMonitoring?: Map<string, VetterMonitoring>;
  logVetterWarning?: (vetterId: string, type: VetterWarning['type'], message: string, severity?: 'warning' | 'critical') => void;
  onReactivateVetter?: (vetterId: string) => void;
  users?: User[];
  checklistComments?: Map<string, { comment: string; vetterName: string; timestamp: number; color: string }>;
  onChecklistCommentChange?: (key: string, comment: string | null, color?: string) => void;
  typingIndicators?: Map<string, string[]>;
  onChecklistTypingChange?: (key: string, isTyping: boolean) => void;
  checklistDraftText?: Map<string, Map<string, { text: string; vetterName: string }>>;
  onChecklistDraftChange?: (key: string, draftText: string) => void;
  onUploadChecklist?: (file: File) => void;
  onRemoveChecklist?: () => void;
  onRemovePaperFromVetting?: (paperId: string) => void;
  onEndSession?: () => void;
  onApprove?: (notes: string) => void;
  onReject?: (notes: string, newDeadline?: { days: number; hours: number; minutes: number }) => Promise<void>;
  onForwardChecklist?: (decision: 'approved' | 'rejected', notes: string) => void;
  onDownloadChecklistPacket?: () => void;
}

type ChecklistSectionKey = 'courseOutline' | 'bloomsTaxonomy' | 'compliance';

// Checklist Preview Content Component
const ChecklistPreviewContent = ({
  comments,
  hasCustomChecklistPdf,
  showVetterNames,
}: {
  comments: Map<string, { comment: string; vetterName: string; timestamp: number; color: string }>;
  hasCustomChecklistPdf: boolean;
  showVetterNames: boolean;
}) => {
  const sectionConfigs = hasCustomChecklistPdf ? pdfChecklistSectionConfigs : defaultChecklistSectionConfigs;
  
  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h3 className="text-base font-bold text-slate-800 mb-2">SECTION COMMENTS</h3>
        <div className="space-y-4">
          {sectionConfigs.map((section) => {
            const sectionComment = comments.get(section.id);
            if (!sectionComment?.comment) return null;
            return (
              <div key={section.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h4 className="text-sm font-semibold text-slate-800 mb-2">{section.title}</h4>
                <p className="text-sm text-slate-700 mb-2">{sectionComment.comment}</p>
                {showVetterNames ? (
                  <p className="text-xs text-slate-500">
                    Added by: <span className="font-semibold">{sectionComment.vetterName}</span> on {new Date(sectionComment.timestamp).toLocaleString()}
                  </p>
                ) : (
                  <p className="text-xs text-slate-500">
                    Added on: {new Date(sectionComment.timestamp).toLocaleString()}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
      
      {/* Item-Level Comments section removed as per requirements */}
    </div>
  );
};

function VettingAndAnnotations({
  workflowStage,
  workflow,
  vettingSession,
  annotations: _annotations,
  safeBrowserPolicies: _safeBrowserPolicies,
  checklist,
  customChecklistPdf,
  vettingCountdown,
  userHasRole,
  onStartVetting,
  onCompleteVetting,
  onAddAnnotation,
  submittedPapers = [],
  moderationSchedule,
  onScheduleModeration,
  moderationStartCountdown,
  moderationEndCountdown,
  sectionId,
          currentUserId,
          joinedVetters = new Set(),
          restrictedVetters = new Set(),
          vetterMonitoring,
          logVetterWarning: _logVetterWarning,
          onReactivateVetter,
          users = [],
          checklistComments = new Map(),
          onChecklistCommentChange,
          typingIndicators = new Map(),
          onChecklistTypingChange,
          checklistDraftText = new Map(),
          onChecklistDraftChange,
  onUploadChecklist,
  onRemoveChecklist,
  onRemovePaperFromVetting,
          onEndSession,
          onApprove,
          onReject,
  onForwardChecklist,
  onDownloadChecklistPacket,
}: VettingAndAnnotationsProps) {
  const [annotationDraft, setAnnotationDraft] = useState('');
  const [forwardDecision, setForwardDecision] = useState<'approved' | 'rejected' | ''>('');
  const [forwardNotes, setForwardNotes] = useState('');
  const [showChecklistPreview, setShowChecklistPreview] = useState(false);
  const [showRejectionModal, setShowRejectionModal] = useState(false);
  const [chiefRejectionComment, setChiefRejectionComment] = useState('');
  const [showDeadlineRejectionModal, setShowDeadlineRejectionModal] = useState(false);
  const [rejectionNotes, setRejectionNotes] = useState('');
  const [deadlineDays, setDeadlineDays] = useState(3);
  const [deadlineHours, setDeadlineHours] = useState(0);
  const [deadlineMinutes, setDeadlineMinutes] = useState(0);
  const checklistUploadInputRef = useRef<HTMLInputElement | null>(null);
  const isChiefExaminer = userHasRole('Chief Examiner');
  const isVetter = userHasRole('Vetter');
  const vetterHasJoined = currentUserId ? joinedVetters.has(currentUserId) : false;
  const isVetterRestricted = currentUserId ? restrictedVetters.has(currentUserId) : false;
  const showVetterFocusedLayout = isVetter && !isChiefExaminer;
  
  // Simple color selection for text comments (like Word document text color)
  const [selectedColor, setSelectedColor] = useState('#2563EB');
  const textColors = [
    { name: 'Blue', value: '#2563EB' },
    { name: 'Red', value: '#DC2626' },
    { name: 'Green', value: '#059669' },
    { name: 'Orange', value: '#F97316' },
    { name: 'Purple', value: '#A855F7' },
    { name: 'Yellow', value: '#EAB308' },
    { name: 'Pink', value: '#EC4899' },
    { name: 'Black', value: '#000000' },
  ];
  const getTypingStatus = (commentKey: string): string | null => {
    const names = typingIndicators?.get(commentKey) ?? [];
    if (!names || names.length === 0) {
      return null;
    }
    if (names.length === 1) {
      return `${names[0]} is typing…`;
    }
    if (names.length === 2) {
      return `${names[0]} and ${names[1]} are typing…`;
    }
    return `${names[0]}, ${names[1]} +${names.length - 2} more are typing…`;
  };

  const _SectionCommentArea = ({
    sectionKey,
    label,
    accentColor,
  }: {
    sectionKey: ChecklistSectionKey;
    label: string;
    accentColor: string;
  }) => {
    const commentKey = `section-${sectionKey}`;
    const comment = checklistComments?.get(commentKey);
    const [sectionDraft, setSectionDraft] = useState(comment?.comment ?? '');
    const typingStatus = getTypingStatus(commentKey);

    // Get draft text from other vetters (excluding current user)
    const otherVettersDrafts = useMemo(() => {
      if (!checklistDraftText || !currentUserId) return [];
      const drafts = checklistDraftText.get(commentKey);
      if (!drafts) return [];
      return Array.from(drafts.entries())
        .filter(([vetterId]) => vetterId !== currentUserId)
        .map(([vetterId, { text, vetterName }]) => ({ vetterId, text, vetterName }));
    }, [checklistDraftText, commentKey, currentUserId]);

    useEffect(() => {
      setSectionDraft(comment?.comment ?? '');
    }, [comment?.comment, commentKey]);

    const canEditSection = isVetter && vetterHasJoined && Boolean(onChecklistCommentChange);
    const canClearSection = Boolean(comment) && Boolean(onChecklistCommentChange);

    return (
      <div className="rounded-lg border border-slate-200 bg-white/80 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold"
            style={{
              color: accentColor,
              borderColor: accentColor,
              backgroundColor: `${accentColor}10`,
            }}
          >
            ✎
          </span>
          <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-700">
            {label} Section Comment
          </p>
        </div>
        {canEditSection ? (
          <>
            <textarea
              value={sectionDraft}
              onChange={(event) => {
                const newValue = event.target.value;
                setSectionDraft(newValue);
                onChecklistTypingChange?.(commentKey, true);
                // Broadcast draft text in real-time for collaboration
                if (onChecklistDraftChange) {
                  onChecklistDraftChange(commentKey, newValue);
                }
              }}
              onFocus={() => onChecklistTypingChange?.(commentKey, true)}
              onBlur={() => {
                onChecklistTypingChange?.(commentKey, false);
                // Clear draft when blurring if empty
                if (!sectionDraft.trim() && onChecklistDraftChange) {
                  onChecklistDraftChange(commentKey, '');
                }
              }}
              placeholder="Capture the overall observations for this section."
              className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-[0.7rem] text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
              rows={3}
            />
            {typingStatus && (
              <p className="text-[0.55rem] text-emerald-600">{typingStatus}</p>
            )}
            {/* Show other vetters' draft text in real-time */}
            {otherVettersDrafts.length > 0 && (
              <div className="space-y-1.5">
                {otherVettersDrafts.map(({ vetterId, text, vetterName }) => (
                  <div
                    key={vetterId}
                    className="rounded border border-slate-200 bg-slate-50/80 px-2 py-1.5 text-[0.65rem]"
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[0.6rem] font-semibold text-slate-600">{vetterName}</span>
                      <span className="text-[0.55rem] text-slate-400">is typing...</span>
                    </div>
                    <p className="text-slate-700 italic">{text}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2 text-[0.6rem]">
              <button
                type="button"
                disabled={!sectionDraft.trim()}
                onClick={() => {
                  if (!onChecklistCommentChange) return;
                  onChecklistCommentChange(commentKey, sectionDraft.trim(), accentColor);
                  onChecklistTypingChange?.(commentKey, false);
                  // Clear draft when saved
                  if (onChecklistDraftChange) {
                    onChecklistDraftChange(commentKey, '');
                  }
                }}
                className="rounded bg-blue-600 px-3 py-1 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save Section Comment
              </button>
              <button
                type="button"
                disabled={!sectionDraft && !canClearSection}
                onClick={() => {
                  if (!onChecklistCommentChange) return;
                  onChecklistCommentChange(commentKey, null);
                  setSectionDraft('');
                  onChecklistTypingChange?.(commentKey, false);
                  // Clear draft when cleared
                  if (onChecklistDraftChange) {
                    onChecklistDraftChange(commentKey, '');
                  }
                }}
                className="rounded bg-slate-200 px-3 py-1 font-semibold text-slate-700 transition hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Clear
              </button>
            </div>
          </>
        ) : (
          <div className="rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-[0.65rem] text-slate-600">
            {comment ? (
              <>
                <p className="font-semibold text-slate-800">{comment.comment}</p>
                <p className="mt-1 text-[0.55rem] text-slate-500">
                  - {comment.vetterName} ({new Date(comment.timestamp).toLocaleString()})
                </p>
              </>
            ) : (
              <p>No section comment captured yet.</p>
            )}
          </div>
        )}
        {comment && canEditSection && (
          <p className="text-[0.55rem] text-slate-500">
            Last saved by {comment.vetterName} at {new Date(comment.timestamp).toLocaleTimeString()}
          </p>
        )}
      </div>
    );
  };
  
  // Use submittedPapers from props
  const papersToDisplay = submittedPapers.length > 0 ? submittedPapers : [];
  
  // Default to 30 minutes from now for start
  const defaultStartDateTime = new Date(Date.now() + 30 * 60 * 1000).toISOString().slice(0, 16);
  
  // Beautiful Comment Card Component with smooth hover effects
  const CommentCard = ({ 
    comment, 
    vetterName, 
    timestamp, 
    color 
  }: { 
    comment: string; 
    vetterName: string; 
    timestamp: number; 
    color: string;
  }) => {
    // Convert hex color to RGB for gradient effect
    const hexToRgb = (hex: string) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      } : { r: 37, g: 99, b: 235 }; // Default blue
    };

    const rgb = hexToRgb(color);
    const formattedDate = new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="group relative ml-3.5 overflow-hidden rounded-xl border-2 transition-all duration-500 ease-out"
        style={{
          borderColor: `${color}40`,
          background: `linear-gradient(135deg, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.05) 0%, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.02) 100%)`,
        }}
        whileHover={{
          scale: 1.02,
          boxShadow: `0 20px 40px -12px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)`,
        }}
      >
        {/* Animated gradient overlay on hover */}
        <div 
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
          style={{
            background: `linear-gradient(135deg, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.1) 0%, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.05) 50%, transparent 100%)`,
          }}
        />
        
        {/* Shimmer effect on hover */}
        <div 
          className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out"
          style={{
            background: `linear-gradient(90deg, transparent, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.2), transparent)`,
          }}
        />

        {/* Content */}
        <div className="relative z-10 p-3.5">
          {/* Comment text with color accent */}
          <div className="mb-2.5">
            <p 
              className="text-sm font-medium leading-relaxed transition-colors duration-300"
              style={{ color: color }}
            >
              {comment}
            </p>
          </div>

          {/* Footer with vetter info and timestamp */}
          <div className="flex items-center justify-between gap-3 pt-2.5 border-t border-slate-200/50">
            <div className="flex items-center gap-2">
              {/* Avatar circle with gradient */}
              <div 
                className="flex h-7 w-7 items-center justify-center rounded-full font-semibold text-white text-xs shadow-md transition-transform duration-300 group-hover:scale-110"
                style={{
                  background: `linear-gradient(135deg, ${color} 0%, ${color}dd 100%)`,
                }}
              >
                {vetterName.charAt(0).toUpperCase()}
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-slate-700">{vetterName}</span>
                <span className="text-[0.6rem] text-slate-500">{formattedDate}</span>
              </div>
            </div>
            
            {/* Decorative icon */}
            <motion.div
              className="opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              animate={{ rotate: [0, 10, -10, 0] }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <svg 
                className="w-4 h-4" 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
                style={{ color: color }}
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </motion.div>
          </div>
        </div>

        {/* Corner accent */}
        <div 
          className="absolute top-0 right-0 w-20 h-20 opacity-0 group-hover:opacity-20 transition-opacity duration-500"
          style={{
            background: `radial-gradient(circle at top right, ${color}, transparent)`,
          }}
        />
      </motion.div>
    );
  };
  
  // Editable Checklist Item Component - Simple working textarea
  const EditableChecklistItem = ({ 
    item, 
    category: _category, 
    bulletColor, 
    commentKey 
  }: { 
    item: string; 
    category: string; 
    bulletColor: string;
    commentKey: string;
  }) => {
    const comment = checklistComments?.get(commentKey);
    const [editText, setEditText] = useState(comment?.comment || '');
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const typingStatus = getTypingStatus(commentKey);

    // Update text when comment changes
    useEffect(() => {
      setEditText(comment?.comment || '');
    }, [comment?.comment]);

    // Cleanup timeout on unmount
    useEffect(() => {
      return () => {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
        onChecklistTypingChange?.(commentKey, false);
      };
    }, [commentKey, onChecklistTypingChange]);

    // Handle text change - simple and direct
    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      setEditText(newValue);
      onChecklistTypingChange?.(commentKey, true);
      
      // Broadcast draft text in real-time for collaboration
      if (onChecklistDraftChange) {
        onChecklistDraftChange(commentKey, newValue);
      }
      
      // Auto-save after 500ms of no typing
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      
      if (onChecklistCommentChange) {
        const colorToUse = selectedColor || '#2563EB';
        saveTimeoutRef.current = setTimeout(() => {
          onChecklistCommentChange(commentKey, newValue.trim() || null, colorToUse);
          if (!newValue.trim()) {
            onChecklistTypingChange?.(commentKey, false);
            // Clear draft when empty
            if (onChecklistDraftChange) {
              onChecklistDraftChange(commentKey, '');
            }
          }
        }, 500);
      }
    };

    // Show read-only for Chief Examiner
    if (isChiefExaminer) {
      return (
        <li className="flex items-start gap-2">
          <span className="mt-1 h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: bulletColor }} />
          <div className="flex-1">
            <p className="text-xs text-slate-700 mb-1">{item}</p>
            {comment?.comment ? (
              <CommentCard
                comment={comment.comment}
                vetterName={comment.vetterName}
                timestamp={comment.timestamp}
                color={comment.color}
              />
            ) : (
              <div className="min-h-[32px] rounded border-2 border-dashed border-slate-200 bg-slate-50 px-2 py-1.5">
                <p className="text-xs text-slate-400">No comment yet</p>
              </div>
            )}
          </div>
        </li>
      );
    }

    // Get draft text from other vetters (excluding current user)
    const otherVettersDrafts = useMemo(() => {
      if (!checklistDraftText || !currentUserId) return [];
      const drafts = checklistDraftText.get(commentKey);
      if (!drafts) return [];
      return Array.from(drafts.entries())
        .filter(([vetterId]) => vetterId !== currentUserId)
        .map(([vetterId, { text, vetterName }]) => ({ vetterId, text, vetterName }));
    }, [checklistDraftText, commentKey, currentUserId]);

    // Simple working textarea for vetters
    return (
      <li className="flex items-start gap-2">
        <span className="mt-1 h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: bulletColor }} />
        <div className="flex-1">
          <p className="text-xs text-slate-700 mb-1">{item}</p>
          <textarea
            value={editText}
            onChange={handleTextChange}
            onFocus={() => onChecklistTypingChange?.(commentKey, true)}
            onBlur={() => onChecklistTypingChange?.(commentKey, false)}
            className="w-full rounded border-2 border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-y"
            style={{ 
              borderColor: selectedColor || bulletColor,
            }}
            rows={3}
            placeholder="Type your comment here..."
          />
          {typingStatus && (
            <p className="mt-1 text-[0.55rem] text-emerald-600">{typingStatus}</p>
          )}
          {/* Show other vetters' draft text in real-time */}
          {otherVettersDrafts.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {otherVettersDrafts.map(({ vetterId, text, vetterName }) => (
                <div
                  key={vetterId}
                  className="rounded border border-slate-200 bg-slate-50/80 px-2 py-1.5 text-xs"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-[0.6rem] font-semibold text-slate-600">{vetterName}</span>
                    <span className="text-[0.55rem] text-slate-400">is typing...</span>
                  </div>
                  <p className="text-slate-700 italic">{text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </li>
    );
  };

  // Helper component to render checklist item with individual comment functionality
  const _ChecklistItem = ({ item, category, bulletColor }: { item: string; category: string; bulletColor: string }) => {
    const commentKey = `${category}-${item}`;
    const comment = checklistComments?.get(commentKey);
    const [itemDraft, setItemDraft] = useState(comment?.comment ?? '');

    useEffect(() => {
      setItemDraft(comment?.comment ?? '');
    }, [comment?.comment, commentKey]);

    const canEditItem = isVetter && vetterHasJoined && Boolean(onChecklistCommentChange);
    const canClearItem = Boolean(comment) && Boolean(onChecklistCommentChange);

    // Auto-save when text changes and color is selected
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setItemDraft(value);
      // Auto-save if color is selected
      if (value.trim() && selectedColor && onChecklistCommentChange) {
        onChecklistCommentChange(commentKey, value.trim(), selectedColor);
      }
    };

    // Save on blur
    const handleBlur = () => {
      if (itemDraft.trim() && selectedColor && onChecklistCommentChange) {
        onChecklistCommentChange(commentKey, itemDraft.trim(), selectedColor);
      }
    };

    return (
      <li className="space-y-1.5">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: bulletColor }} />
          <span className="leading-relaxed flex-1">{item}</span>
        </div>
        {/* Simple comment input for vetters - auto-saves when color is selected */}
        {canEditItem && (
          <div className="ml-3.5">
            <input
              type="text"
              value={itemDraft}
              onChange={handleInputChange}
              onBlur={handleBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                }
              }}
              placeholder="Type comment here (select color first)..."
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-[0.7rem] text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
            />
            {canClearItem && (
              <button
                type="button"
                onClick={() => {
                  if (!onChecklistCommentChange) return;
                  onChecklistCommentChange(commentKey, null);
                  setItemDraft('');
                }}
                className="mt-1 text-[0.6rem] text-red-600 hover:text-red-700 underline"
              >
                Clear
              </button>
            )}
          </div>
        )}
        {/* Display comment for chief examiner (read-only) with beautiful card */}
        {isChiefExaminer && comment && !canEditItem && (
          <CommentCard
            comment={comment.comment}
            vetterName={comment.vetterName}
            timestamp={comment.timestamp}
            color={comment.color}
          />
        )}
        {/* Display saved comment for vetters with beautiful card */}
        {canEditItem && comment && (
          <CommentCard
            comment={comment.comment}
            vetterName={comment.vetterName}
            timestamp={comment.timestamp}
            color={comment.color}
          />
        )}
      </li>
    );
  };
  
  const [startDateTime, setStartDateTime] = useState(defaultStartDateTime);
  
  // Calculate duration from scheduled times or use default
  const calculatedDuration = useMemo(() => {
    if (moderationSchedule?.scheduledStartTime && moderationSchedule?.scheduledEndTime) {
      const diffMs = moderationSchedule.scheduledEndTime - moderationSchedule.scheduledStartTime;
      return Math.max(DEFAULT_SESSION_MINUTES, Math.floor(diffMs / (60 * 1000))); // Convert to minutes, enforce minimum
    }
    return DEFAULT_SESSION_MINUTES; // Default fallback
  }, [moderationSchedule]);

  // Custom session duration state - allow user to customize
  const [customDuration, setCustomDuration] = useState<number>(calculatedDuration);
  
  // Update custom duration when calculated duration changes (but only if not already set by user)
  useEffect(() => {
    if (!vettingSession.active) {
      setCustomDuration(calculatedDuration);
    }
  }, [calculatedDuration, vettingSession.active]);
  const [selectedPaper, setSelectedPaper] = useState<SubmittedPaper | null>(
    papersToDisplay.find(p => p.status === 'in-vetting' || p.status === 'vetted') || papersToDisplay[0] || null
  );
  const inlinePaperUrl = useMemo(() => {
    if (!selectedPaper?.fileUrl) return null;
    return resolvePaperUrl(selectedPaper.fileUrl);
  }, [selectedPaper?.fileUrl]);

  // For vetters, get first two papers to display side by side
  const vetterPapers = isVetter && papersToDisplay.length >= 2 
    ? papersToDisplay.slice(0, 2) 
    : isVetter && papersToDisplay.length === 1
    ? [papersToDisplay[0]]
    : [];
  
  const getPaperUrl = (paper: SubmittedPaper) => {
    if (!paper?.fileUrl) return null;
    return resolvePaperUrl(paper.fileUrl);
  };

  // Track paper IDs to detect when papers are removed
  const paperIds = useMemo(() => papersToDisplay.map(p => p.id).sort().join(','), [papersToDisplay]);
  
  // Update selected paper when papers change
  useEffect(() => {
    // Clear selectedPaper if it's no longer in the papersToDisplay list
    if (selectedPaper && !papersToDisplay.find(p => p.id === selectedPaper.id)) {
      setSelectedPaper(papersToDisplay.find(p => p.status === 'in-vetting' || p.status === 'vetted') || papersToDisplay[0] || null);
    } else if (papersToDisplay.length > 0 && !selectedPaper) {
      setSelectedPaper(papersToDisplay.find(p => p.status === 'in-vetting' || p.status === 'vetted') || papersToDisplay[0] || null);
    }
  }, [paperIds, papersToDisplay, selectedPaper]);

  // Check if scheduled start time has been reached
  // The countdown becomes null when the scheduled time has been reached
  // This is calculated in the parent component using currentTime which updates every second
  const isScheduledTimeReached = useMemo(() => {
    if (!moderationSchedule?.scheduled) {
      return true; // No schedule, allow starting anytime
    }
    // If countdown is null, it means currentTime >= scheduledStartTime (from parent calculation)
    // So the scheduled time has definitely been reached
    if (moderationStartCountdown === null) {
      return true; // Countdown finished, time reached
    }
    // If countdown exists, time hasn't been reached yet
    return false;
  }, [moderationSchedule, moderationStartCountdown]);

  const canStartSession =
    userHasRole('Vetter') &&
    (workflowStage === 'Compiled for Vetting' ||
      workflowStage === 'Vetting Session Expired') &&
    !vettingSession.active &&
    isScheduledTimeReached;

  // Debug logging (remove in production)
  useEffect(() => {
    if (moderationSchedule?.scheduled) {
      console.log('Session start check:', {
        hasVetterRole: userHasRole('Vetter'),
        workflowStage,
        sessionActive: vettingSession.active,
        isScheduledTimeReached,
        countdown: moderationStartCountdown,
        canStart: canStartSession,
      });
    }
  }, [moderationSchedule, workflowStage, vettingSession.active, isScheduledTimeReached, moderationStartCountdown, canStartSession, userHasRole]);

  const _canCompleteSession =
    userHasRole('Vetter') &&
    vettingSession.active &&
    workflowStage === 'Vetting in Progress';

  // When session is active and safe browser is enabled, all controls should be active
  const isSafeBrowserActive = vettingSession.active && vettingSession.safeBrowserEnabled;
  
  const safeBrowserStatus = [
    {
      label: 'Camera On',
      active: isSafeBrowserActive && (vettingSession.cameraOn ?? true),
    },
    {
      label: 'Screenshots Blocked',
      active: isSafeBrowserActive && (vettingSession.screenshotBlocked ?? true),
    },
    {
      label: 'Tab Switching Disabled',
      active: isSafeBrowserActive && (vettingSession.switchingLocked ?? true),
    },
    {
      label: 'Timer Guarding Session',
      active: vettingSession.active && !!vettingSession.expiresAt,
    },
  ];

  const _handleAnnotationSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onAddAnnotation(annotationDraft);
    setAnnotationDraft('');
  };

  const hasCustomChecklist = checklist !== digitalChecklist;
  const hasCustomChecklistPdf = Boolean(customChecklistPdf?.url);
  
  // Vetters can only see paper/checklist after they've joined
  // Chief Examiner can always see everything
  const canViewPaperAndChecklist = isChiefExaminer || (isVetter && vetterHasJoined);
  
  // Vetters can start their session only when global session is active and they haven't joined yet
  const canVetterStartSession = isVetter && vettingSession.active && !vetterHasJoined;

  const examWindow = (
    <div className="rounded-xl border-2 border-blue-200/50 bg-gradient-to-br from-blue-50/90 via-indigo-50/90 to-cyan-50/90 p-4 shadow-md">
      <div className="mb-4 flex items-center justify-between border-b border-blue-200/50 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 shadow-sm">
            <span className="text-white text-sm">📄</span>
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-800">Exam Paper</h3>
            <p className="text-[0.65rem] text-slate-600">Secure document viewer</p>
          </div>
        </div>
        {papersToDisplay.length > 1 && (
          <select
            value={selectedPaper?.id || ''}
            onChange={(e) => {
              const paper = papersToDisplay.find((p) => p.id === e.target.value);
              setSelectedPaper(paper || null);
            }}
            className="rounded-lg border-2 border-blue-200 bg-white px-2 py-1 text-[0.65rem] text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 shadow-sm"
          >
            {papersToDisplay.map((paper) => (
              <option key={paper.id} value={paper.id}>
                {paper.fileName}
              </option>
            ))}
          </select>
        )}
      </div>
        {selectedPaper ? (
          <div className="space-y-2.5">
            {isChiefExaminer && (
              <>
                <div className="rounded-lg border border-blue-200/50 bg-white/80 backdrop-blur-sm p-2.5">
                  <p className="text-[0.65rem] font-semibold text-slate-600 mb-0.5">File</p>
                  <p className="text-xs font-bold text-slate-800 truncate">{selectedPaper.fileName}</p>
                </div>
                <div className="rounded-lg border border-indigo-200/50 bg-white/80 backdrop-blur-sm p-2.5">
                  <p className="text-[0.65rem] font-semibold text-slate-600 mb-0.5">Course</p>
                  <p className="text-xs font-bold text-slate-800">{selectedPaper.courseCode}</p>
                </div>
                {(selectedPaper.status === 'in-vetting' || selectedPaper.status === 'vetted') && onRemovePaperFromVetting && (
                  <button
                    type="button"
                    onClick={() => onRemovePaperFromVetting(selectedPaper.id)}
                    className="w-full rounded-lg bg-gradient-to-r from-red-500 to-rose-600 px-3 py-2 text-xs font-bold text-white shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all duration-300"
                  >
                    Remove Paper from Vetting
                  </button>
                )}
              </>
            )}
            {selectedPaper.fileUrl ? (
              <div className="space-y-3">
                {isVetter && vetterPapers.length > 0 ? (
                  <div className={`grid gap-3 ${vetterPapers.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    {vetterPapers.map((paper, _index) => {
                      const paperUrl = getPaperUrl(paper);
                      if (!paperUrl) return null;
                      return (
                        <div key={paper.id} className="rounded-xl border-2 border-blue-300/70 bg-white/90 p-3 shadow-inner flex flex-col">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 shadow">
                                <span className="text-white text-sm">🪟</span>
                              </div>
                              <div>
                                <p className="text-xs font-bold text-slate-800">Secure In-Window Viewer</p>
                                <p className="text-[0.6rem] text-slate-500">{paper.fileName}</p>
                              </div>
                            </div>
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[0.6rem] font-semibold text-emerald-700">
                              Live Preview
                            </span>
                          </div>
                          <div className="mt-3 aspect-[210/297] overflow-hidden rounded-lg border border-slate-200 bg-slate-900/5">
                            <iframe
                              key={paperUrl}
                              src={`${paperUrl}#toolbar=0&navpanes=0`}
                              title={`Secure viewer for ${paper.fileName}`}
                              className="h-full w-full"
                              loading="lazy"
                            />
                          </div>
                          <p className="mt-2 text-[0.6rem] text-slate-500">Zoom, scroll, and annotate from here while Safe Browser keeps other tabs locked.</p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  inlinePaperUrl && (
                    <div className="rounded-xl border-2 border-blue-200/70 bg-white/95 p-4 shadow-md">
                      <div className="mb-3 flex items-center justify-between border-b border-blue-100 pb-2">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 shadow-sm">
                            <span className="text-white text-xs">🪟</span>
                          </div>
                          <div>
                            <p className="text-xs font-bold text-slate-800">Secure In-Window Viewer</p>
                            <p className="text-[0.65rem] text-slate-600">Document stays inside the Safe Browser</p>
                          </div>
                        </div>
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[0.65rem] font-semibold text-emerald-700">
                          Live Preview
                        </span>
                      </div>
                      <div className="mt-3 aspect-[210/297] overflow-hidden rounded-lg border-2 border-slate-200 bg-slate-50 shadow-inner">
                        <iframe
                          key={inlinePaperUrl}
                          src={`${inlinePaperUrl}#toolbar=0&navpanes=0`}
                          title={`Secure viewer for ${selectedPaper.fileName}`}
                          className="h-full w-full"
                          loading="lazy"
                        />
                      </div>
                      <p className="mt-2 text-[0.65rem] text-slate-500 text-center">Zoom, scroll, and annotate from here while Safe Browser keeps other tabs locked.</p>
                    </div>
                  )
                )}
                {isChiefExaminer && selectedPaper.status === 'vetted' && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const notes = prompt('Optional notes for approval:') || '';
                        if (onApprove) {
                          onApprove(notes);
                        }
                      }}
                      className="flex-1 rounded-lg bg-gradient-to-r from-green-500 to-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all duration-300"
                    >
                      ✓ Push to Next Stage
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setChiefRejectionComment('');
                        setShowRejectionModal(true);
                      }}
                      className="flex-1 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 px-3 py-2 text-xs font-bold text-white shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all	duration-300"
                    >
                      ✗ Rejected
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg border-2 border-amber-200 bg-amber-50/80 p-2.5 text-center">
                <p className="text-[0.65rem] text-amber-700">File not available</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-500">No paper selected</p>
        )}
    </div>
  );

  // Simple comment box state
  const [_simpleComment, setSimpleComment] = useState('');
  const [_simpleCommentKey, setSimpleCommentKey] = useState('');

  // Load existing quick comment on mount
  useEffect(() => {
    if (checklistComments) {
      // Find any quick comment
      for (const [key, comment] of checklistComments.entries()) {
        if (key.startsWith('quick-comment-')) {
          setSimpleComment(comment.comment);
          setSimpleCommentKey(key);
          break;
        }
      }
    }
  }, [checklistComments]);

  const defaultChecklistWindows = selectedPaper ? (
    <div className="space-y-4">
      {/* Editable Checklist - Click to type directly on items */}
      {(isVetter && vetterHasJoined) && !hasCustomChecklistPdf && (
        <div className="rounded-xl border-2 border-blue-200 bg-white p-4 shadow-lg">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-slate-800 mb-2">Moderation Checklist - Click any item to write on it</h3>
            <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-slate-50/50 p-2">
              <span className="text-[0.65rem] font-semibold text-slate-700">Select color:</span>
              <div className="flex flex-wrap gap-1">
                {textColors.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    onClick={() => setSelectedColor(color.value)}
                    className={`h-6 w-6 rounded border-2 transition ${
                      selectedColor === color.value
                        ? 'border-slate-800 scale-110 shadow'
                        : 'border-slate-300 hover:border-slate-500'
                    }`}
                    style={{ backgroundColor: color.value }}
                    title={color.name}
                  />
                ))}
              </div>
            </div>
          </div>
          
          {/* Course Outline Section */}
          <div className="mb-6">
            <h4 className="text-xs font-bold text-blue-700 mb-2">Course Outline</h4>
            <ul className="space-y-3">
              {checklist.courseOutline.map((item, idx) => (
                <EditableChecklistItem
                  key={idx}
                  item={item}
                  category="courseOutline"
                  bulletColor="#3B82F6"
                  commentKey={`courseOutline-${item}`}
                />
              ))}
            </ul>
          </div>

          {/* Blooms Taxonomy Section */}
          <div className="mb-6">
            <h4 className="text-xs font-bold text-purple-700 mb-2">Blooms Taxonomy</h4>
            <ul className="space-y-3">
              {checklist.bloomsTaxonomy.map((item, idx) => (
                <EditableChecklistItem
                  key={idx}
                  item={item}
                  category="bloomsTaxonomy"
                  bulletColor="#A855F7"
                  commentKey={`bloomsTaxonomy-${item}`}
                />
              ))}
            </ul>
          </div>

          {/* Compliance Section */}
          <div>
            <h4 className="text-xs font-bold text-emerald-700 mb-2">Compliance</h4>
            <ul className="space-y-3">
              {checklist.compliance.map((item, idx) => (
                <EditableChecklistItem
                  key={idx}
                  item={item}
                  category="compliance"
                  bulletColor="#10B981"
                  commentKey={`compliance-${item}`}
                />
              ))}
            </ul>
          </div>
        </div>
      )}
      {hasCustomChecklistPdf && (
        <div className="group relative overflow-hidden rounded-xl border-2 border-blue-200/50 bg-gradient-to-br from-blue-50 via-indigo-50 to-cyan-50 p-4 shadow-lg hover:shadow-2xl transition-all duration-300">
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-400/10 via-indigo-400/10 to-cyan-400/10"></div>
            <div className="absolute top-0 left-0 w-32 h-32 bg-gradient-to-br from-blue-300/20 to-cyan-300/20 rounded-full blur-3xl transform -translate-x-1/2 -translate-y-1/2"></div>
          </div>
          <div className="relative z-10">
            <div className="mb-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 shadow-md">
                    <span className="text-white text-sm">📑</span>
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-slate-800">
                      {(customChecklistPdf as { url: string; name: string; isWordDoc?: boolean })?.isWordDoc ? 'Uploaded Checklist Word Document' : 'Uploaded Checklist PDF'}
                    </h3>
                    <p className="text-[0.65rem] text-slate-600">{customChecklistPdf?.name}</p>
                  </div>
                </div>
              </div>
            </div>
            {/* Editable Word Document Interface */}
            {(customChecklistPdf as { url: string; name: string; isWordDoc?: boolean })?.isWordDoc ? (
              <div className="rounded-lg border-2 border-blue-200 bg-white p-8 shadow-lg" style={{ minHeight: '800px' }}>
                <div 
                  contentEditable 
                  suppressContentEditableWarning
                  className="w-full h-full outline-none prose prose-sm max-w-none"
                  style={{
                    fontFamily: 'Calibri, Arial, sans-serif',
                    fontSize: '11pt',
                    lineHeight: '1.15',
                    padding: '1in',
                    backgroundColor: 'white',
                    minHeight: '800px'
                  }}
                  onInput={(e) => {
                    // Auto-save content as user types
                    const _content = e.currentTarget.innerHTML;
                    // You can save this to localStorage or state if needed
                  }}
                >
                  <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                    <h1 style={{ fontSize: '16pt', fontWeight: 'bold', color: '#0066CC', marginBottom: '10px' }}>
                      UGANDA CHRISTIAN UNIVERSITY
                    </h1>
                    <p style={{ fontSize: '10pt', marginBottom: '5px' }}>Faculty of Science and Technology</p>
                    <p style={{ fontSize: '10pt', marginBottom: '5px' }}>Department of Information Technology</p>
                    <h2 style={{ fontSize: '14pt', fontWeight: 'bold', color: '#0066CC', marginTop: '15px', marginBottom: '20px' }}>
                      MODERATION CHECKLIST FOR EXAMINATION PAPER
                    </h2>
                  </div>
                  
                  <div style={{ marginBottom: '15px' }}>
                    <p><strong>Academic Year:</strong> <span contentEditable style={{ borderBottom: '1px solid black', minWidth: '200px', display: 'inline-block' }}></span></p>
                    <p><strong>Moderator:</strong> <span contentEditable style={{ borderBottom: '1px solid black', minWidth: '200px', display: 'inline-block' }}></span></p>
                    <p><strong>Date:</strong> <span contentEditable style={{ borderBottom: '1px solid black', minWidth: '200px', display: 'inline-block' }}></span></p>
                  </div>

                  <div style={{ marginTop: '30px' }}>
                    <h3 style={{ fontSize: '12pt', fontWeight: 'bold', color: '#0066CC', marginBottom: '10px' }}>
                      SECTION A — STRUCTURE & GENERAL QUALITY
                    </h3>
                    <h4 style={{ fontSize: '11pt', fontWeight: 'bold', marginTop: '15px', marginBottom: '10px' }}>
                      1. Paper Structure
                    </h4>
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#E6F2FF' }}>
                          <th style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'left', fontSize: '10pt' }}>Item</th>
                          <th style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'center', fontSize: '10pt', width: '80px' }}>Yes/No</th>
                          <th style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'left', fontSize: '10pt' }}>Comments</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td style={{ border: '1px solid #ccc', padding: '8px', fontSize: '10pt' }}>Paper includes clear instructions</td>
                          <td style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'center' }} contentEditable></td>
                          <td style={{ border: '1px solid #ccc', padding: '8px' }} contentEditable></td>
                        </tr>
                        <tr>
                          <td style={{ border: '1px solid #ccc', padding: '8px', fontSize: '10pt' }}>Time allocation is appropriate (2 hours)</td>
                          <td style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'center' }} contentEditable></td>
                          <td style={{ border: '1px solid #ccc', padding: '8px' }} contentEditable></td>
                        </tr>
                        <tr>
                          <td style={{ border: '1px solid #ccc', padding: '8px', fontSize: '10pt' }}>Number of questions meets course requirements</td>
                          <td style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'center' }} contentEditable></td>
                          <td style={{ border: '1px solid #ccc', padding: '8px' }} contentEditable></td>
                        </tr>
                        <tr>
                          <td style={{ border: '1px solid #ccc', padding: '8px', fontSize: '10pt' }}>Mark distribution is balanced</td>
                          <td style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'center' }} contentEditable></td>
                          <td style={{ border: '1px solid #ccc', padding: '8px' }} contentEditable></td>
                        </tr>
                        <tr>
                          <td style={{ border: '1px solid #ccc', padding: '8px', fontSize: '10pt' }}>Language is clear and unambiguous</td>
                          <td style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'center' }} contentEditable></td>
                          <td style={{ border: '1px solid #ccc', padding: '8px' }} contentEditable></td>
                        </tr>
                        <tr>
                          <td style={{ border: '1px solid #ccc', padding: '8px', fontSize: '10pt' }}>No grammatical or typographical errors</td>
                          <td style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'center' }} contentEditable></td>
                          <td style={{ border: '1px solid #ccc', padding: '8px' }} contentEditable></td>
                        </tr>
                      </tbody>
                    </table>

                    <h3 style={{ fontSize: '12pt', fontWeight: 'bold', color: '#0066CC', marginTop: '30px', marginBottom: '10px' }}>
                      SECTION B — ALIGNMENT WITH COURSE OUTLINE
                    </h3>
                    <h4 style={{ fontSize: '11pt', fontWeight: 'bold', marginTop: '15px', marginBottom: '10px' }}>
                      2. Coverage of Course Content
                    </h4>
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#E6F2FF' }}>
                          <th style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'left', fontSize: '10pt' }}>Core Topic from Course Outline</th>
                          <th style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'center', fontSize: '10pt', width: '80px' }}>Covered?</th>
                          <th style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'left', fontSize: '10pt' }}>Comments</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td style={{ border: '1px solid #ccc', padding: '8px', fontSize: '10pt' }}>Software Defined Networking (SDN)</td>
                          <td style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'center' }} contentEditable></td>
                          <td style={{ border: '1px solid #ccc', padding: '8px' }} contentEditable></td>
                        </tr>
                        <tr>
                          <td style={{ border: '1px solid #ccc', padding: '8px', fontSize: '10pt' }}>OpenFlow Architecture</td>
                          <td style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'center' }} contentEditable></td>
                          <td style={{ border: '1px solid #ccc', padding: '8px' }} contentEditable></td>
                        </tr>
                        <tr>
                          <td style={{ border: '1px solid #ccc', padding: '8px', fontSize: '10pt' }}>Routing Algorithms</td>
                          <td style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'center' }} contentEditable></td>
                          <td style={{ border: '1px solid #ccc', padding: '8px' }} contentEditable></td>
                        </tr>
                        <tr>
                          <td style={{ border: '1px solid #ccc', padding: '8px', fontSize: '10pt' }}>Network Virtualization</td>
                          <td style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'center' }} contentEditable></td>
                          <td style={{ border: '1px solid #ccc', padding: '8px' }} contentEditable></td>
                        </tr>
                        <tr>
                          <td style={{ border: '1px solid #ccc', padding: '8px', fontSize: '10pt' }}>TCP/IP Protocols</td>
                          <td style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'center' }} contentEditable></td>
                          <td style={{ border: '1px solid #ccc', padding: '8px' }} contentEditable></td>
                        </tr>
                      </tbody>
                    </table>

                    <p style={{ fontSize: '10pt', marginTop: '30px', color: '#666' }}>
                      <strong>Additional Comments:</strong>
                    </p>
                    <div contentEditable style={{ border: '1px solid #ccc', padding: '10px', minHeight: '100px', marginTop: '10px' }}></div>
                  </div>
                </div>
              </div>
            ) : (
              <div id="checklist-pdf-container" className="relative rounded-lg border border-blue-200 bg-white overflow-hidden aspect-[210/297]">
                <iframe 
                  src={`${customChecklistPdf?.url}#toolbar=0&navpanes=0`} 
                  title="Custom Checklist PDF" 
                  className="w-full h-full"
                />
              </div>
            )}
          </div>
        </div>
      )}
      {selectedPaper && isChiefExaminer && checklistComments && checklistComments.size > 0 && onDownloadChecklistPacket && (
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setShowChecklistPreview(true)}
            className="rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 px-4 py-2 text-xs font-bold text-white shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all duration-300"
          >
            👁️ Preview Checklist
          </button>
          {workflow?.lastDecision ? (
            <button
              onClick={onDownloadChecklistPacket}
              className="rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all duration-300"
              title={`Download PDF with ${workflow.lastDecision.type} decision`}
            >
              📥 Download Checklist PDF ({workflow.lastDecision.type})
            </button>
          ) : (
            <button
              disabled
              className="rounded-lg bg-slate-300 px-4 py-2 text-xs font-bold text-slate-500 shadow-sm cursor-not-allowed"
              title="Checklist can only be downloaded after Chief Examiner makes a decision (Approve or Reject)"
            >
              📥 Download (Decision Required)
            </button>
          )}
        </div>
      )}
      {selectedPaper && isChiefExaminer && (
        <div className="rounded-xl border-2 border-slate-200 bg-white p-4 shadow-lg space-y-3">
          <div>
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">Forward Checklist to Team Lead</h3>
            <p className="text-[0.65rem] text-slate-500">Select verdict and include notes before sending outcomes downstream.</p>
          </div>
          <div className="flex gap-3 text-[0.7rem] font-semibold text-slate-700">
            <label className="flex items-center gap-1">
              <input type="radio" name="forward-decision" value="approved" checked={forwardDecision === 'approved'} onChange={() => setForwardDecision('approved')} />
              Approved
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" name="forward-decision" value="rejected" checked={forwardDecision === 'rejected'} onChange={() => setForwardDecision('rejected')} />
              Rejected
            </label>
          </div>
          <textarea
            value={forwardNotes}
            onChange={(e) => setForwardNotes(e.target.value)}
            placeholder="Add context, actions required, or attach summary..."
            className="w-full rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            rows={3}
          />
          <button
            type="button"
            disabled={!forwardDecision || !forwardNotes.trim()}
            onClick={() => {
              if (!forwardDecision) {
                alert('Select Approved or Rejected before forwarding.');
                return;
              }
              if (!forwardNotes.trim()) {
                alert('Please include decision notes.');
                return;
              }
              onForwardChecklist?.(forwardDecision, forwardNotes.trim());
              setForwardNotes('');
              setForwardDecision('');
            }}
            className="w-full rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-lg hover:shadow-xl hover:scale-[1.02] transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Forward to Team Lead
          </button>
        </div>
      )}
      {/* Checklist Preview Modal */}
      {showChecklistPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="relative w-full max-w-4xl max-h-[90vh] rounded-xl bg-white shadow-2xl overflow-hidden">
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 px-6 py-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-bold text-white">Checklist Preview with Comments</h2>
              <button
                onClick={() => setShowChecklistPreview(false)}
                className="text-white hover:text-slate-200 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
              <ChecklistPreviewContent
                comments={checklistComments}
                hasCustomChecklistPdf={Boolean(customChecklistPdf?.url)}
                showVetterNames={true}
              />
            </div>
            <div className="sticky bottom-0 bg-slate-50 px-6 py-4 flex justify-end gap-2 border-t border-slate-200">
              <button
                onClick={() => setShowChecklistPreview(false)}
                className="px-4 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => {
                  onDownloadChecklistPacket?.();
                  setShowChecklistPreview(false);
                }}
                className="px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-blue-500 to-indigo-600 rounded-lg hover:shadow-lg transition-all"
              >
                Download
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Rejection Flow Modal */}
      {showRejectionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-5xl max-h-[95vh] rounded-2xl bg-gradient-to-br from-white via-slate-50 to-white shadow-2xl overflow-hidden border border-slate-200">
            {/* Header */}
            <div className="sticky top-0 bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 px-6 py-5 flex items-center justify-between z-10 shadow-lg">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                  <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Paper Rejection Flow</h2>
                  <p className="text-xs text-white/90">Review checklist comments and add your feedback</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowRejectionModal(false);
                  setChiefRejectionComment('');
                }}
                className="text-white hover:bg-white/20 rounded-lg p-2 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="p-6 overflow-y-auto max-h-[calc(95vh-200px)] space-y-6">
              {/* Checklist Comments Section */}
              {checklistComments && checklistComments.size > 0 ? (
                <div className="rounded-xl border-2 border-blue-200 bg-gradient-to-br from-blue-50/50 to-indigo-50/30 p-5 shadow-lg">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-md">
                      <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-slate-800">Checklist Comments from Vetters</h3>
                      <p className="text-xs text-slate-600">These comments will be automatically included in the rejection notification</p>
                    </div>
                  </div>
                  <div className="bg-white/80 backdrop-blur-sm rounded-lg p-4 max-h-64 overflow-y-auto border border-blue-100">
                    {(() => {
                      const sectionConfigs = customChecklistPdf ? pdfChecklistSectionConfigs : defaultChecklistSectionConfigs;
                      const hasSectionComments = sectionConfigs.some(section => checklistComments.get(section.id)?.comment);

                      return (
                        <div className="space-y-4">
                          {/* Section Comments */}
                          {hasSectionComments && (
                            <div>
                              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-3">Section Comments</h4>
                              <div className="space-y-3">
                                {sectionConfigs.map((section) => {
                                  const sectionComment = checklistComments.get(section.id);
                                  if (!sectionComment?.comment) return null;
                                  return (
                                    <div key={section.id} className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                                      <h5 className="text-xs font-semibold text-slate-800 mb-1">{section.title}</h5>
                                      <p className="text-xs text-slate-700 leading-relaxed">{sectionComment.comment}</p>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Item-Level Comments section removed as per requirements */}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border-2 border-amber-200 bg-amber-50/50 p-5 text-center">
                  <div className="w-12 h-12 rounded-full bg-amber-200/50 mx-auto mb-3 flex items-center justify-center">
                    <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <p className="text-sm text-amber-800 font-medium">No checklist comments available</p>
                  <p className="text-xs text-amber-700 mt-1">The rejection will proceed with only your comment</p>
                </div>
              )}

              {/* Chief Examiner Comment Section */}
              <div className="rounded-xl border-2 border-purple-200 bg-gradient-to-br from-purple-50/50 to-pink-50/30 p-5 shadow-lg">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center shadow-md">
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-800">Your Comment as Chief Examiner</h3>
                    <p className="text-xs text-slate-600">Add your feedback and instructions for the team lead</p>
                  </div>
                </div>
                <textarea
                  value={chiefRejectionComment}
                  onChange={(e) => setChiefRejectionComment(e.target.value)}
                  placeholder="Enter your rejection feedback, required actions, or any specific instructions for the team lead..."
                  className="w-full rounded-lg border-2 border-purple-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-400/20 transition-all resize-none"
                  rows={5}
                />
                <p className="text-xs text-slate-500 mt-2">
                  {chiefRejectionComment.length > 0 ? `${chiefRejectionComment.length} characters` : 'Comment is optional, but recommended'}
                </p>
              </div>

              {/* Preview Section */}
              <div className="rounded-xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100/50 p-5 shadow-lg">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-slate-500 to-slate-600 flex items-center justify-center shadow-md">
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-800">Preview</h3>
                    <p className="text-xs text-slate-600">What will be sent to the Team Lead</p>
                  </div>
                </div>
                <div className="bg-white/80 backdrop-blur-sm rounded-lg p-4 border border-slate-200 max-h-48 overflow-y-auto">
                  <div className="space-y-2 text-xs text-slate-700">
                    {(() => {
                      let preview = '';
                      if (chiefRejectionComment.trim()) {
                        preview += `Chief Examiner Comment:\n${chiefRejectionComment.trim()}\n\n`;
                      }
                      if (checklistComments && checklistComments.size > 0) {
                        const payload = buildChecklistExportPayload({
                          comments: checklistComments,
                          hasCustomChecklistPdf: Boolean(customChecklistPdf?.url),
                          hideVetterNames: true,
                        });
                        if (payload) {
                          preview += payload;
                        }
                      }
                      if (!preview.trim()) {
                        preview = 'Paper rejected by Chief Examiner. Please review and revise.';
                      }
                      return (
                        <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed">{preview}</pre>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="sticky bottom-0 bg-gradient-to-r from-slate-50 to-slate-100 px-6 py-4 flex justify-between items-center gap-3 border-t border-slate-200 shadow-lg">
              <button
                onClick={() => {
                  setShowRejectionModal(false);
                  setChiefRejectionComment('');
                }}
                className="px-5 py-2.5 text-sm font-semibold text-slate-700 bg-white border-2 border-slate-300 rounded-lg hover:bg-slate-50 hover:border-slate-400 transition-all shadow-sm"
              >
                Cancel
              </button>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 rounded-lg border border-blue-200">
                  <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-xs font-medium text-blue-700">Will be sent to Team Lead</span>
                </div>
                <button
                  onClick={async () => {
                    // Collect checklist comments
                    let checklistText = '';
                    if (checklistComments && checklistComments.size > 0) {
                      const payload = buildChecklistExportPayload({
                        comments: checklistComments,
                        hasCustomChecklistPdf: Boolean(customChecklistPdf?.url),
                        hideVetterNames: true,
                      });
                      if (payload) {
                        checklistText = '\n\n' + payload;
                      }
                    }

                    // Combine chief comment with checklist comments
                    let combinedNotes = '';
                    if (chiefRejectionComment.trim()) {
                      combinedNotes = `Chief Examiner Comment: ${chiefRejectionComment.trim()}`;
                    }
                    if (checklistText) {
                      combinedNotes += checklistText;
                    }

                    // If no comments at all, use a default message
                    if (!combinedNotes.trim()) {
                      combinedNotes = 'Paper rejected by Chief Examiner. Please review and revise.';
                    }

                    // Forward checklist to team lead
                    if (onForwardChecklist) {
                      onForwardChecklist('rejected', combinedNotes);
                    }

                    // Also call onReject to update workflow status
                    if (onReject) {
                      await onReject(chiefRejectionComment.trim() || 'Paper rejected.', undefined);
                    }

                    // Close modal
                    setShowRejectionModal(false);
                    setChiefRejectionComment('');
                  }}
                  className="px-6 py-2.5 text-sm font-bold text-white bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 rounded-lg hover:shadow-xl hover:scale-105 transition-all shadow-lg flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Confirm Rejection & Send to Team Lead
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Deadline Rejection Modal */}
      {showDeadlineRejectionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-2xl rounded-2xl bg-gradient-to-br from-white via-slate-50 to-white shadow-2xl overflow-hidden border border-slate-200">
            {/* Header */}
            <div className="sticky top-0 bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 px-6 py-5 flex items-center justify-between z-10 shadow-lg">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                  <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Reject Paper & Set Deadline</h2>
                  <p className="text-xs text-white/90">Set revision deadline and confirm rejection</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowDeadlineRejectionModal(false);
                  setRejectionNotes('');
                  setDeadlineDays(3);
                  setDeadlineHours(0);
                  setDeadlineMinutes(0);
                }}
                className="text-white hover:bg-white/20 rounded-lg p-2 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* Rejection Notes Display */}
              <div className="rounded-xl border-2 border-amber-200 bg-gradient-to-br from-amber-50/50 to-orange-50/30 p-5 shadow-lg">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-md">
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-800">Rejection Feedback</h3>
                    <p className="text-xs text-slate-600">Your feedback notes for the team lead</p>
                  </div>
                </div>
                <div className="bg-white/80 backdrop-blur-sm rounded-lg p-4 border border-amber-200">
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{rejectionNotes || 'No notes provided'}</p>
                </div>
              </div>

              {/* Deadline Input Section */}
              <div className="rounded-xl border-2 border-blue-200 bg-gradient-to-br from-blue-50/50 to-indigo-50/30 p-5 shadow-lg">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-md">
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-800">Set Revision Deadline</h3>
                    <p className="text-xs text-slate-600">Specify when the revision should be completed</p>
                  </div>
                </div>
                
                <div className="grid grid-cols-3 gap-4">
                  {/* Days */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-2">Days</label>
                    <input
                      type="number"
                      min="0"
                      value={deadlineDays}
                      onChange={(e) => setDeadlineDays(Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-full rounded-lg border-2 border-blue-200 bg-white px-4 py-3 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20 transition-all"
                      placeholder="0"
                    />
                  </div>
                  
                  {/* Hours */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-2">Hours</label>
                    <input
                      type="number"
                      min="0"
                      max="23"
                      value={deadlineHours}
                      onChange={(e) => setDeadlineHours(Math.max(0, Math.min(23, parseInt(e.target.value) || 0)))}
                      className="w-full rounded-lg border-2 border-blue-200 bg-white px-4 py-3 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20 transition-all"
                      placeholder="0"
                    />
                  </div>
                  
                  {/* Minutes */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-2">Minutes</label>
                    <input
                      type="number"
                      min="0"
                      max="59"
                      value={deadlineMinutes}
                      onChange={(e) => setDeadlineMinutes(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
                      className="w-full rounded-lg border-2 border-blue-200 bg-white px-4 py-3 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20 transition-all"
                      placeholder="0"
                    />
                  </div>
                </div>

                {/* Deadline Summary */}
                <div className="mt-4 p-3 rounded-lg bg-blue-100/50 border border-blue-200">
                  <p className="text-xs text-slate-600">
                    {deadlineDays === 0 && deadlineHours === 0 && deadlineMinutes === 0 ? (
                      <span className="text-amber-600 font-semibold">⚠️ No deadline set - revision will be requested without a specific deadline</span>
                    ) : (
                      <span className="text-blue-700">
                        <span className="font-semibold">Deadline Summary:</span> {deadlineDays > 0 && `${deadlineDays} day${deadlineDays !== 1 ? 's' : ''} `}
                        {deadlineHours > 0 && `${deadlineHours} hour${deadlineHours !== 1 ? 's' : ''} `}
                        {deadlineMinutes > 0 && `${deadlineMinutes} minute${deadlineMinutes !== 1 ? 's' : ''}`}
                        {deadlineDays === 0 && deadlineHours === 0 && deadlineMinutes === 0 && 'No deadline'}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="sticky bottom-0 bg-gradient-to-r from-slate-50 to-slate-100 px-6 py-4 flex justify-between items-center gap-3 border-t border-slate-200 shadow-lg">
              <button
                onClick={() => {
                  setShowDeadlineRejectionModal(false);
                  setRejectionNotes('');
                  setDeadlineDays(3);
                  setDeadlineHours(0);
                  setDeadlineMinutes(0);
                }}
                className="px-5 py-2.5 text-sm font-semibold text-slate-700 bg-white border-2 border-slate-300 rounded-lg hover:bg-slate-50 hover:border-slate-400 transition-all shadow-sm"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (onReject) {
                    const deadline = deadlineDays || deadlineHours || deadlineMinutes 
                      ? { days: deadlineDays, hours: deadlineHours, minutes: deadlineMinutes }
                      : undefined;
                    await onReject(rejectionNotes, deadline);
                    
                    // Clear the decision notes textarea
                    const notesEl = document.getElementById('decision-notes') as HTMLTextAreaElement;
                    if (notesEl) notesEl.value = '';
                  }
                  
                  // Close modal and reset state
                  setShowDeadlineRejectionModal(false);
                  setRejectionNotes('');
                  setDeadlineDays(3);
                  setDeadlineHours(0);
                  setDeadlineMinutes(0);
                }}
                className="px-6 py-2.5 text-sm font-bold text-white bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 rounded-lg hover:shadow-xl hover:scale-105 transition-all shadow-lg flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Confirm Rejection & Set Deadline
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  ) : null;

  const structuredChecklistCommentSections = hasCustomChecklistPdf
    ? pdfChecklistSectionConfigs
    : defaultChecklistSectionConfigs;

  const paperChecklistColumns = (() => {
    if (canViewPaperAndChecklist && selectedPaper) {
      // Both vetters and Chief Examiners see paper and checklist side by side
      return (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Exam Paper Column */}
          <div className="flex flex-col space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-1 w-1 rounded-full bg-blue-500"></div>
              <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Exam Paper</h3>
            </div>
            {examWindow}
          </div>
          {/* Checklist Column */}
          <div className="flex flex-col space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-1 w-1 rounded-full bg-indigo-500"></div>
              <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Moderation Checklist</h3>
            </div>
            {defaultChecklistWindows}
          </div>
        </div>
      );
    }

    if (showVetterFocusedLayout) {
      return (
        <div className="rounded-2xl border-2 border-dashed border-blue-200 bg-white/80 px-4 py-6 text-center text-sm text-slate-600">
          Join the secure session to reveal the exam paper and moderation checklist.
        </div>
      );
    }

    return null;
  })();

  const vetterSessionPanel = showVetterFocusedLayout ? (
    <div className="rounded-2xl border-2 border-blue-200/70 bg-white/90 p-4 shadow-lg">
      {isVetterRestricted ? (
        <div className="space-y-3">
          <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4 text-center">
            <div className="text-2xl mb-2">🚫</div>
            <h3 className="text-sm font-bold text-red-800 mb-1">Restricted Access</h3>
            <p className="text-xs text-red-700">
              Your access has been restricted due to a violation. Please contact the Chief Examiner to regain access.
            </p>
          </div>
        </div>
      ) : !vetterHasJoined ? (
        <button
          type="button"
          onClick={() => onStartVetting(customDuration)}
          disabled={!vettingSession.active}
          className="w-full rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 px-4 py-3 text-sm font-bold text-white shadow-lg transition disabled:cursor-not-allowed disabled:opacity-40"
        >
          {vettingSession.active ? 'Start Session' : 'Waiting for Chief…'}
        </button>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={onCompleteVetting}
            className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-3 text-sm font-bold text-white shadow-lg transition"
          >
            Complete Vetting
          </button>
        </div>
      )}
    </div>
  ) : null;

  return (
    <SectionCard
      id={sectionId}
      title="Digital Vetting & Annotation Suite"
      kicker="Safe Browser & Real-Time Sync"
      description="Enforce safe browser rules, coordinate real-time annotation, and cross-reference moderation checklists."
      actions={
        moderationStartCountdown ? (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-center text-sm font-semibold text-amber-700">
            Moderation Begins In
            <div className="mt-1 text-2xl tracking-widest text-amber-800">
              {moderationStartCountdown}
            </div>
          </div>
        ) : moderationEndCountdown ? (
          <div className="rounded-2xl border border-blue-500/40 bg-blue-500/10 px-4 py-3 text-center text-sm font-semibold text-blue-700">
            Moderation Ends In
            <div className="mt-1 text-2xl tracking-widest text-blue-800">
              {moderationEndCountdown}
            </div>
          </div>
        ) : vettingSession.active && vettingCountdown ? (
          <div className="rounded-2xl border border-blue-500/40 bg-blue-500/10 px-4 py-3 text-center text-sm font-semibold text-blue-700">
            Session Countdown
            <div className="mt-1 text-2xl tracking-widest text-blue-800">
              {vettingCountdown}
            </div>
          </div>
        ) : (
          <StatusPill label="Session Idle" active={false} tone="slate" />
        )
      }
    >
      <div className="space-y-5">
        {/* Circular video preview for vetter - shows their recorded face */}
        {isVetter && vetterHasJoined && vettingSession.cameraOn && currentUserId && (() => {
          // Get camera stream from monitoring data or global stream
          const monitoring = vetterMonitoring?.get(currentUserId);
          const cameraStream = monitoring?.cameraStream || (window as any).__vettingCameraStream;
          if (!cameraStream) return null;
          
          return (
            <div className="fixed bottom-6 right-6 z-50">
              <div className="relative w-32 h-32 rounded-full border-4 border-green-500 bg-slate-900 overflow-hidden shadow-2xl">
                <video
                  ref={(video) => {
                    if (video && cameraStream) {
                      video.srcObject = cameraStream;
                      video.play().catch(err => console.error('Circular preview playback error:', err));
                    }
                  }}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover scale-x-[-1]"
                />
                <div className="absolute top-2 left-2 bg-green-600 text-white text-[0.6rem] px-1.5 py-0.5 rounded font-bold flex items-center gap-1">
                  <span className="h-1 w-1 rounded-full bg-white animate-pulse"></span>
                  LIVE
                </div>
              </div>
            </div>
          );
        })()}
        {showVetterFocusedLayout && vetterSessionPanel}
        {paperChecklistColumns}

        {/* Editing Tool and Comments Section - After Preview Windows */}
        {selectedPaper && canViewPaperAndChecklist && ((isVetter && vetterHasJoined) || isChiefExaminer) && (
          <div className="space-y-4">
            {/* Color Selection Tool - Only for Vetters */}
            {isVetter && vetterHasJoined && (
              <div className="rounded-xl border-2 border-blue-200/50 bg-gradient-to-br from-blue-50 via-indigo-50 to-cyan-50 p-4 shadow-lg">
                <div className="mb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 shadow-md">
                      <span className="text-white text-sm">🎨</span>
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-slate-800">Text Color Selection</h3>
                      <p className="text-[0.65rem] text-slate-600">Choose a color for your comments</p>
                    </div>
                  </div>
                  <div className="rounded-lg border border-blue-200 bg-white/90 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[0.65rem] font-semibold text-slate-700">Text Color:</span>
                      <div className="flex flex-wrap gap-1">
                        {textColors.map((color) => (
                          <button
                            key={color.value}
                            type="button"
                            onClick={() => setSelectedColor(color.value)}
                            className={`h-6 w-6 rounded border-2 transition ${
                              selectedColor === color.value
                                ? 'border-slate-800 scale-110 shadow'
                                : 'border-slate-300 hover:border-slate-500'
                            }`}
                            style={{ backgroundColor: color.value }}
                            title={color.name}
                          />
                        ))}
                      </div>
                    </div>
                    <p className="text-[0.6rem] text-slate-500">
                      Select a color, then add your comments in the sections below
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Glass Styled Checklist Commentary */}
            <div className="rounded-2xl bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 p-6 shadow-xl">
              <div className="flex items-center gap-3 mb-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 shadow-lg">
                  <span className="text-white text-lg">📋</span>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">Glass Styled Checklist Commentary</h3>
                  <p className="text-[0.7rem] text-slate-600">Hover over any card to reveal the smooth glassmorphic surface and capture remarks per section.</p>
                </div>
              </div>
              
              {/* Grid of Section Comment Boards */}
              <div className="grid gap-4 sm:grid-cols-2">
                {structuredChecklistCommentSections.slice(0, 4).map((section) => {
                  const commentEntry = checklistComments?.get(section.id);
                  const canEditSection = isVetter && vetterHasJoined;
                  const textareaColor = canEditSection
                    ? selectedColor
                    : commentEntry?.color || '#1e293b';
                  const commentText = commentEntry?.comment || '';
                  const charCount = commentText.length;
                  const maxChars = 500;
                  const isCaptured = commentText.length > 0;
                  
                  return (
                    <div
                      key={section.id}
                      className="group relative overflow-hidden rounded-2xl border border-slate-200/60 bg-white/40 backdrop-blur-xl p-5 shadow-lg transition-all duration-300 hover:border-slate-300/80 hover:bg-white/60 hover:shadow-2xl"
                      style={{
                        backdropFilter: 'blur(20px)',
                        WebkitBackdropFilter: 'blur(20px)',
                      }}
                    >
                      {/* Glassmorphic overlay on hover */}
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br from-white/30 via-transparent to-white/10 pointer-events-none" />
                      
                      {/* Header */}
                      <div className="relative z-10 flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3 flex-1">
                          {/* Purple icon with yellow starburst */}
                          <div className="relative flex-shrink-0">
                            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center shadow-md">
                              <span className="text-white text-lg">✨</span>
                            </div>
                            <div className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-400 rounded-full blur-sm opacity-80" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[0.65rem] font-bold uppercase tracking-wider text-slate-500 mb-1">SECTION COMMENT BOARD</p>
                            <h4 className="text-xs font-bold text-slate-800 leading-tight">{section.title}</h4>
                          </div>
                        </div>
                        {/* Ready status indicator */}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <div className="w-2 h-2 rounded-full bg-blue-500 shadow-lg shadow-blue-500/50" />
                          <span className="text-[0.65rem] font-semibold text-blue-600">Ready</span>
                        </div>
                      </div>
                      
                      {/* Prompt */}
                      <div className="relative z-10 mb-3">
                        <p className="text-[0.7rem] text-slate-600/90">{section.placeholder}</p>
                      </div>
                      
                      {/* Text area with glassmorphic background */}
                      <div className="relative z-10 mb-3">
                        <textarea
                          value={commentText}
                          onChange={(e) => {
                            const newValue = e.target.value;
                            if (newValue.length <= maxChars && onChecklistCommentChange) {
                              onChecklistCommentChange(section.id, newValue || null, selectedColor);
                            }
                          }}
                          placeholder="Stream your vetting thoughts here..."
                          maxLength={maxChars}
                          className="w-full rounded-xl border border-slate-300/50 bg-white/50 backdrop-blur-md px-4 py-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-400/60 focus:outline-none focus:ring-2 focus:ring-blue-400/20 transition-all duration-300 resize-none"
                          style={{ 
                            color: textareaColor,
                            backdropFilter: 'blur(10px)',
                            WebkitBackdropFilter: 'blur(10px)',
                          }}
                          rows={6}
                          disabled={!canEditSection}
                        />
                      </div>
                      
                      {/* Controls */}
                      <div className="relative z-10 flex items-center justify-between mb-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (onChecklistCommentChange) {
                              onChecklistCommentChange(section.id, null);
                            }
                          }}
                          disabled={!canEditSection || !commentText}
                          className="text-[0.7rem] font-medium text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Clear
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (commentText && onChecklistCommentChange) {
                              onChecklistCommentChange(section.id, commentText.trim(), selectedColor);
                            }
                          }}
                          disabled={!canEditSection || !commentText.trim()}
                          className="text-[0.7rem] font-semibold text-blue-600 hover:text-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Ready to capture
                        </button>
                      </div>
                      
                      {/* Character count */}
                      <div className="relative z-10 flex items-center justify-between">
                        <span className="text-[0.65rem] text-slate-500">
                          {isCaptured ? 'Captured' : 'Not captured yet'}
                        </span>
                        <span className={`text-[0.65rem] font-medium ${charCount > maxChars * 0.9 ? 'text-amber-600' : 'text-slate-500'}`}>
                          {charCount}/{maxChars}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              
              {/* Additional sections (if any beyond the first 4) */}
              {structuredChecklistCommentSections.length > 4 && (
                <div className="mt-4 space-y-3">
                  {structuredChecklistCommentSections.slice(4).map((section) => {
                    const commentEntry = checklistComments?.get(section.id);
                    const canEditSection = isVetter && vetterHasJoined;
                    const textareaColor = canEditSection
                      ? selectedColor
                      : commentEntry?.color || '#1e293b';
                    return (
                      <div
                        key={section.id}
                        className="group relative overflow-hidden rounded-xl border border-slate-200/60 bg-white/40 backdrop-blur-xl p-4 shadow-lg transition-all duration-300 hover:border-slate-300/80 hover:bg-white/60"
                      >
                        <h4 className={`text-xs font-bold mb-2 ${section.headingColor} text-slate-800`}>{section.title}</h4>
                        <textarea
                          value={commentEntry?.comment || ''}
                          onChange={(e) => {
                            if (onChecklistCommentChange) {
                              onChecklistCommentChange(section.id, e.target.value.trim() || null, selectedColor);
                            }
                          }}
                          placeholder={section.placeholder}
                          className="w-full rounded-lg border border-slate-300/50 bg-white/50 backdrop-blur-md px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-400/60 focus:outline-none focus:ring-2 focus:ring-blue-400/20"
                          style={{ color: textareaColor }}
                          rows={3}
                          disabled={!canEditSection}
                        />
                        {commentEntry?.comment && (
                          <p className="mt-1 text-[0.55rem] text-slate-500">
                            Last updated: {new Date(commentEntry.timestamp || Date.now()).toLocaleString()}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {isChiefExaminer && !showVetterFocusedLayout && (
          <div className="space-y-6">
            {/* Session Management Section - Grouped together */}
            <div className="rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-blue-50/30 p-5 shadow-lg">
              <div className="mb-4 flex items-center gap-3 border-b border-slate-200 pb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-md">
                  <span className="text-white text-lg">⚙️</span>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">Session Management</h3>
                  <p className="text-[0.7rem] text-slate-600">Configure and control vetting sessions</p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {/* Moderation Scheduling */}
                {isChiefExaminer && onScheduleModeration && (
                  <div className="rounded-xl border-2 border-purple-200/50 bg-gradient-to-br from-purple-50/80 via-indigo-50/80 to-pink-50/80 p-4 shadow-md">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 shadow-sm">
                        <span className="text-white text-xs">📅</span>
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-slate-800">Schedule Moderation</h4>
                        <p className="text-[0.65rem] text-slate-600">Set start date & time</p>
                      </div>
                    </div>
                    <div className="space-y-2.5">
                      <div>
                        <label className="block text-[0.65rem] font-semibold text-slate-700 mb-1.5">Start Date & Time</label>
                        <input
                          type="datetime-local"
                          value={startDateTime}
                          onChange={(e) => setStartDateTime(e.target.value)}
                          className="w-full rounded-lg border-2 border-purple-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 shadow-sm"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => onScheduleModeration(startDateTime)}
                        className="w-full rounded-lg bg-gradient-to-r from-purple-500 via-indigo-500 to-pink-500 px-3 py-2 text-xs font-bold text-white shadow-md hover:shadow-lg hover:scale-[1.02] transition-all"
                      >
                        ✓ Schedule Session
                      </button>
                      {moderationSchedule?.scheduled && moderationSchedule.startDateTime && (
                        <div className="rounded-lg border-2 border-green-300 bg-gradient-to-r from-green-50 to-emerald-50 p-2">
                          <p className="text-[0.65rem] font-bold text-green-700 flex items-center gap-1">
                            <span>✓</span>
                            <span>Scheduled</span>
                          </p>
                          <p className="text-[0.6rem] text-green-600 mt-1">Starts: {new Date(moderationSchedule.startDateTime).toLocaleString()}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Safe Browser Controls */}
                <div className="rounded-xl border-2 border-emerald-200/50 bg-gradient-to-br from-emerald-50/80 via-teal-50/80 to-cyan-50/80 p-4 shadow-md">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 shadow-sm">
                      <span className="text-white text-xs">🔒</span>
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-800">Safe Browser Controls</h4>
                      <p className="text-[0.65rem] text-slate-600">Secure vetting environment</p>
                    </div>
                  </div>
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {safeBrowserStatus.map((item) => (
                      <div
                        key={item.label}
                        className={`rounded-lg px-2 py-1 text-[0.65rem] font-semibold border-2 transition-all ${
                          item.active ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-amber-100 border-amber-300 text-amber-700'
                        }`}
                      >
                        {item.label}
                      </div>
                    ))}
                  </div>
                  {isChiefExaminer && (
                    <>
                      <input
                        ref={checklistUploadInputRef}
                        type="file"
                        accept=".json,.txt,.pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file && onUploadChecklist) {
                            onUploadChecklist(file);
                          }
                          if (event.target) {
                            event.target.value = '';
                          }
                        }}
                      />
                      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-white/90 p-2.5">
                        <button
                          type="button"
                          onClick={() => checklistUploadInputRef.current?.click()}
                          className="rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 px-2.5 py-1.5 text-[0.65rem] font-bold text-white shadow hover:shadow-md"
                        >
                          Upload Checklist
                        </button>
                        {hasCustomChecklistPdf && onRemoveChecklist && (
                          <button
                            type="button"
                            onClick={onRemoveChecklist}
                            className="rounded-lg bg-gradient-to-r from-red-500 to-rose-600 px-2.5 py-1.5 text-[0.65rem] font-bold text-white shadow hover:shadow-md"
                          >
                            Remove
                          </button>
                        )}
                        <span className="text-[0.6rem] font-semibold text-blue-700">
                          {hasCustomChecklist ? 'Custom template' : hasCustomChecklistPdf ? 'Custom PDF' : 'Default template'}
                        </span>
                      </div>
                    </>
                  )}
                  <div className="space-y-2.5">
                    <div>
                      <label htmlFor="session-minutes" className="block text-[0.65rem] font-semibold text-slate-700 mb-1.5">
                        Session Duration (minutes)
                      </label>
                      <div className="relative">
                        <input
                          id="session-minutes"
                          type="number"
                          min={DEFAULT_SESSION_MINUTES}
                          max={180}
                          value={vettingSession.active && vettingSession.durationMinutes ? vettingSession.durationMinutes : customDuration}
                          onChange={(e) => {
                            const value = parseInt(e.target.value) || calculatedDuration;
                            setCustomDuration(Math.max(DEFAULT_SESSION_MINUTES, Math.min(180, value)));
                          }}
                          disabled={vettingSession.active}
                          className="w-full rounded-lg border-2 border-emerald-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 shadow-sm disabled:bg-emerald-50/50 disabled:cursor-not-allowed"
                        />
                        {!vettingSession.active && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                            <span className="text-[0.65rem] text-emerald-600 font-semibold">min</span>
                          </div>
                        )}
                        {vettingSession.active && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                            <span className="text-[0.65rem] text-emerald-600 font-semibold">Active</span>
                          </div>
                        )}
                      </div>
                      <p className="mt-1 text-[0.6rem] text-slate-600">
                        {vettingSession.active
                          ? `Session active. ${vettingCountdown ? `Time remaining: ${vettingCountdown}` : 'Time expired'}`
                          : moderationSchedule?.scheduled && moderationStartCountdown
                          ? `Waiting for scheduled time... ${moderationStartCountdown} remaining`
                          : moderationSchedule?.scheduled
                          ? `Scheduled time reached. Ready to start session.`
                          : `Set schedule to auto-calculate`}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {isChiefExaminer
                        ? vettingSession.active
                          ? (
                            <button
                              type="button"
                              onClick={() => {
                                if (onEndSession && confirm('Are you sure you want to end the vetting session? This will terminate all active vetter sessions.')) {
                                  onEndSession();
                                }
                              }}
                              className="rounded-lg bg-gradient-to-r from-red-500 to-rose-600 px-3 py-2 text-xs font-bold text-white shadow-md hover:shadow-lg hover:scale-[1.02] transition-all"
                            >
                              End Session
                            </button>
                          )
                          : (
                            <button
                              type="button"
                              onClick={() => onStartVetting(customDuration)}
                              className="rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-md hover:shadow-lg hover:scale-[1.02] transition-all"
                            >
                              Start Session
                            </button>
                          )
                        : canVetterStartSession && (
                            <button
                              type="button"
                              onClick={() => onStartVetting(customDuration)}
                              className="rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-md hover:shadow-lg hover:scale-[1.02] transition-all"
                            >
                              Start Session (Enable Camera)
                            </button>
                          )}
                      {isVetter && vetterHasJoined && (
                        <button
                          type="button"
                          onClick={onCompleteVetting}
                          className="rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 px-3 py-2 text-xs font-bold text-white shadow-md hover:shadow-lg hover:scale-[1.02] transition-all"
                        >
                          Complete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Chief Examiner Monitoring Panel - Shows vetter camera feeds and warnings */}
        {isChiefExaminer && vettingSession.active && (
          <div className="mt-5 space-y-4">
            <div className="rounded-xl border-2 border-red-300/50 bg-gradient-to-br from-red-50 via-pink-50 to-orange-50 p-4 shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-red-500 to-pink-600 shadow-md">
                    <span className="text-white text-lg">👁️</span>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">
                      Vetter Monitoring Dashboard
                    </h3>
                    <p className="text-xs text-slate-600">
                      Real-time camera feeds and violation tracking
                    </p>
                  </div>
                </div>
                {/* Clear Records Button - Only show when session is not active and records exist */}
                {/* Note: This button would need clearVettingRecords passed as prop - removed for now to fix error */}
              </div>

              {/* Restricted Vetters Section */}
              {restrictedVetters && restrictedVetters.size > 0 && (
                <div className="mb-4 rounded-lg border-2 border-red-300 bg-red-50/50 p-4">
                  <h4 className="text-xs font-bold text-red-800 mb-3 flex items-center gap-2">
                    🚫 Restricted Vetters ({restrictedVetters.size})
                  </h4>
                  <div className="space-y-2">
                    {Array.from(restrictedVetters).map((vetterId) => {
                      const vetter = users.find((u: User) => u.id === vetterId);
                      if (!vetter) return null;
                      return (
                        <div key={vetterId} className="flex items-center justify-between rounded-lg border border-red-200 bg-white p-2">
                          <div>
                            <p className="text-xs font-semibold text-slate-800">{vetter.name}</p>
                            <p className="text-[0.65rem] text-red-600">Access restricted due to violation</p>
                          </div>
                          {onReactivateVetter && (
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm(`Reactivate ${vetter.name}? They will be able to join vetting sessions again.`)) {
                                  onReactivateVetter(vetterId);
                                }
                              }}
                              className="rounded-lg bg-green-500 px-3 py-1.5 text-xs font-bold text-white shadow hover:bg-green-600 transition"
                            >
                              Reactivate
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Show message if no vetters have joined yet */}
              {!vetterMonitoring || vetterMonitoring.size === 0 ? (
                <div className="rounded-lg border-2 border-blue-200 bg-blue-50/30 p-4 text-center">
                  <p className="text-sm font-semibold text-slate-700">
                    Waiting for vetters to join...
                  </p>
                  <p className="text-xs text-slate-600 mt-1">
                    Vetter camera feeds and warnings will appear here once they start their sessions.
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {/* Live monitoring data - show during active session */}
                  {vettingSession.active && vetterMonitoring && vetterMonitoring.size > 0 && Array.from((vetterMonitoring || new Map()).entries()).map(([vetterId, monitoring]) => {
                    const warnings = monitoring.warnings || [];
                    const recentWarnings = warnings.slice(-10).reverse(); // Last 10 warnings, newest first
                    const criticalWarnings = warnings.filter(w => w.severity === 'critical');
                    
                    return (
                      <div
                        key={vetterId}
                        className={`rounded-lg border-2 p-3 ${
                          monitoring.violations > 0
                            ? 'border-red-300 bg-red-50/50'
                            : 'border-blue-200 bg-blue-50/30'
                        }`}
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h4 className="text-xs font-bold text-slate-800">
                              {monitoring.vetterName}
                            </h4>
                            <p className="text-[0.65rem] text-slate-600">
                              Joined: {new Date(monitoring.joinedAt).toLocaleTimeString()}
                            </p>
                          </div>
                          <div className="text-right">
                            <div className={`text-xs font-bold ${
                              monitoring.violations > 0 ? 'text-red-600' : 'text-green-600'
                            }`}>
                              {monitoring.violations} {monitoring.violations === 1 ? 'Violation' : 'Violations'}
                            </div>
                            <div className="text-[0.65rem] text-slate-600">
                              {warnings.length} {warnings.length === 1 ? 'Warning' : 'Warnings'}
                            </div>
                          </div>
                        </div>

                        {/* Camera Feed - LIVE VIDEO - ALWAYS SHOW TO CHIEF EXAMINER */}
                        <div className="mb-3 rounded-lg overflow-hidden bg-slate-900 aspect-video relative border-2 border-green-500">
                          {monitoring.cameraStream && monitoring.cameraStream.active ? (
                            <>
                              <div className="absolute top-2 left-2 z-10 bg-red-600 text-white text-[0.6rem] px-2 py-1 rounded font-bold flex items-center gap-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse"></span>
                                LIVE CAMERA
                              </div>
                              <video
                                ref={(video) => {
                                  if (video && monitoring.cameraStream) {
                                    video.srcObject = monitoring.cameraStream;
                                    video.play().catch(err => console.error('Camera playback error:', err));
                                  }
                                }}
                                autoPlay
                                playsInline
                                muted
                                className="w-full h-full object-cover"
                              />
                            </>
                          ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-900/90">
                              <span className="text-white text-lg font-bold mb-2">⚠️ CAMERA OFF</span>
                              <span className="text-white text-xs">Vetter camera is not active</span>
                            </div>
                          )}
                        </div>

                        {/* Critical Alerts - On-Screen Warnings That Appeared on Vetter's Screen - ALWAYS SHOW IF ANY */}
                        {criticalWarnings.length > 0 ? (
                          <div className="mb-3 space-y-1.5">
                            <p className="text-[0.7rem] font-bold text-red-700 mb-2 flex items-center gap-1">
                              🚨 CRITICAL ALERTS - What Vetter Saw ({criticalWarnings.length})
                            </p>
                            {criticalWarnings.slice(-10).reverse().map((warning) => (
                              <div
                                key={warning.id}
                                className="bg-red-100 border-2 border-red-400 text-red-900 p-2 rounded animate-pulse"
                              >
                                <div className="flex items-start justify-between gap-2 mb-1">
                                  <span className="font-bold text-[0.7rem]">⚠️ CRITICAL ALERT</span>
                                  <span className="text-[0.6rem] opacity-75">
                                    {new Date(warning.timestamp).toLocaleTimeString()}
                                  </span>
                                </div>
                                <p className="text-[0.7rem] font-semibold leading-tight">
                                  {warning.message}
                                </p>
                                <p className="text-[0.6rem] text-red-700 mt-1">
                                  Type: {warning.type.replace(/_/g, ' ').toUpperCase()}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mb-3 text-center py-2 bg-green-50 border border-green-200 rounded">
                            <p className="text-[0.65rem] text-green-700 font-semibold">
                              ✓ No critical alerts - Vetter following rules
                            </p>
                          </div>
                        )}

                        {/* All Warnings Log - ALWAYS SHOW ALL WARNINGS TO CHIEF EXAMINER */}
                        {recentWarnings.length > 0 ? (
                          <div className="space-y-1.5 max-h-48 overflow-y-auto">
                            <p className="text-[0.7rem] font-bold text-slate-800 mb-2 flex items-center gap-1">
                              📋 Complete Activity Log ({warnings.length} total warnings):
                            </p>
                            {recentWarnings.map((warning) => (
                              <div
                                key={warning.id}
                                className={`text-[0.65rem] p-2 rounded border ${
                                  warning.severity === 'critical'
                                    ? 'bg-red-100 border-red-300 text-red-900'
                                    : 'bg-amber-100 border-amber-300 text-amber-900'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2 mb-1">
                                  <span className="font-bold text-[0.7rem]">
                                    {warning.severity === 'critical' ? '🔴 CRITICAL' : '⚠️ WARNING'}: {warning.type.replace(/_/g, ' ').toUpperCase()}
                                  </span>
                                  <span className="text-[0.6rem] opacity-75 whitespace-nowrap">
                                    {new Date(warning.timestamp).toLocaleTimeString()}
                                  </span>
                                </div>
                                <p className="mt-0.5 leading-tight font-medium">{warning.message}</p>
                              </div>
                            ))}
                            {warnings.length > 10 && (
                              <p className="text-[0.6rem] text-slate-500 italic text-center pt-1">
                                Showing last 10 warnings. Total: {warnings.length}
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="text-center py-2 bg-green-50 border border-green-200 rounded">
                            <p className="text-[0.65rem] text-green-700 font-semibold">
                              ✓ No warnings - Vetter following all rules
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  
                </div>
              )}
            </div>
          </div>
        )}

        {/* Approve/Reject Section for Chief Examiner when papers are vetted - ALWAYS SHOW IF PAPERS ARE VETTED */}
        {isChiefExaminer && papersToDisplay.length > 0 && papersToDisplay.some((p: SubmittedPaper) => p.status === 'vetted') && (
          <div className="mt-5 space-y-4">
            <div className="rounded-xl border-2 border-green-300/50 bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 p-4 shadow-lg">
              <div className="flex items-center gap-2 mb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 shadow-md">
                  <span className="text-white text-lg">✓</span>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">
                    Review & Decision
                  </h3>
                  <p className="text-xs text-slate-600">
                    Approve paper for printing or return for revision
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <textarea
                  id="decision-notes"
                  placeholder="Decision notes (required for rejection, optional for approval)..."
                  className="w-full rounded-lg border-2 border-green-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-600 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/40 resize-none"
                  rows={3}
                />
                
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      const notesEl = document.getElementById('decision-notes') as HTMLTextAreaElement;
                      const notes = notesEl?.value || '';
                      if (onApprove) {
                        onApprove(notes);
                        if (notesEl) notesEl.value = '';
                      }
                    }}
                    className="flex-1 rounded-lg bg-gradient-to-r from-green-500 to-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all duration-300"
                  >
                    ✓ Approve & Forward to Print
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const notesEl = document.getElementById('decision-notes') as HTMLTextAreaElement;
                      const notes = notesEl?.value || '';
                      if (!notes.trim()) {
                        alert('Please provide feedback notes when rejecting a paper.');
                        return;
                      }
                      
                      // Open professional rejection modal instead of using browser prompts
                      setRejectionNotes(notes);
                      setDeadlineDays(3);
                      setDeadlineHours(0);
                      setDeadlineMinutes(0);
                      setShowDeadlineRejectionModal(true);
                    }}
                    className="flex-1 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all duration-300"
                  >
                    ✗ Reject & Return to Team Lead
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
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
