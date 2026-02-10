import { useMemo, useState } from 'react';
import type { RecordingEntry } from '../types/recordings';

interface RecordingReviewPanelProps {
  recordings: RecordingEntry[];
  contextLabel: string;
}

interface RecordingHierarchy {
  years: RecordingYearGroup[];
  totalRecordings: number;
}

interface RecordingYearGroup {
  label: string;
  totalRecordings: number;
  semesters: RecordingSemesterGroup[];
}

interface RecordingSemesterGroup {
  label: string;
  totalRecordings: number;
  dateRange: string;
  studyYears: RecordingStudyYearGroup[];
}

interface RecordingStudyYearGroup {
  label: string;
  totalRecordings: number;
  courses: RecordingCourseGroup[];
}

interface RecordingCourseGroup {
  courseUnit: string;
  courseCode?: string;
  entries: RecordingEntry[];
}

interface RecordingInsights {
  totalRecordings: number;
  totalCourses: number;
  busiestYear?: string;
  busiestSemester?: string;
  averageDuration?: string;
  latestRecording?: string;
}

const SEMESTER_ORDER = ['advent', 'trinity', 'easter'];
const STUDY_YEAR_ORDER = ['first year', 'second year', 'third year', 'fourth year'];

export default function RecordingReviewPanel({
  recordings,
  contextLabel,
}: RecordingReviewPanelProps) {
  const [activeTab, setActiveTab] = useState<'archive' | 'insights'>('archive');

  const hierarchy = useMemo(() => buildHierarchy(recordings), [recordings]);
  const insights = useMemo(() => buildInsights(recordings, hierarchy), [recordings, hierarchy]);

  return (
    <div className="rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-white via-slate-50 to-slate-100 p-6 shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Vetting Session Recordings
          </p>
          <h2 className="text-xl font-bold text-slate-900">{contextLabel} Review Hub</h2>
          <p className="text-xs text-slate-500 mt-1">
            Browse secure camera recordings organised by academic calendar.
          </p>
        </div>
        <div className="flex rounded-full border border-slate-200 bg-white p-1 text-sm font-semibold text-slate-500">
          {[
            { id: 'archive', label: 'Archive' },
            { id: 'insights', label: 'Highlights' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as 'archive' | 'insights')}
              className={`px-4 py-1.5 rounded-full transition ${
                activeTab === tab.id
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6">
        {activeTab === 'archive' ? (
          <RecordingArchive hierarchy={hierarchy} hasData={recordings.length > 0} />
        ) : (
          <RecordingInsightsPanel insights={insights} hasData={recordings.length > 0} />
        )}
      </div>
    </div>
  );
}

function RecordingArchive({
  hierarchy,
  hasData,
}: {
  hierarchy: RecordingHierarchy;
  hasData: boolean;
}) {
  if (!hasData) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        No vetting recordings have been synced yet. Once sessions are recorded, they will appear
        here grouped by academic year, semester, year of study, and course unit.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {hierarchy.years.map((year) => (
        <div
          key={year.label}
          className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">{year.label}</p>
              <p className="text-xs text-slate-500">{year.totalRecordings} recordings captured</p>
            </div>
            <div className="rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
              Year View
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {year.semesters.map((semester) => (
              <div
                key={semester.label + year.label}
                className="rounded-xl border border-slate-100 bg-slate-50/60 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      {semester.label}
                    </p>
                    <p className="text-xs text-slate-500">
                      Vetting window: {semester.dateRange} • {semester.totalRecordings} recordings
                    </p>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-[0.65rem] font-semibold text-slate-500 border border-slate-200">
                    Semester
                  </span>
                </div>
                <div className="mt-3 space-y-3">
                  {semester.studyYears.map((studyYear) => (
                    <div
                      key={`${semester.label}-${studyYear.label}`}
                      className="rounded-lg border border-white bg-white/90 p-3 shadow-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-800">{studyYear.label}</p>
                        <span className="text-xs text-slate-500">
                          {studyYear.totalRecordings} recordings
                        </span>
                      </div>
                      <div className="mt-3 grid gap-3 lg:grid-cols-2">
                        {studyYear.courses.map((course) => (
                          <div
                            key={`${studyYear.label}-${course.courseUnit}`}
                            className="rounded-xl border border-slate-100 bg-gradient-to-br from-white to-slate-50 p-3 shadow-sm"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-slate-900">
                                  {course.courseUnit}
                                </p>
                                {course.courseCode && (
                                  <p className="text-xs text-slate-500 mt-0.5">
                                    {course.courseCode}
                                  </p>
                                )}
                              </div>
                              <span className="rounded-full bg-slate-900/10 px-2 py-0.5 text-[0.6rem] font-semibold text-slate-700">
                                {course.entries.length} clips
                              </span>
                            </div>
                            <div className="mt-3 space-y-2">
                              {course.entries.map((entry) => (
                                <div
                                  key={entry.recordId}
                                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 bg-white/80 px-3 py-2 text-xs text-slate-600"
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                      <p className="font-semibold text-slate-800">
                                        {formatDate(entry.completedAt || entry.startedAt)}
                                      </p>
                                      {entry.durationMinutes && (
                                        <span className="text-[0.6rem] font-medium text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                                          {entry.durationMinutes} min
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-[0.65rem] text-slate-500">
                                      {entry.vetterSummaries.length > 0 ? (
                                        <>
                                          {entry.vetterSummaries.map((v, idx) => (
                                            <span key={v.vetterId}>
                                              {v.vetterName}
                                              {idx < entry.vetterSummaries.length - 1 && ', '}
                                            </span>
                                          ))}
                                          {' • '}
                                        </>
                                      ) : null}
                                      {entry.annotationsCount} annotation(s)
                                      {entry.vetterSummaries.some(v => v.violations > 0) && (
                                        <span className="ml-2 text-red-600 font-semibold">
                                          ⚠ {entry.vetterSummaries.reduce((sum, v) => sum + v.violations, 0)} violation(s)
                                        </span>
                                      )}
                                    </p>
                                  </div>
                                  {entry.recordingUrl ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (entry.recordingUrl) {
                                          window.open(entry.recordingUrl, '_blank', 'noopener,noreferrer');
                                        }
                                      }}
                                      className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-1.5 text-xs font-semibold text-white shadow-md transition hover:from-blue-700 hover:to-indigo-700 hover:shadow-lg hover:scale-105"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                      </svg>
                                      View Recording
                                    </button>
                                  ) : (
                                    <span className="flex items-center gap-1 text-[0.65rem] font-semibold text-amber-600">
                                      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                      </svg>
                                      Sync pending
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function RecordingInsightsPanel({
  insights,
  hasData,
}: {
  insights: RecordingInsights;
  hasData: boolean;
}) {
  if (!hasData) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        Insights appear after the first recording is uploaded.
      </div>
    );
  }

  const cards = [
    {
      label: 'Total Recordings',
      value: insights.totalRecordings.toString(),
      subtext: 'Stored for auditing',
      accent: 'text-blue-600',
    },
    {
      label: 'Courses Covered',
      value: insights.totalCourses.toString(),
      subtext: 'Unique course units',
      accent: 'text-emerald-600',
    },
    {
      label: 'Busiest Year',
      value: insights.busiestYear || '—',
      subtext: 'Most recordings captured',
      accent: 'text-violet-600',
    },
    {
      label: 'Busiest Semester',
      value: insights.busiestSemester || '—',
      subtext: 'Highest activity window',
      accent: 'text-amber-600',
    },
    {
      label: 'Avg. Duration',
      value: insights.averageDuration || '—',
      subtext: 'Across completed sessions',
      accent: 'text-slate-700',
    },
    {
      label: 'Latest Recording',
      value: insights.latestRecording || '—',
      subtext: 'Most recent upload',
      accent: 'text-rose-600',
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {card.label}
          </p>
          <p className={`mt-2 text-3xl font-bold ${card.accent}`}>{card.value}</p>
          <p className="text-xs text-slate-500 mt-1">{card.subtext}</p>
        </div>
      ))}
    </div>
  );
}

function buildHierarchy(recordings: RecordingEntry[]): RecordingHierarchy {
  const yearMap = new Map<string, {
    total: number;
    semesters: Map<string, {
      total: number;
      timestamps: number[];
      studyYears: Map<string, {
        total: number;
        courses: Map<string, RecordingCourseGroup>;
      }>;
    }>;
  }>();

  recordings.forEach((entry) => {
    const yearLabel = entry.calendarYear || 'Unspecified Year';
    if (!yearMap.has(yearLabel)) {
      yearMap.set(yearLabel, {
        total: 0,
        semesters: new Map(),
      });
    }
    const yearGroup = yearMap.get(yearLabel)!;
    yearGroup.total += 1;

    const semesterLabel = entry.semester || 'Unassigned Semester';
    if (!yearGroup.semesters.has(semesterLabel)) {
      yearGroup.semesters.set(semesterLabel, {
        total: 0,
        timestamps: [],
        studyYears: new Map(),
      });
    }
    const semesterGroup = yearGroup.semesters.get(semesterLabel)!;
    semesterGroup.total += 1;
    const sessionTimestamp = entry.startedAt || entry.completedAt;
    if (sessionTimestamp) {
      semesterGroup.timestamps.push(sessionTimestamp);
    }

    const studyYearLabel = entry.studyYear || 'Unspecified Year';
    if (!semesterGroup.studyYears.has(studyYearLabel)) {
      semesterGroup.studyYears.set(studyYearLabel, {
        total: 0,
        courses: new Map(),
      });
    }
    const studyGroup = semesterGroup.studyYears.get(studyYearLabel)!;
    studyGroup.total += 1;

    if (!studyGroup.courses.has(entry.courseUnit)) {
      studyGroup.courses.set(entry.courseUnit, {
        courseUnit: entry.courseUnit,
        courseCode: entry.courseCode,
        entries: [],
      });
    }
    studyGroup.courses.get(entry.courseUnit)!.entries.push(entry);
  });

  const years: RecordingYearGroup[] = Array.from(yearMap.entries())
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([label, yearData]) => ({
      label,
      totalRecordings: yearData.total,
      semesters: Array.from(yearData.semesters.entries())
        .sort((a, b) => compareSemesters(a[0], b[0]))
        .map(([semesterLabel, semesterData]) => ({
          label: capitalize(semesterLabel),
          totalRecordings: semesterData.total,
          dateRange: formatDateRange(semesterData.timestamps),
          studyYears: Array.from(semesterData.studyYears.entries())
            .sort((a, b) => compareStudyYears(a[0], b[0]))
            .map(([studyLabel, studyData]) => ({
              label: capitalize(studyLabel),
              totalRecordings: studyData.total,
              courses: Array.from(studyData.courses.values()).map((course) => ({
                ...course,
                entries: course.entries.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)),
              })),
            })),
        })),
    }));

  return {
    years,
    totalRecordings: recordings.length,
  };
}

function buildInsights(recordings: RecordingEntry[], hierarchy: RecordingHierarchy): RecordingInsights {
  if (recordings.length === 0) {
    return {
      totalRecordings: 0,
      totalCourses: 0,
    };
  }

  const courseSet = new Set<string>();
  recordings.forEach((entry) => {
    courseSet.add(`${entry.courseCode || 'NO_CODE'}-${entry.courseUnit}`);
  });

  let busiestYear: string | undefined;
  let busiestYearCount = 0;
  hierarchy.years.forEach((year) => {
    if (year.totalRecordings > busiestYearCount) {
      busiestYearCount = year.totalRecordings;
      busiestYear = year.label;
    }
  });

  let busiestSemester: string | undefined;
  let busiestSemesterCount = 0;
  hierarchy.years.forEach((year) => {
    year.semesters.forEach((semester) => {
      if (semester.totalRecordings > busiestSemesterCount) {
        busiestSemesterCount = semester.totalRecordings;
        busiestSemester = `${semester.label} ${year.label}`;
      }
    });
  });

  const durations = recordings
    .map((entry) => entry.durationMinutes)
    .filter((value): value is number => typeof value === 'number' && value > 0);
  const averageDuration =
    durations.length > 0
      ? `${Math.round(durations.reduce((sum, val) => sum + val, 0) / durations.length)} mins`
      : undefined;

  const latestRecordingTimestamp = recordings
    .map((entry) => entry.completedAt || entry.startedAt)
    .filter(Boolean)
    .sort((a, b) => (b || 0) - (a || 0))[0];

  return {
    totalRecordings: recordings.length,
    totalCourses: courseSet.size,
    busiestYear,
    busiestSemester,
    averageDuration,
    latestRecording: latestRecordingTimestamp ? formatDate(latestRecordingTimestamp) : undefined,
  };
}

function compareSemesters(a: string, b: string) {
  const indexA = SEMESTER_ORDER.indexOf(a.toLowerCase());
  const indexB = SEMESTER_ORDER.indexOf(b.toLowerCase());
  const safeA = indexA === -1 ? SEMESTER_ORDER.length : indexA;
  const safeB = indexB === -1 ? SEMESTER_ORDER.length : indexB;
  return safeA - safeB;
}

function compareStudyYears(a: string, b: string) {
  const indexA = STUDY_YEAR_ORDER.indexOf(a.toLowerCase());
  const indexB = STUDY_YEAR_ORDER.indexOf(b.toLowerCase());
  const safeA = indexA === -1 ? STUDY_YEAR_ORDER.length : indexA;
  const safeB = indexB === -1 ? STUDY_YEAR_ORDER.length : indexB;
  if (safeA === safeB) {
    return a.localeCompare(b);
  }
  return safeA - safeB;
}

function formatDateRange(timestamps: number[]) {
  if (timestamps.length === 0) {
    return 'Dates not captured';
  }
  const sorted = [...timestamps].sort((a, b) => a - b);
  const first = new Date(sorted[0]);
  const last = new Date(sorted[sorted.length - 1]);
  if (first.toDateString() === last.toDateString()) {
    return first.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  if (first.getFullYear() === last.getFullYear() && first.getMonth() === last.getMonth()) {
    return `${first.toLocaleDateString('en-GB', { day: 'numeric' })} – ${last.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
  return `${first.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} – ${last.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function formatDate(timestamp?: number) {
  if (!timestamp) return 'Date pending';
  return new Date(timestamp).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function capitalize(value: string) {
  if (!value) return 'Unspecified';
  return value
    .split(' ')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

