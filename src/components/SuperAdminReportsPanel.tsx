import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { ACADEMIC_STRUCTURE, type AcademicFaculty } from '../lib/academicStructure';
import { UCU_SEMESTERS, getSemesterForDate } from '../lib/semester';
import {
  loadReportData,
  buildAuditTrailReport,
  buildExamPaperStatusReport,
  buildChiefSignOffReport,
  downloadAuditTrailPdf,
  downloadExamStatusPdf,
  downloadChiefSignOffPdf,
  downloadCsv,
  type ReportFilters,
  type AuditTrailReport,
  type ExamPaperStatusReport,
  type ChiefSignOffReport,
} from '../services/reports';

type Tab = 'audit' | 'status' | 'signoff';
type PreviewReport =
  | { kind: 'audit'; data: AuditTrailReport }
  | { kind: 'status'; data: ExamPaperStatusReport }
  | { kind: 'signoff'; data: ChiefSignOffReport };

function uniqSorted(arr: (string | null | undefined)[]): string[] {
  return [...new Set(arr.filter(Boolean).map((s) => String(s).trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
}

function getPrimaryYear(value: string | undefined): number | null {
  if (!value) return null;
  const m = value.match(/\d{4}/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function semesterOrder(semester: string): number {
  if (semester === 'Easter') return 1;
  if (semester === 'Trinity') return 2;
  return 3; // Advent
}

const selectClass =
  'mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400';

const COURSE_UNIT_PRESETS = ['Advanced Networking', 'Database Programming'];

interface SuperAdminReportsPanelProps {
  currentUserId?: string;
  currentUserName: string;
  /** Primary role label for report header */
  currentUserRole: string;
}

export default function SuperAdminReportsPanel({
  currentUserName,
  currentUserRole,
}: SuperAdminReportsPanelProps) {
  const currentSemester = useMemo(() => getSemesterForDate(), []);
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const [tab, setTab] = useState<Tab>('audit');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [previewReport, setPreviewReport] = useState<PreviewReport | null>(null);

  const [filterOptionsLoading, setFilterOptionsLoading] = useState(true);
  const [academicYearOptions, setAcademicYearOptions] = useState<string[]>([]);
  const [semesterOptions, setSemesterOptions] = useState<string[]>([...UCU_SEMESTERS]);
  const [facultyOptions] = useState<string[]>(
    Object.keys(ACADEMIC_STRUCTURE) as AcademicFaculty[]
  );
  const [courseUnitOptions, setCourseUnitOptions] = useState<string[]>(COURSE_UNIT_PRESETS);

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [academicYear, setAcademicYear] = useState('');
  const [semester, setSemester] = useState('');
  const [faculty, setFaculty] = useState('');
  const [department, setDepartment] = useState('');
  const [courseUnit, setCourseUnit] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setFilterOptionsLoading(true);
      try {
        const { data: papers, error: papersErr } = await supabase
          .from('exam_papers')
          .select('academic_year, semester, campus, course_code, course_name');

        if (papersErr) {
          console.warn('Report filter options (exam_papers):', papersErr.message);
        }

        const rows = papers || [];
        const years = uniqSorted(rows.map((r) => r.academic_year));
        const units = uniqSorted([...COURSE_UNIT_PRESETS, ...rows.map((r) => r.course_name)]);

        if (!cancelled) {
          setAcademicYearOptions(years);
          setSemesterOptions([...UCU_SEMESTERS]);
          setCourseUnitOptions(units);
        }
      } finally {
        if (!cancelled) setFilterOptionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentSemester]);

  const isCurrentAcademicYear = useMemo(() => {
    const selectedYear = getPrimaryYear(academicYear);
    if (selectedYear == null) return false;
    return selectedYear === currentYear;
  }, [academicYear, currentYear]);

  const currentSemesterRank = useMemo(() => semesterOrder(currentSemester), [currentSemester]);

  const isSemesterDisabled = (option: string): boolean => {
    if (!isCurrentAcademicYear) return false;
    return semesterOrder(option) > currentSemesterRank;
  };

  useEffect(() => {
    if (!semester) return;
    if (isSemesterDisabled(semester)) {
      setSemester(currentSemester);
    }
  }, [academicYear, semester, currentSemester, isCurrentAcademicYear, currentSemesterRank]);

  useEffect(() => {
    const facultyDepartments: string[] = faculty
      ? [...ACADEMIC_STRUCTURE[faculty as AcademicFaculty]]
      : Object.values(ACADEMIC_STRUCTURE).flat();
    const available = facultyDepartments;
    if (department && !available.includes(department)) {
      setDepartment('');
    }
  }, [faculty, department]);

  const filters: ReportFilters = useMemo(
    () => ({
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      academicYear: academicYear || undefined,
      semester: semester || undefined,
      faculty: faculty || undefined,
      department: department || undefined,
      paperTitleSearch: courseUnit || undefined,
      roleFilter: roleFilter === 'all' ? undefined : roleFilter,
    }),
    [dateFrom, dateTo, academicYear, semester, faculty, department, courseUnit, roleFilter]
  );

  const generatePreview = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await loadReportData(filters);
      const genBy = currentUserName;
      const genRole = currentUserRole;

      if (tab === 'audit') {
        const report = buildAuditTrailReport(data, filters, genBy, genRole);
        setPreviewReport({ kind: 'audit', data: report });
      } else if (tab === 'status') {
        const report = buildExamPaperStatusReport(data, filters, genBy, genRole);
        setPreviewReport({ kind: 'status', data: report });
      } else {
        const report = buildChiefSignOffReport(
          data,
          filters,
          genBy,
          genRole,
          currentUserName
        );
        setPreviewReport({ kind: 'signoff', data: report });
      }
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  const runExport = async (mode: 'pdf' | 'csv') => {
    if (!previewReport || previewReport.kind !== tab) {
      setError('Please click "Preview report" first for the current tab.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (previewReport.kind === 'audit') {
        const report = previewReport.data;
        if (mode === 'pdf') {
          await downloadAuditTrailPdf(report);
        } else {
          downloadCsv(
            `audit-trail-${report.header.reportReference}.csv`,
            ['Event ID', 'Timestamp', 'User', 'Role', 'Action', 'Paper', 'Previous', 'New', 'IP/Device', 'Remarks'],
            report.rows.map((r) => [
              r.eventId,
              r.timestamp,
              r.userName,
              r.role,
              r.actionPerformed,
              r.paperAffected,
              r.previousState,
              r.newState,
              r.ipOrDevice,
              r.remarks,
            ])
          );
        }
      } else if (previewReport.kind === 'status') {
        const report = previewReport.data;
        if (mode === 'pdf') {
          await downloadExamStatusPdf(report);
        } else {
          downloadCsv(
            `exam-paper-status-${report.header.reportReference}.csv`,
            ['Paper ID', 'Course Code', 'Course Name', 'Department', 'Setter', 'Date Submitted', 'Stage', 'Owner', 'Last Action', 'Last Action Date', 'Days', 'Deadline', 'Flag', 'Remarks'],
            report.rows.map((r) => [
              r.paperId,
              r.courseCode,
              r.courseName,
              r.department,
              r.setterName,
              r.dateSubmitted,
              r.currentStage,
              r.currentOwner,
              r.lastAction,
              r.lastActionDate,
              String(r.daysInSystem),
              r.deadline,
              r.statusFlag,
              r.remarks,
            ])
          );
        }
      } else {
        const report = previewReport.data;
        if (mode === 'pdf') {
          await downloadChiefSignOffPdf(report);
        } else {
          downloadCsv(
            `chief-signoff-${report.header.reportReference}.csv`,
            ['Paper ID', 'Code', 'Course', 'Dept', 'Setter', 'Lead Vetter', 'First Submitted', 'Revisions', 'Final Approval', 'Checklist', 'Approved For', 'Level'],
            report.approvedPapers.map((r) => [
              r.paperId,
              r.courseCode,
              r.courseName,
              r.department,
              r.setterName,
              r.leadVetter,
              r.dateFirstSubmitted,
              String(r.revisionCount),
              r.dateFinalApproval,
              r.checklistScore,
              r.approvedFor,
              r.confidentialityLevel,
            ])
          );
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to download report');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/80 to-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
            Accountability & audit
          </p>
          <h3 className="text-lg font-bold text-slate-900">Regulatory reports</h3>
          <p className="text-xs text-slate-600 max-w-xl">
            Audit trail (workflow timeline), exam paper status snapshot, and Chief Examiner sign-off export.
            Data comes from Supabase (<code className="text-[10px]">exam_papers</code>,{' '}
            <code className="text-[10px]">workflow_timeline</code>, <code className="text-[10px]">user_profiles</code>).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => void generatePreview()}
            className="rounded-lg bg-slate-700 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? 'Working…' : 'Preview report'}
          </button>
          <button
            type="button"
            disabled={loading || !previewReport || previewReport.kind !== tab}
            onClick={() => void runExport('pdf')}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'Working…' : 'Download PDF'}
          </button>
          <button
            type="button"
            disabled={loading || !previewReport || previewReport.kind !== tab}
            onClick={() => void runExport('csv')}
            className="rounded-lg border border-indigo-200 bg-white px-4 py-2 text-xs font-semibold text-indigo-800 hover:bg-indigo-50 disabled:opacity-50"
          >
            Download CSV
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 rounded-full border border-slate-200 bg-white p-0.5 text-xs font-semibold text-slate-700">
        {(
          [
            { id: 'audit' as const, label: '1. Audit trail' },
            { id: 'status' as const, label: '2. Exam paper status' },
            { id: 'signoff' as const, label: '3. Chief sign-off' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-full px-3 py-1.5 transition ${
              tab === t.id ? 'bg-indigo-600 text-white' : 'hover:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {filterOptionsLoading && (
        <p className="text-[11px] text-indigo-600">Loading filter lists from your database…</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block text-[11px] font-medium text-slate-700">
          Academic year
          <select
            value={academicYear}
            onChange={(e) => setAcademicYear(e.target.value)}
            disabled={filterOptionsLoading}
            className={selectClass}
          >
            <option value="">All academic years</option>
            {academicYearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[11px] font-medium text-slate-700">
          Semester
          <select
            value={semester}
            onChange={(e) => setSemester(e.target.value)}
            disabled={filterOptionsLoading}
            className={selectClass}
          >
            <option value="">All semesters</option>
            {semesterOptions.map((s) => (
              <option key={s} value={s} disabled={isSemesterDisabled(s)}>
                {s}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[10px] text-slate-500">
            For the current year, future semesters are disabled by month (Easter Jan-Apr, Trinity May-Aug, Advent Sep-Dec).
          </span>
        </label>
        <label className="block text-[11px] font-medium text-slate-700">
          Faculty
          <select
            value={faculty}
            onChange={(e) => setFaculty(e.target.value)}
            disabled={filterOptionsLoading}
            className={selectClass}
          >
            <option value="">All faculties</option>
            {facultyOptions.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[11px] font-medium text-slate-700">
          Department
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            disabled={filterOptionsLoading}
            className={selectClass}
          >
            <option value="">All departments</option>
            {(faculty
              ? [...ACADEMIC_STRUCTURE[faculty as AcademicFaculty]]
              : Object.values(ACADEMIC_STRUCTURE).flat()
            ).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[11px] font-medium text-slate-700">
          Course unit
          <select
            value={courseUnit}
            onChange={(e) => setCourseUnit(e.target.value)}
            disabled={filterOptionsLoading}
            className={selectClass}
          >
            <option value="">All course units</option>
            {courseUnitOptions.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[11px] font-medium text-slate-700">
          Actor role (audit trail)
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className={selectClass}
          >
            <option value="all">All roles</option>
            <option value="Chief Examiner">Chief Examiner</option>
            <option value="Team Lead">Team Lead</option>
            <option value="Vetter">Vetter</option>
            <option value="Setter">Setter</option>
          </select>
        </label>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white/80 p-2">
        <button
          type="button"
          onClick={() => setShowAdvancedFilters((v) => !v)}
          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <span>Advanced filters</span>
          <span className="text-slate-500">{showAdvancedFilters ? 'Hide' : 'Show'}</span>
        </button>

        {showAdvancedFilters && (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="block text-[11px] font-medium text-slate-700">
              Date from
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-xs"
              />
            </label>
            <label className="block text-[11px] font-medium text-slate-700">
              Date to
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-xs"
              />
            </label>
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>
      )}

      {previewReport && previewReport.kind === tab && (
        <div className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-indigo-700">
            Report preview
          </p>
          {previewReport.kind === 'audit' && (
            <>
              <p className="mb-2 text-sm text-slate-700">
                Events: <span className="font-semibold">{previewReport.data.summary.totalEvents}</span>, Papers:{' '}
                <span className="font-semibold">{previewReport.data.summary.totalPapersTracked}</span>, Users:{' '}
                <span className="font-semibold">{previewReport.data.summary.totalUsersInvolved}</span>
              </p>
              <div className="overflow-x-auto rounded border border-slate-200">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-50 text-slate-700">
                    <tr>
                      <th className="px-2 py-1 text-left">Timestamp</th>
                      <th className="px-2 py-1 text-left">User</th>
                      <th className="px-2 py-1 text-left">Action</th>
                      <th className="px-2 py-1 text-left">Paper</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewReport.data.rows.slice(0, 12).map((r) => (
                      <tr key={r.eventId} className="border-t border-slate-100">
                        <td className="px-2 py-1">{new Date(r.timestamp).toLocaleString()}</td>
                        <td className="px-2 py-1">{r.userName}</td>
                        <td className="px-2 py-1">{r.actionPerformed}</td>
                        <td className="px-2 py-1">{r.paperAffected}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {previewReport.kind === 'status' && (
            <>
              <p className="mb-2 text-sm text-slate-700">
                Expected: <span className="font-semibold">{previewReport.data.summaryDashboard.totalExpected}</span>{' '}
                | Approved: <span className="font-semibold">{previewReport.data.summaryDashboard.approvedReady}</span>{' '}
                | Overdue: <span className="font-semibold">{previewReport.data.summaryDashboard.totalOverdue}</span>
              </p>
              <div className="overflow-x-auto rounded border border-slate-200">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-50 text-slate-700">
                    <tr>
                      <th className="px-2 py-1 text-left">Code</th>
                      <th className="px-2 py-1 text-left">Course</th>
                      <th className="px-2 py-1 text-left">Stage</th>
                      <th className="px-2 py-1 text-left">Owner</th>
                      <th className="px-2 py-1 text-left">Flag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewReport.data.rows.slice(0, 12).map((r) => (
                      <tr key={r.paperId} className="border-t border-slate-100">
                        <td className="px-2 py-1">{r.courseCode}</td>
                        <td className="px-2 py-1">{r.courseName}</td>
                        <td className="px-2 py-1">{r.currentStage}</td>
                        <td className="px-2 py-1">{r.currentOwner}</td>
                        <td className="px-2 py-1">{r.statusFlag}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {previewReport.kind === 'signoff' && (
            <>
              <p className="mb-2 text-sm text-slate-700">
                Approved: <span className="font-semibold">{previewReport.data.statistics.totalApproved}</span> | Deferred:{' '}
                <span className="font-semibold">{previewReport.data.statistics.totalDeferred}</span>
              </p>
              <div className="overflow-x-auto rounded border border-slate-200">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-50 text-slate-700">
                    <tr>
                      <th className="px-2 py-1 text-left">Code</th>
                      <th className="px-2 py-1 text-left">Course</th>
                      <th className="px-2 py-1 text-left">Setter</th>
                      <th className="px-2 py-1 text-left">Approved For</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewReport.data.approvedPapers.slice(0, 12).map((r) => (
                      <tr key={r.paperId} className="border-t border-slate-100">
                        <td className="px-2 py-1">{r.courseCode}</td>
                        <td className="px-2 py-1">{r.courseName}</td>
                        <td className="px-2 py-1">{r.setterName}</td>
                        <td className="px-2 py-1">{r.approvedFor}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      <motion.div
        initial={{ opacity: 0.9 }}
        animate={{ opacity: 1 }}
        className="rounded-xl border border-slate-100 bg-white/90 p-4 text-[11px] text-slate-600"
      >
        {tab === 'audit' && (
          <p>
            <strong>Audit trail</strong> lists workflow timeline events with actor, action, and status
            transitions. IP/device is shown as &quot;Not recorded&quot; unless you extend the schema to store it.
          </p>
        )}
        {tab === 'status' && (
          <p>
            <strong>Exam paper status</strong> summarises each paper’s stage, owner, deadlines, and a simple
            on-track / at-risk / overdue flag from deadlines.
          </p>
        )}
        {tab === 'signoff' && (
          <p>
            <strong>Chief sign-off</strong> lists papers with approval for printing and optional rejected rows.
            Certification text uses your display name; formal signatures are placeholders for ink/PDF signing.
          </p>
        )}
      </motion.div>
    </div>
  );
}
