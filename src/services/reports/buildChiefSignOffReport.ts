import type { ChiefSignOffReport, ReportFilters } from './reportTypes';
import type { ExamPaper } from '../../lib/supabase';
import type { LoadedReportData } from './reportDataService';
import { getProfileDisplay } from './reportDataService';
import { generateReportReference } from './reportReference';

function isApproved(p: ExamPaper): boolean {
  return p.approval_status === 'approved_for_printing' || p.status === 'approved_for_printing';
}

function isRejected(p: ExamPaper): boolean {
  return p.status === 'rejected_restart_process';
}

function turnaroundDays(p: ExamPaper): number | null {
  const start = p.submitted_at || p.created_at;
  if (!start || !p.updated_at) return null;
  const a = new Date(start).getTime();
  const b = new Date(p.updated_at).getTime();
  return Math.max(0, Math.floor((b - a) / (86400 * 1000)));
}

export function buildChiefSignOffReport(
  data: LoadedReportData,
  filters: ReportFilters,
  generatedByName: string,
  generatedByRole: string,
  chiefExaminerName: string
): ChiefSignOffReport {
  const ref = generateReportReference('UEMS-CEO');
  const now = new Date().toISOString();

  const approvedPapers = data.papers.filter(isApproved);
  const rejected = data.papers.filter(isRejected);

  const approvedRows = approvedPapers.map((p) => {
    const setter = getProfileDisplay(data.profiles, p.setter_id);
    const rev = Math.max(0, (p.version_number || 1) - 1);
    return {
      paperId: p.id,
      courseCode: p.course_code,
      courseName: p.course_name,
      department: p.campus || '—',
      setterName: setter.name,
      leadVetter: '—',
      dateFirstSubmitted: p.submitted_at || p.created_at,
      revisionCount: rev,
      dateFinalApproval: p.updated_at,
      checklistScore: 'Pass (see moderation records)',
      approvedFor: 'Main examination',
      confidentialityLevel: 'Restricted — Not for distribution',
    };
  });

  const rejectedRows = rejected.map((p) => ({
    paperId: p.id,
    courseCode: p.course_code,
    courseName: p.course_name,
    reason: 'Rejected / restart process (see workflow timeline)',
    recommendedAction: 'Return to setter for full revision per Chief Examiner instructions',
    responsibleOfficer: getProfileDisplay(data.profiles, p.setter_id).name,
  }));

  const turns = approvedPapers.map(turnaroundDays).filter((x): x is number => x !== null);
  const avg =
    turns.length > 0 ? turns.reduce((a, b) => a + b, 0) / turns.length : null;
  const fastest = turns.length ? Math.min(...turns) : null;
  const slowest = turns.length ? Math.max(...turns) : null;

  const certification = `I, ${chiefExaminerName}, hereby certify that the examination papers listed below have undergone the full moderation and vetting process as prescribed by the Uganda Christian University Examinations Policy. Each paper has been reviewed for academic integrity, marking scheme completeness, and formatting compliance, and is hereby approved for secure printing and administration.`;

  return {
    header: {
      reportTitle: 'Chief Examiner Examination Paper Approval Report',
      academicYear: filters.academicYear,
      semester: filters.semester,
      generatedAt: now,
      generatedByName,
      generatedByRole,
      reportReference: ref,
      facultyName: filters.faculty || 'Uganda Christian University',
      examinationPeriod: filters.semester
        ? `${filters.semester} — ${filters.academicYear || 'Current year'}`
        : undefined,
      dateOfApproval: now.slice(0, 10),
    },
    certificationStatement: certification,
    approvedPapers: approvedRows,
    rejectedOrDeferred: rejectedRows,
    statistics: {
      totalApproved: approvedRows.length,
      totalDeferred: rejectedRows.length,
      avgTurnaroundDays: avg !== null ? Math.round(avg * 10) / 10 : null,
      fastestDays: fastest,
      slowestDays: slowest,
    },
    signOffBlock: {
      chiefExaminer: chiefExaminerName,
      qaOfficer: '________________',
      deanOrHod: '________________',
    },
    footer: {
      systemVersion: 'UEMS Web',
      databaseTimestamp: now,
      digitalSignatureNote: 'Official record when countersigned per institutional policy.',
      confidentialityNotice: 'For internal use only. Unauthorized disclosure is prohibited.',
    },
  };
}
