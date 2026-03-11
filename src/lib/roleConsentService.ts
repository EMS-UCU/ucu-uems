import { supabase } from './supabase';
import type { WorkflowRole } from './roleConsentDocuments';

export type { WorkflowRole };

/** Workflow roles that are assigned via privilege_elevations and require consent. */
const WORKFLOW_ELEVATION_ROLES: WorkflowRole[] = ['Team Lead', 'Vetter', 'Setter'];

/** Returns workflow roles that are still pending consent via privilege_elevations (active). */
export async function getAssignedWorkflowRoles(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('privilege_elevations')
    .select('role_granted, metadata')
    .eq('user_id', userId)
    .eq('is_active', true)
    .in('role_granted', WORKFLOW_ELEVATION_ROLES);

  if (error) {
    console.error('Error fetching assigned workflow roles:', error);
    return [];
  }

  const roles = (data || [])
    .filter((row: { role_granted: string; metadata?: Record<string, unknown> | null }) => {
      const metadata = row.metadata || {};
      const consentStatus =
        typeof metadata.consent_status === 'string' ? metadata.consent_status : '';
      return consentStatus !== 'accepted';
    })
    .map((r: { role_granted: string }) => r.role_granted);
  return [...new Set(roles)];
}

export async function getAcceptedRoles(userId: string): Promise<Set<WorkflowRole>> {
  const { data, error } = await supabase
    .from('role_consent_acceptances')
    .select('role')
    .eq('user_id', userId);

  if (error) {
    console.error('Error fetching role consents:', error);
    return new Set();
  }

  return new Set((data || []).map((r: { role: string }) => r.role as WorkflowRole));
}

export async function recordConsentAcceptance(
  userId: string,
  role: WorkflowRole
): Promise<{ success: boolean; error?: string }> {
  console.log('💾 Recording consent acceptance:', { userId, role });
  
  const acceptanceData = {
    user_id: userId,
    role,
    accepted_at: new Date().toISOString(),
  };
  
  console.log('📤 Upserting acceptance data:', acceptanceData);
  
  // Try upsert first
  const { data, error } = await supabase
    .from('role_consent_acceptances')
    .upsert(acceptanceData, { 
      onConflict: 'user_id,role',
      ignoreDuplicates: false // Update existing records
    })
    .select();

  if (error) {
    console.error('❌ Error with upsert, trying insert:', {
      error: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
      userId,
      role
    });
    
    // Fallback: Try insert (in case upsert fails due to RLS)
    const { data: insertData, error: insertError } = await supabase
      .from('role_consent_acceptances')
      .insert(acceptanceData)
      .select();
    
    if (insertError) {
      // If insert also fails, try update (record might already exist)
      console.log('⚠️ Insert failed, trying update:', insertError.message);
      const { error: updateError } = await supabase
        .from('role_consent_acceptances')
        .update({ accepted_at: acceptanceData.accepted_at })
        .eq('user_id', userId)
        .eq('role', role);
      
      if (updateError) {
        console.error('❌ All methods failed:', {
          upsert: error.message,
          insert: insertError.message,
          update: updateError.message
        });
        return { success: false, error: `Failed to record: ${error.message}` };
      }
      
      console.log('✅ Updated existing acceptance record');
      return { success: true };
    }
    
    console.log('✅ Inserted new acceptance record:', insertData);
    return { success: true };
  }
  
  console.log('✅ Consent acceptance recorded successfully via upsert:', data);
  return { success: true };
}

export async function activateRoleAfterConsent(
  userId: string,
  role: WorkflowRole
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('roles')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      return { success: false, error: profileError?.message || 'User profile not found' };
    }

    const currentRoles = normalizeRoles((profile as { roles: unknown }).roles);
    const updatedRoles = currentRoles.includes(role) ? currentRoles : [...currentRoles, role];

    const { error: updateRolesError } = await supabase
      .from('user_profiles')
      .update({ roles: updatedRoles })
      .eq('id', userId);

    if (updateRolesError) {
      return { success: false, error: updateRolesError.message };
    }

    const activePayload = {
      consent_status: 'accepted',
      consented_at: new Date().toISOString(),
    };

    const { error: updateElevationError } = await supabase
      .from('privilege_elevations')
      .update({
        metadata: activePayload,
      })
      .eq('user_id', userId)
      .eq('role_granted', role)
      .eq('is_active', true);

    if (updateElevationError) {
      console.warn('Could not update elevation consent metadata:', updateElevationError.message);
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Failed to activate role after consent' };
  }
}

export async function declinePendingWorkflowRoles(
  userId: string,
  roles: WorkflowRole[]
): Promise<{ success: boolean; error?: string }> {
  try {
    if (roles.length === 0) return { success: true };

    const declinedAt = new Date().toISOString();

    const { error: deactivateError } = await supabase
      .from('privilege_elevations')
      .update({
        is_active: false,
        revoked_at: declinedAt,
        metadata: { consent_status: 'declined', declined_at: declinedAt },
      })
      .eq('user_id', userId)
      .eq('is_active', true)
      .in('role_granted', roles);

    if (deactivateError) {
      return { success: false, error: deactivateError.message };
    }

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('roles')
      .eq('id', userId)
      .single();

    if (!profileError && profile) {
      const currentRoles = normalizeRoles((profile as { roles: unknown }).roles);
      const sanitizedRoles = currentRoles.filter((r) => !roles.includes(r as WorkflowRole));
      const { error: roleCleanupError } = await supabase
        .from('user_profiles')
        .update({ roles: sanitizedRoles })
        .eq('id', userId);

      if (roleCleanupError) {
        console.warn('Could not clean up declined roles from profile:', roleCleanupError.message);
      }
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Failed to decline pending roles' };
  }
}

/** Returns roles the user has that require consent and have not yet been accepted */
export function getRolesNeedingConsent(
  userRoles: string[],
  acceptedRoles: Set<WorkflowRole>
): WorkflowRole[] {
  const workflowRoles: WorkflowRole[] = ['Chief Examiner', 'Team Lead', 'Vetter', 'Setter'];
  return workflowRoles.filter(
    (role) => userRoles.includes(role) && !acceptedRoles.has(role)
  );
}

/** Normalize roles from DB - handles PostgreSQL array, JSON array, or string */
function normalizeRoles(roles: unknown): string[] {
  if (Array.isArray(roles)) return roles.map((r) => String(r));
  if (typeof roles === 'string') {
    try {
      const parsed = JSON.parse(roles);
      return Array.isArray(parsed) ? parsed.map((r) => String(r)) : [String(roles)];
    } catch {
      return roles ? [String(roles)] : [];
    }
  }
  return [];
}

/** Fetch the current user's roles directly from user_profiles (avoids stale data from app state) */
export async function getCurrentUserRoles(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('roles')
    .eq('id', userId)
    .single();

  if (error || !data) {
    console.error('Error fetching user roles for consent check:', error);
    return [];
  }

  return normalizeRoles(data.roles);
}
