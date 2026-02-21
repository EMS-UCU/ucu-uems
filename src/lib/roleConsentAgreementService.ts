import { supabase } from './supabase';
import type { WorkflowRole } from './roleConsentDocuments';

export interface RoleConsentAgreement {
  id: string;
  role: WorkflowRole;
  title: string;
  agreement_summary: string;
  full_agreement: string;
  version: string;
  effective_date: string;
  created_at: string;
  updated_at: string;
}

/** Normalize DB row to RoleConsentAgreement (Supabase may return snake_case or camelCase). */
function normalizeAgreementRow(row: Record<string, unknown>): RoleConsentAgreement {
  const r = row as Record<string, unknown> & { agreementSummary?: string; fullAgreement?: string; effectiveDate?: string; createdAt?: string; updatedAt?: string };
  return {
    id: String(r.id ?? ''),
    role: (r.role ?? '') as WorkflowRole,
    title: String(r.title ?? ''),
    agreement_summary: String(r.agreement_summary ?? r.agreementSummary ?? ''),
    full_agreement: String(r.full_agreement ?? r.fullAgreement ?? ''),
    version: String(r.version ?? '1.0'),
    effective_date: String(r.effective_date ?? r.effectiveDate ?? ''),
    created_at: String(r.created_at ?? r.createdAt ?? ''),
    updated_at: String(r.updated_at ?? r.updatedAt ?? ''),
  };
}

/**
 * Get all role consent agreements from the database
 * Similar to how notifications are fetched
 */
export async function getRoleConsentAgreements(): Promise<RoleConsentAgreement[]> {
  try {
    const { data, error } = await supabase
      .from('role_consent_agreements')
      .select('*')
      .order('role', { ascending: true });

    if (error) {
      console.error('Error fetching role consent agreements:', error);
      return [];
    }

    return (data || []).map((row: Record<string, unknown>) => normalizeAgreementRow(row));
  } catch (error) {
    console.error('Error fetching role consent agreements:', error);
    return [];
  }
}

/**
 * Get a specific role consent agreement by role
 */
export async function getRoleConsentAgreement(
  role: WorkflowRole
): Promise<RoleConsentAgreement | null> {
  try {
    const { data, error } = await supabase
      .from('role_consent_agreements')
      .select('*')
      .eq('role', role)
      .single();

    if (error || !data) {
      if (error) console.error(`Error fetching ${role} consent agreement:`, error);
      return null;
    }

    const agreement = normalizeAgreementRow(data as Record<string, unknown>);
    return agreement.role ? agreement : null;
  } catch (err) {
    console.error(`Error fetching ${role} consent agreement:`, err);
    return null;
  }
}

/**
 * Get role consent agreements for multiple roles
 */
export async function getRoleConsentAgreementsForRoles(
  roles: WorkflowRole[]
): Promise<Map<WorkflowRole, RoleConsentAgreement>> {
  try {
    const { data, error } = await supabase
      .from('role_consent_agreements')
      .select('*')
      .in('role', roles);

    if (error) {
      console.error('Error fetching role consent agreements:', error);
      return new Map();
    }

    const agreementsMap = new Map<WorkflowRole, RoleConsentAgreement>();
    (data || []).forEach((row: Record<string, unknown>) => {
      const agreement = normalizeAgreementRow(row);
      if (agreement.role) agreementsMap.set(agreement.role, agreement);
    });

    return agreementsMap;
  } catch (error) {
    console.error('Error fetching role consent agreements:', error);
    return new Map();
  }
}
