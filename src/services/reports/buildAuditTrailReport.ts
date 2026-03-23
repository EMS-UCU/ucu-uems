import type { AuditTrailReport, ReportFilters } from './reportTypes';
import type { LoadedReportData } from './reportDataService';
import { getProfileDisplay } from './reportDataService';
import { generateReportReference } from './reportReference';

function paperLabel(papers: LoadedReportData['papers'], paperId: string): string {
  const p = papers.find((x) => x.id === paperId);
  if (!p) return paperId.slice(0, 8) + '…';
  return `${p.course_code} — ${p.course_name}`;
}

function isOutsideWorkingHours(iso: string): boolean {
  const d = new Date(iso);
  const h = d.getHours();
  return h < 7 || h > 20;
}

export function buildAuditTrailReport(
  data: LoadedReportData,
  filters: ReportFilters,
  generatedByName: string,
  generatedByRole: string
): AuditTrailReport {
  const ref = generateReportReference('UEMS-AUD');
  const paperIds = new Set(data.papers.map((p) => p.id));
  const userIds = new Set(data.timeline.map((t) => t.actor_id).filter(Boolean) as string[]);

  const rows = data.timeline.map((t) => {
    const actor = getProfileDisplay(data.profiles, t.actor_id);
    let metaStr = '—';
    if (t.metadata != null) {
      metaStr =
        typeof t.metadata === 'string'
          ? t.metadata
          : JSON.stringify(t.metadata).slice(0, 200);
    }
    return {
      eventId: t.id,
      timestamp: t.created_at,
      userName: actor.name,
      role: actor.role,
      actionPerformed: t.action || t.description || '—',
      paperAffected: paperLabel(data.papers, t.exam_paper_id),
      previousState: t.from_status || '—',
      newState: t.to_status || '—',
      ipOrDevice: 'Not recorded (client-side)',
      remarks: t.description || metaStr,
    };
  });

  const anomalies: string[] = [];
  let outsideHours = 0;
  for (const t of data.timeline) {
    if (isOutsideWorkingHours(t.created_at)) outsideHours += 1;
  }
  if (outsideHours > 0) {
    anomalies.push(`${outsideHours} event(s) logged outside typical working hours (07:00–20:00 local).`);
  }
  if (data.timeline.length === 0) {
    anomalies.push('No workflow timeline rows matched the selected filters.');
  }

  return {
    header: {
      reportTitle: 'Audit Trail Report',
      academicYear: filters.academicYear,
      semester: filters.semester,
      generatedAt: new Date().toISOString(),
      generatedByName,
      generatedByRole,
      reportReference: ref,
    },
    filtersApplied: { ...filters },
    rows,
    summary: {
      totalEvents: rows.length,
      totalPapersTracked: paperIds.size,
      totalUsersInvolved: userIds.size,
      flaggedAnomalies: anomalies,
    },
    footer: {
      systemVersion: 'UEMS Web',
      databaseTimestamp: new Date().toISOString(),
      digitalSignatureNote:
        'System-generated export. For formal attestation, attach organisational approval per policy.',
    },
  };
}
