export const ACADEMIC_STRUCTURE = {
  'Faculty of Engineering, Design and Technology': [
    'Department of Computing and Technology',
    'Department of Civil and Environmental Engineering',
  ],
  'Faculty of Nursing and Midwifery': [
    'Department of Nursing',
    'Department of Midwifery',
  ],
} as const;

export type AcademicFaculty = keyof typeof ACADEMIC_STRUCTURE;

function normalizeDepartment(value: string): string {
  return value
    .toLowerCase()
    .replace(/^department\s+of\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getFacultyForDepartment(department?: string | null): AcademicFaculty | undefined {
  if (!department) return undefined;
  const dep = normalizeDepartment(department);
  const faculties = Object.keys(ACADEMIC_STRUCTURE) as AcademicFaculty[];
  for (const faculty of faculties) {
    const deps = ACADEMIC_STRUCTURE[faculty];
    if (deps.some((d) => normalizeDepartment(d) === dep)) {
      return faculty;
    }
  }
  return undefined;
}
