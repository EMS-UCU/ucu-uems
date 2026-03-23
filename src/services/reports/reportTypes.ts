/**
 * Structured types for Super Admin accountability reports (Audit Trail, Status, Chief Sign-off).
 */

export type ReportKind = 'audit_trail' | 'exam_paper_status' | 'chief_sign_off';

export interface ReportFilters {
  dateFrom?: string; // ISO date
  dateTo?: string;
  academicYear?: string;
  semester?: string;
  faculty?: string;
  department?: string;
  courseCode?: string;
  paperTitleSearch?: string;
  userId?: string;
  roleFilter?: string; // e.g. 'Chief Examiner' | 'Vetter' | 'all'
}

export interface ReportHeader {
  reportTitle: string;
  academicYear?: string;
  semester?: string;
  generatedAt: string;
  generatedByName: string;
  generatedByRole: string;
  reportReference: string;
  facultyName?: string;
  examinationPeriod?: string;
  dateOfApproval?: string;
}

export interface AuditTrailRow {
  eventId: string;
  timestamp: string;
  userName: string;
  role: string;
  actionPerformed: string;
  paperAffected: string;
  previousState: string;
  newState: string;
  ipOrDevice: string;
  remarks: string;
}

export interface AuditTrailReport {
  header: ReportHeader;
  filtersApplied: ReportFilters;
  rows: AuditTrailRow[];
  summary: {
    totalEvents: number;
    totalPapersTracked: number;
    totalUsersInvolved: number;
    flaggedAnomalies: string[];
  };
  footer: ReportFooter;
}

export interface ExamPaperStatusRow {
  paperId: string;
  courseCode: string;
  courseName: string;
  department: string;
  setterName: string;
  dateSubmitted: string;
  currentStage: string;
  currentOwner: string;
  lastAction: string;
  lastActionDate: string;
  daysInSystem: number;
  deadline: string;
  statusFlag: 'On Track' | 'At Risk' | 'Overdue';
  remarks: string;
}

export interface ExamPaperStatusReport {
  header: ReportHeader;
  filtersApplied: ReportFilters;
  summaryDashboard: {
    totalExpected: number;
    totalSubmitted: number;
    underModeration: number;
    approvedReady: number;
    returnedRevision: number;
    totalOverdue: number;
  };
  rows: ExamPaperStatusRow[];
  stageBreakdown: { stage: string; count: number }[];
  footer: ReportFooter;
}

export interface ChiefSignOffApprovedRow {
  paperId: string;
  courseCode: string;
  courseName: string;
  department: string;
  setterName: string;
  leadVetter: string;
  dateFirstSubmitted: string;
  revisionCount: number;
  dateFinalApproval: string;
  checklistScore: string;
  approvedFor: string;
  confidentialityLevel: string;
}

export interface ChiefSignOffRejectedRow {
  paperId: string;
  courseCode: string;
  courseName: string;
  reason: string;
  recommendedAction: string;
  responsibleOfficer: string;
}

export interface ChiefSignOffReport {
  header: ReportHeader;
  certificationStatement: string;
  approvedPapers: ChiefSignOffApprovedRow[];
  rejectedOrDeferred: ChiefSignOffRejectedRow[];
  statistics: {
    totalApproved: number;
    totalDeferred: number;
    avgTurnaroundDays: number | null;
    fastestDays: number | null;
    slowestDays: number | null;
  };
  signOffBlock: {
    chiefExaminer: string;
    qaOfficer: string;
    deanOrHod: string;
  };
  footer: ReportFooter;
}

export interface ReportFooter {
  systemVersion: string;
  databaseTimestamp: string;
  digitalSignatureNote: string;
  confidentialityNotice?: string;
}
