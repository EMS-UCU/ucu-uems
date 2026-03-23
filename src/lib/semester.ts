export type UcuSemester = 'Easter' | 'Trinity' | 'Advent';

export const UCU_SEMESTERS: UcuSemester[] = ['Easter', 'Trinity', 'Advent'];

/**
 * UCU liturgical semester mapping:
 * - Easter: Jan-Apr
 * - Trinity: May-Aug
 * - Advent: Sep-Dec
 */
export function getSemesterForDate(date: Date = new Date()): UcuSemester {
  const month = date.getMonth() + 1; // 1-12
  if (month >= 1 && month <= 4) return 'Easter';
  if (month >= 5 && month <= 8) return 'Trinity';
  return 'Advent';
}
