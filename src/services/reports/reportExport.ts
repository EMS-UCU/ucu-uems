import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { AuditTrailReport, ChiefSignOffReport, ExamPaperStatusReport } from './reportTypes';
import ucuLogoUrl from '../../assets/ucu-logo.png';
import { UCU_SEMESTERS } from '../../lib/semester';

const MARGIN = 14;

function formatDate(value?: string): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function readFilter(filters: Record<string, unknown>, key: string): string {
  const value = filters[key];
  if (value == null) return '—';
  const text = String(value).trim();
  return text.length > 0 ? text : '—';
}

function displaySemester(
  headerSemester: string | undefined,
  filters: Record<string, unknown>
): string {
  const selected = headerSemester || readFilter(filters, 'semester');
  if (selected === '—') {
    return UCU_SEMESTERS.join(', ');
  }
  return selected;
}

function drawMetaBlock(
  doc: jsPDF,
  startY: number,
  rows: Array<[string, string]>,
  opts?: { width?: number; left?: number }
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const left = opts?.left ?? MARGIN;
  const width = opts?.width ?? pageW - MARGIN * 2;
  autoTable(doc, {
    startY,
    head: [],
    body: rows.map(([k, v]) => [k, v || '—']),
    theme: 'grid',
    tableWidth: width,
    margin: { left, right: left },
    styles: { fontSize: 8.8, cellPadding: 1.6, valign: 'middle' },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: width * 0.23, fillColor: [246, 248, 252] },
      1: { cellWidth: width * 0.77 },
    },
  });
  return (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? startY + 14;
}

function imageToDataUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Failed to load logo image'));
    img.src = url;
  });
}

async function addUcuHeader(
  doc: jsPDF,
  title: string,
  subtitleLines: string[]
): Promise<number> {
  const pageW = doc.internal.pageSize.getWidth();
  let logoBottomY = 10;
  try {
    const logoDataUrl = await imageToDataUrl(ucuLogoUrl);
    const logoW = 132;
    const logoH = 38;
    const logoX = (pageW - logoW) / 2;
    const logoY = 7;
    doc.addImage(logoDataUrl, 'PNG', logoX, logoY, logoW, logoH);
    logoBottomY = logoY + logoH;
  } catch {
    // Continue even if logo fails to load.
  }

  doc.setFont('times', 'bold');
  doc.setFontSize(12);
  doc.text('EXAMINATION MANAGEMENT SYSTEM (UEMS)', pageW / 2, logoBottomY + 8, {
    align: 'center',
  });
  doc.setFont('times', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(70, 70, 70);
  doc.text('Official Quality Assurance and Moderation Report', pageW / 2, logoBottomY + 13, {
    align: 'center',
  });
  doc.setTextColor(0);

  doc.setDrawColor(120, 120, 120);
  doc.line(MARGIN, logoBottomY + 16, pageW - MARGIN, logoBottomY + 16);

  doc.setFont('times', 'bold');
  doc.setFontSize(15);
  doc.text(title.toUpperCase(), pageW / 2, logoBottomY + 24, { align: 'center' });

  doc.setFont('times', 'normal');
  doc.setFontSize(9);
  let y = logoBottomY + 30;
  subtitleLines.forEach((l) => {
    doc.text(l, MARGIN, y, { maxWidth: pageW - MARGIN * 2, align: 'left' });
    y += 4;
  });
  return y + 2;
}

function addFooter(doc: jsPDF, note: string) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setDrawColor(180, 180, 180);
  doc.line(MARGIN, pageHeight - 14, pageW - MARGIN, pageHeight - 14);
  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text(note, MARGIN, pageHeight - 10, { maxWidth: pageW - 2 * MARGIN });
  doc.setTextColor(0);
}

function addNoDataBox(doc: jsPDF, y: number, message: string): number {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setDrawColor(200, 200, 200);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(MARGIN, y, pageW - MARGIN * 2, 16, 2, 2, 'FD');
  doc.setFont('times', 'italic');
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(message, MARGIN + 4, y + 9, { maxWidth: pageW - MARGIN * 2 - 8, align: 'left' });
  doc.setTextColor(0);
  doc.setFont('times', 'normal');
  return y + 22;
}

export async function downloadAuditTrailPdf(report: AuditTrailReport): Promise<void> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const h = report.header;
  let y = await addUcuHeader(doc, h.reportTitle, []);

  const filtersMap = report.filtersApplied as Record<string, unknown>;
  y = drawMetaBlock(doc, y, [
    ['Academic Year', h.academicYear || readFilter(filtersMap, 'academicYear')],
    ['Faculty', readFilter(filtersMap, 'faculty')],
    ['Department', readFilter(filtersMap, 'department')],
    ['Semester', displaySemester(h.semester, filtersMap)],
    ['Reference', h.reportReference],
    ['Generated', `${formatDate(h.generatedAt)}`],
    ['Generated By', `${h.generatedByName} (${h.generatedByRole})`],
  ]);
  y += 4;

  y = drawMetaBlock(doc, y, [
    ['Total events', String(report.summary.totalEvents)],
    ['Total papers tracked', String(report.summary.totalPapersTracked)],
    ['Total users involved', String(report.summary.totalUsersInvolved)],
  ]);
  y += 4;
  if (report.summary.flaggedAnomalies.length) {
    doc.setTextColor(180, 80, 0);
    report.summary.flaggedAnomalies.forEach((a) => {
      doc.text(`• ${a}`, MARGIN, y, { maxWidth: pageW - MARGIN * 2, align: 'left' });
      y += 5;
    });
    doc.setTextColor(0);
    y += 3;
  }

  if (report.rows.length === 0) {
    y = addNoDataBox(doc, y, 'No records matched the selected filters.');
  } else {
    autoTable(doc, {
      startY: y,
      head: [
        [
          'Event ID',
          'Timestamp',
          'User',
          'Role',
          'Action Performed',
          'Paper Affected',
          'Previous State',
          'New State',
          'IP/Device',
          'Remarks',
        ],
      ],
      body: report.rows.map((r) => [
        r.eventId.slice(0, 12),
        formatDate(r.timestamp),
        r.userName,
        r.role,
        r.actionPerformed.slice(0, 40),
        r.paperAffected.slice(0, 35),
        r.previousState.slice(0, 18),
        r.newState.slice(0, 18),
        r.ipOrDevice.slice(0, 24),
        r.remarks.slice(0, 58),
      ]),
      styles: { fontSize: 7.3, cellPadding: 1.5, overflow: 'linebreak' },
      headStyles: { fillColor: [30, 94, 220], textColor: 255, fontStyle: 'bold' },
      bodyStyles: { textColor: [20, 20, 20] },
      alternateRowStyles: { fillColor: [247, 249, 252] },
      tableWidth: pageW - MARGIN * 2,
      margin: { left: MARGIN, right: MARGIN },
    });
  }

  addFooter(
    doc,
    `${report.footer.systemVersion} | Database Timestamp: ${formatDate(
      report.footer.databaseTimestamp
    )} | ${report.footer.digitalSignatureNote}`
  );

  doc.save(`Audit-Trail-${h.reportReference}.pdf`);
}

export async function downloadExamStatusPdf(report: ExamPaperStatusReport): Promise<void> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const h = report.header;
  let y = await addUcuHeader(doc, h.reportTitle, []);
  const filtersMap = report.filtersApplied as Record<string, unknown>;
  y = drawMetaBlock(doc, y, [
    ['Academic Year', h.academicYear || readFilter(filtersMap, 'academicYear')],
    ['Faculty', readFilter(filtersMap, 'faculty')],
    ['Department', readFilter(filtersMap, 'department')],
    ['Semester', displaySemester(h.semester, filtersMap)],
    ['Reference', h.reportReference],
    ['Generated', formatDate(h.generatedAt)],
    ['Generated By', `${h.generatedByName} (${h.generatedByRole})`],
  ]);
  y += 4;
  y = drawMetaBlock(doc, y, [
    ['Total papers expected', String(report.summaryDashboard.totalExpected)],
    ['Total submitted', String(report.summaryDashboard.totalSubmitted)],
    ['Under moderation', String(report.summaryDashboard.underModeration)],
    ['Approved & ready', String(report.summaryDashboard.approvedReady)],
    ['Returned for revision', String(report.summaryDashboard.returnedRevision)],
    ['Total overdue', String(report.summaryDashboard.totalOverdue)],
  ]);
  y += 4;
  doc.setFont('times', 'normal');
  doc.setFontSize(9);
  doc.text(
    'Stage breakdown: ' + report.stageBreakdown.map((s) => `${s.stage}=${s.count}`).join(' | '),
    MARGIN,
    y,
    { maxWidth: pageW - MARGIN * 2, align: 'left' }
  );
  y += 8;

  if (report.rows.length === 0) {
    y = addNoDataBox(doc, y, 'No exam papers matched the selected filters.');
  } else {
    autoTable(doc, {
      startY: y,
      head: [
        [
          'Paper ID',
          'Course Code',
          'Course Unit',
          'Department',
          'Setter',
          'Date Submitted',
          'Current Stage',
          'Current Owner',
          'Last Action',
          'Days in System',
          'Status Flag',
        ],
      ],
      body: report.rows.map((r) => [
        r.paperId.slice(0, 10),
        r.courseCode,
        r.courseName.slice(0, 30),
        r.department.slice(0, 18),
        r.setterName.slice(0, 18),
        formatDate(r.dateSubmitted).split(',')[0],
        r.currentStage.slice(0, 24),
        r.currentOwner.slice(0, 18),
        r.lastAction.slice(0, 28),
        String(r.daysInSystem),
        r.statusFlag,
      ]),
      styles: { fontSize: 7.4, cellPadding: 1.5 },
      headStyles: { fillColor: [9, 160, 122], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [247, 249, 252] },
      tableWidth: pageW - MARGIN * 2,
      margin: { left: MARGIN, right: MARGIN },
    });
  }

  addFooter(doc, report.footer.confidentialityNotice || '');
  doc.save(`Exam-Paper-Status-${h.reportReference}.pdf`);
}

export async function downloadChiefSignOffPdf(report: ChiefSignOffReport): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const h = report.header;
  let y = await addUcuHeader(doc, h.reportTitle, []);
  y = drawMetaBlock(doc, y, [
    ['Reference', h.reportReference],
    ['Faculty', h.facultyName || '—'],
    ['Academic Year', h.academicYear || '—'],
    ['Semester', displaySemester(h.semester, report.filtersApplied as Record<string, unknown>)],
    ['Examination period', h.examinationPeriod || '—'],
    ['Generated', formatDate(h.generatedAt)],
    ['Generated By', `${h.generatedByName} (${h.generatedByRole})`],
  ]);

  y += 5;
  doc.setFont('times', 'normal');
  doc.setFontSize(10);
  const certLines = doc.splitTextToSize(report.certificationStatement, pageW - 2 * MARGIN);
  doc.text(certLines, MARGIN, y, { maxWidth: pageW - 2 * MARGIN, align: 'justify' });
  y += certLines.length * 5 + 8;

  if (report.approvedPapers.length === 0) {
    y = addNoDataBox(doc, y, 'No approved papers matched the selected filters.');
  } else {
    autoTable(doc, {
      startY: y,
      head: [['Paper', 'Code', 'Course Unit', 'Dept', 'Setter', 'Submitted', 'Revs', 'Approved', 'Approved For', 'Level']],
      body: report.approvedPapers.map((r) => [
        r.paperId.slice(0, 10),
        r.courseCode,
        r.courseName.slice(0, 22),
        r.department.slice(0, 12),
        r.setterName.slice(0, 14),
        formatDate(r.dateFirstSubmitted).split(',')[0],
        String(r.revisionCount),
        formatDate(r.dateFinalApproval).split(',')[0],
        r.approvedFor,
        r.confidentialityLevel.slice(0, 18),
      ]),
      styles: { fontSize: 7.3, cellPadding: 1.4 },
      headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 248, 255] },
    });
  }

  let fy = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 50;
  if (report.rejectedOrDeferred.length) {
    fy += 8;
    doc.setFontSize(11);
    doc.text('Rejected / deferred', MARGIN, fy);
    fy += 6;
    autoTable(doc, {
      startY: fy,
      head: [['Paper', 'Code', 'Course', 'Reason', 'Action', 'Officer']],
      body: report.rejectedOrDeferred.map((r) => [
        r.paperId.slice(0, 10),
        r.courseCode,
        r.courseName.slice(0, 22),
        r.reason.slice(0, 35),
        r.recommendedAction.slice(0, 30),
        r.responsibleOfficer.slice(0, 18),
      ]),
      styles: { fontSize: 7 },
    });
  }

  fy = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? fy + 40;
  fy += 10;
  doc.setFontSize(10);
  doc.text(
    `Stats — Approved: ${report.statistics.totalApproved} | Deferred: ${report.statistics.totalDeferred} | Avg turnaround (days): ${report.statistics.avgTurnaroundDays ?? '—'} | Fastest: ${report.statistics.fastestDays ?? '—'} | Slowest: ${report.statistics.slowestDays ?? '—'}`,
    MARGIN,
    fy
  );
  fy += 10;
  doc.text(`Chief Examiner: ${report.signOffBlock.chiefExaminer} | QA: ${report.signOffBlock.qaOfficer} | Dean/HoD: ${report.signOffBlock.deanOrHod}`, MARGIN, fy);

  addFooter(doc, report.footer.confidentialityNotice || '');
  doc.save(`Chief-Examiner-Sign-off-${h.reportReference}.pdf`);
}

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function downloadCsv(filename: string, headers: string[], rows: string[][]) {
  const lines = [headers.map(csvEscape).join(',')];
  rows.forEach((r) => lines.push(r.map((c) => csvEscape(String(c))).join(',')));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
