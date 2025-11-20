export interface RecordingVetterSummary {
  vetterId: string;
  vetterName: string;
  warnings: number;
  violations: number;
}

export interface RecordingEntry {
  recordId: string;
  paperId: string;
  courseUnit: string;
  courseCode?: string;
  calendarYear: string;
  semester: string;
  studyYear: string;
  startedAt?: number;
  completedAt?: number;
  durationMinutes?: number;
  recordingUrl?: string;
  annotationsCount: number;
  vetterSummaries: RecordingVetterSummary[];
}

