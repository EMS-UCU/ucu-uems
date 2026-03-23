/** Deterministic-looking reference for exports (not a cryptographic seal). */
export function generateReportReference(prefix: string): string {
  const ts = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${ts}-${rand}`;
}
