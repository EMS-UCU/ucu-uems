import { supabase } from './supabase';
import type { WorkflowRole } from './roleConsentDocuments';

export type { WorkflowRole };

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
