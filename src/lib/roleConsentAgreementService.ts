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

    return (data || []) as RoleConsentAgreement[];
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

    if (error) {
      console.error(`Error fetching ${role} consent agreement:`, error);
      return null;
    }

    return data as RoleConsentAgreement;
  } catch (error) {
    console.error(`Error fetching ${role} consent agreement:`, error);
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
    (data || []).forEach((agreement) => {
      agreementsMap.set(agreement.role as WorkflowRole, agreement as RoleConsentAgreement);
    });

    return agreementsMap;
  } catch (error) {
    console.error('Error fetching role consent agreements:', error);
    return new Map();
  }
}
