import type { ExamPaperStatusReport, ReportFilters } from './reportTypes';
import type { ExamPaper } from '../../lib/supabase';
import type { LoadedReportData } from './reportDataService';
import { getProfileDisplay } from './reportDataService';
import { generateReportReference } from './reportReference';

function mapStatusToStage(status: string, approval?: string): string {
  if (approval === 'approved_for_printing' || status === 'approved_for_printing') return 'Approved & Ready';
  if (status === 'draft') return 'Draft';
  if (status === 'vetting_in_progress' || status === 'appointed_for_vetting') return 'Under Vetting';
  if (status === 'revision_in_progress' || status === 'resubmitted_to_chief_examiner') return 'Returned / Revision';
  if (status === 'rejected_restart_process') return 'Rejected / Restart';
  return status.replace(/_/g, ' ');
}

function currentOwner(p: ExamPaper, profiles: LoadedReportData['profiles']): string {
  if (p.chief_examiner_id) return getProfileDisplay(profiles, p.chief_examiner_id).name;
  if (p.team_lead_id) return getProfileDisplay(profiles, p.team_lead_id).name;
  if (p.setter_id) return getProfileDisplay(profiles, p.setter_id).name;
  return '—';
}

function daysBetween(start: string | undefined, end: Date): number {
  if (!start) return 0;
  const a = new Date(start).getTime();
  return Math.max(0, Math.floor((end.getTime() - a) / (86400 * 1000)));
}

function flagPaper(p: ExamPaper): 'On Track' | 'At Risk' | 'Overdue' {
  if (p.deadline) {
    const dl = new Date(p.deadline).getTime();
    const now = Date.now();
    if (dl < now && p.approval_status !== 'approved_for_printing' && p.status !== 'approved_for_printing') {
      return 'Overdue';
    }
    if (dl - now < 3 * 86400 * 1000) return 'At Risk';
  }
  return 'On Track';
}

export function buildExamPaperStatusReport(
  data: LoadedReportData,
  filters: ReportFilters,
  generatedByName: string,
  generatedByRole: string
): ExamPaperStatusReport {
  const ref = generateReportReference('UEMS-STS');
  const now = new Date();

  const rows = data.papers.map((p) => {
    const setter = getProfileDisplay(data.profiles, p.setter_id);
    const submitted = p.submitted_at || p.created_at;
    const lastT = data.timeline.find((t) => t.exam_paper_id === p.id);
    return {
      paperId: p.id,
      courseCode: p.course_code,
      courseName: p.course_name,
      department: p.campus || '—',
      setterName: setter.name,
      dateSubmitted: submitted,
      currentStage: mapStatusToStage(p.status, p.approval_status),
      currentOwner: currentOwner(p, data.profiles),
      lastAction: lastT?.action || lastT?.description || '—',
      lastActionDate: lastT?.created_at || p.updated_at,
      daysInSystem: daysBetween(submitted, now),
      deadline: p.deadline || p.printing_due_date || '—',
      statusFlag: flagPaper(p),
      remarks: '',
    };
  });

  const summaryDashboard = {
    totalExpected: rows.length,
    totalSubmitted: data.papers.filter((p) => p.status !== 'draft').length,
    underModeration: data.papers.filter(
      (p) =>
        p.status === 'vetting_in_progress' ||
        p.status === 'appointed_for_vetting' ||
        p.status === 'vetted_with_comments'
    ).length,
    approvedReady: data.papers.filter(
      (p) => p.approval_status === 'approved_for_printing' || p.status === 'approved_for_printing'
    ).length,
    returnedRevision: data.papers.filter(
      (p) => p.status === 'revision_in_progress' || p.status === 'resubmitted_to_chief_examiner'
    ).length,
    totalOverdue: rows.filter((r) => r.statusFlag === 'Overdue').length,
  };

  const stageMap: Record<string, number> = {};
  rows.forEach((r) => {
    stageMap[r.currentStage] = (stageMap[r.currentStage] || 0) + 1;
  });
  const stageBreakdown = Object.entries(stageMap).map(([stage, count]) => ({ stage, count }));

  return {
    header: {
      reportTitle: 'Exam Paper Status Report',
      academicYear: filters.academicYear,
      semester: filters.semester,
      generatedAt: now.toISOString(),
      generatedByName,
      generatedByRole,
      reportReference: ref,
    },
    filtersApplied: { ...filters },
    summaryDashboard,
    rows,
    stageBreakdown,
    footer: {
      systemVersion: 'UEMS Web',
      databaseTimestamp: now.toISOString(),
      digitalSignatureNote: 'Confidential — for authorised personnel only.',
      confidentialityNotice: 'Unauthorized disclosure is prohibited.',
    },
  };
}
