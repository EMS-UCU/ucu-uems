/**
 * Loads exam papers, workflow timeline, and user profiles for Super Admin reports.
 */
import { supabase } from '../../lib/supabase';
import type { DatabaseUser, ExamPaper, WorkflowTimelineEntry } from '../../lib/supabase';
import type { ReportFilters } from './reportTypes';
import { getFacultyForDepartment } from '../../lib/academicStructure';

export interface LoadedReportData {
  papers: ExamPaper[];
  timeline: WorkflowTimelineEntry[];
  profiles: Map<string, DatabaseUser & { id: string }>;
}

function profileFromRow(p: Record<string, unknown>): DatabaseUser & { id: string } {
  return {
    id: String(p.id),
    email: p.email ? String(p.email) : undefined,
    username: String(p.username ?? ''),
    name: String(p.name ?? 'Unknown'),
    base_role: (p.base_role as 'Admin' | 'Lecturer') ?? 'Lecturer',
    roles: Array.isArray(p.roles) ? (p.roles as string[]) : [],
    password_hash: '',
    is_super_admin: Boolean(p.is_super_admin),
    campus: p.campus ? String(p.campus) : undefined,
    department: p.department ? String(p.department) : undefined,
    course_unit: p.course_unit ? String(p.course_unit) : null,
    lecturer_category: p.lecturer_category as 'Undergraduate' | 'Postgraduate' | undefined,
    created_at: String(p.created_at ?? new Date().toISOString()),
    updated_at: String(p.updated_at ?? new Date().toISOString()),
  };
}

function inferRoleLabel(roles: string[]): string {
  const order = ['Chief Examiner', 'Team Lead', 'Vetter', 'Setter', 'Admin', 'Lecturer'];
  for (const r of order) {
    if (roles?.includes(r)) return r;
  }
  return roles?.[0] ?? 'User';
}

function normalizeDepartmentLabel(value?: string | null): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .replace(/^department\s+of\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function departmentMatches(selectedDepartment: string | undefined, actualDepartment: string | undefined): boolean {
  if (!selectedDepartment) return true;
  const selected = normalizeDepartmentLabel(selectedDepartment);
  const actual = normalizeDepartmentLabel(actualDepartment);
  if (!actual) return false;
  return actual.includes(selected) || selected.includes(actual);
}

function deriveActionFromPaperStatus(status?: string, approvalStatus?: string): string {
  if (approvalStatus === 'approved_for_printing' || status === 'approved_for_printing') {
    return 'Approved for printing';
  }
  if (!status) return 'Paper record updated';
  return status.replace(/_/g, ' ');
}

function createSyntheticTimelineFromPapers(papers: ExamPaper[]): WorkflowTimelineEntry[] {
  const events: WorkflowTimelineEntry[] = [];
  for (const p of papers) {
    const createdAt = p.submitted_at || p.created_at || p.updated_at;
    events.push({
      id: `synthetic-created-${p.id}`,
      exam_paper_id: p.id,
      actor_id: p.setter_id,
      action: 'Paper submitted',
      description: `${p.course_code} ${p.course_name} was submitted to the workflow`,
      from_status: undefined,
      to_status: p.status,
      metadata: { source: 'derived_from_exam_papers', synthetic: true },
      created_at: createdAt,
    });

    // Add status/approval progression marker when updated differs from created/submitted.
    if (p.updated_at && p.updated_at !== createdAt) {
      events.push({
        id: `synthetic-updated-${p.id}`,
        exam_paper_id: p.id,
        actor_id: p.chief_examiner_id || p.team_lead_id || p.setter_id,
        action: deriveActionFromPaperStatus(p.status, p.approval_status),
        description: `Current workflow state: ${p.status}${p.approval_status ? `, approval: ${p.approval_status}` : ''}`,
        from_status: undefined,
        to_status: p.status,
        metadata: { source: 'derived_from_exam_papers', synthetic: true },
        created_at: p.updated_at,
      });
    }
  }
  return events.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export function getProfileDisplay(
  profiles: Map<string, DatabaseUser & { id: string }>,
  userId?: string | null
): { name: string; role: string } {
  if (!userId) return { name: '—', role: '—' };
  const p = profiles.get(userId);
  if (!p) return { name: userId.slice(0, 8) + '…', role: '—' };
  return { name: p.name, role: inferRoleLabel(p.roles || []) };
}

export async function loadProfilesByIds(ids: string[]): Promise<Map<string, DatabaseUser & { id: string }>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, DatabaseUser & { id: string }>();
  if (unique.length === 0) return map;

  const { data, error } = await supabase.from('user_profiles').select('*').in('id', unique);
  if (error) {
    console.warn('reportDataService: user_profiles', error.message);
    return map;
  }
  (data || []).forEach((row: Record<string, unknown>) => {
    const prof = profileFromRow(row);
    map.set(prof.id, prof);
  });
  return map;
}

export async function loadReportData(filters: ReportFilters): Promise<LoadedReportData> {
  let paperQuery = supabase.from('exam_papers').select('*').order('created_at', { ascending: false });

  if (filters.academicYear) {
    paperQuery = paperQuery.eq('academic_year', filters.academicYear);
  }
  if (filters.semester) {
    paperQuery = paperQuery.eq('semester', filters.semester);
  }
  if (filters.courseCode) {
    paperQuery = paperQuery.ilike('course_code', `%${filters.courseCode.trim()}%`);
  }
  if (filters.paperTitleSearch) {
    paperQuery = paperQuery.ilike('course_name', `%${filters.paperTitleSearch.trim()}%`);
  }

  const { data: papersData, error: papersError } = await paperQuery;
  if (papersError) {
    console.warn('exam_papers', papersError.message);
  }
  let papers = (papersData || []) as ExamPaper[];

  const setterIdsForDept = [...new Set(papers.map((p) => p.setter_id).filter(Boolean))] as string[];
  const deptProfiles = await loadProfilesByIds(setterIdsForDept);

  if (filters.department || filters.faculty) {
    const selectedFaculty = filters.faculty?.toLowerCase();
    papers = papers.filter((p) => {
      const prof = p.setter_id ? deptProfiles.get(p.setter_id) : undefined;
      const profDepartment = prof?.department ?? '';
      // If profile metadata is missing for this paper, do not hard-fail the row;
      // otherwise reports become empty even when valid workflow/paper activity exists.
      const deptMatch = filters.department
        ? profDepartment
          ? departmentMatches(filters.department, profDepartment)
          : true
        : true;
      const inferredFaculty = getFacultyForDepartment(profDepartment);
      const campusText = (p.campus || '').toLowerCase();
      const facultyMatch = filters.faculty
        ? inferredFaculty === filters.faculty ||
          (selectedFaculty ? campusText.includes(selectedFaculty) : false) ||
          // If profile metadata is incomplete, avoid false negatives.
          (!inferredFaculty && !campusText) ||
          (!inferredFaculty && Boolean(profDepartment) === false)
        : true;
      return Boolean(deptMatch && facultyMatch);
    });
  }

  const paperIds = papers.map((p) => p.id);

  let timelineQuery = supabase
    .from('workflow_timeline')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(15000);

  if (filters.dateFrom) {
    timelineQuery = timelineQuery.gte('created_at', new Date(filters.dateFrom).toISOString());
  }
  if (filters.dateTo) {
    const end = new Date(filters.dateTo);
    end.setHours(23, 59, 59, 999);
    timelineQuery = timelineQuery.lte('created_at', end.toISOString());
  }

  const { data: timelineData, error: timelineError } = await timelineQuery;
  if (timelineError) {
    console.warn('workflow_timeline', timelineError.message);
  }
  let timeline = (timelineData || []) as WorkflowTimelineEntry[];

  if (papers.length > 0) {
    timeline = timeline.filter((t) => paperIds.includes(t.exam_paper_id));
  }

  if (filters.userId) {
    timeline = timeline.filter((t) => t.actor_id === filters.userId);
  }

  // Fallback: if there are no persisted workflow_timeline rows for the selected scope,
  // derive basic lifecycle events from exam_papers so Audit reports are not blank.
  if (timeline.length === 0 && papers.length > 0) {
    timeline = createSyntheticTimelineFromPapers(papers);
  }

  const actorIds = [...new Set(timeline.map((t) => t.actor_id).filter(Boolean))] as string[];
  const setterIds = [...new Set(papers.map((p) => p.setter_id).filter(Boolean))] as string[];
  const tlIds = [...new Set(papers.map((p) => p.team_lead_id).filter(Boolean))] as string[];
  const ceIds = [...new Set(papers.map((p) => p.chief_examiner_id).filter(Boolean))] as string[];
  const allUserIds = [...new Set([...actorIds, ...setterIds, ...tlIds, ...ceIds, filters.userId].filter(Boolean))] as string[];

  const profiles = await loadProfilesByIds(allUserIds);

  if (filters.roleFilter && filters.roleFilter !== 'all') {
    timeline = timeline.filter((t) => {
      const a = t.actor_id ? profiles.get(t.actor_id) : undefined;
      return a?.roles?.includes(filters.roleFilter!);
    });
  }

  return { papers, timeline, profiles };
}
