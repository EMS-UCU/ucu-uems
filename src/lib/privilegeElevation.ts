import { supabase } from './supabase';
import type { PrivilegeElevation } from './supabase';
import { createNotification } from './examServices/notificationService';
import { getSuperAdminUserIds } from './auth';

// Elevate a lecturer to Chief Examiner (Super Admin only)
export async function elevateToChiefExaminer(
  lecturerId: string,
  elevatedBy: string,
  assignmentDetails?: {
    category?: 'Undergraduate' | 'Postgraduate';
    faculty?: string;
    department?: string;
    course?: string;
    semester?: string;
    year?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get current user roles and name - using user_profiles instead of users
    const { data: user, error: userError } = await supabase
      .from('user_profiles')
      .select('roles, name')
      .eq('id', lecturerId)
      .single();

    if (userError || !user) {
      return { success: false, error: 'User not found' };
    }
    const targetName = (user as any).name || 'User';

    const currentRoles = user.roles || [];
    if (currentRoles.includes('Chief Examiner')) {
      return { success: false, error: 'User is already a Chief Examiner' };
    }

    // Add Chief Examiner role
    const updatedRoles = [...currentRoles, 'Chief Examiner'];

    // Update user roles - using user_profiles instead of users
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({ roles: updatedRoles })
      .eq('id', lecturerId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    // Record privilege elevation with assignment details in metadata
    let insertPayload: Record<string, unknown> = {
      user_id: lecturerId,
      elevated_by: elevatedBy,
      role_granted: 'Chief Examiner',
      is_active: true,
      metadata: assignmentDetails
        ? {
            category: assignmentDetails.category,
            faculty: assignmentDetails.faculty,
            department: assignmentDetails.department,
            course: assignmentDetails.course,
            semester: assignmentDetails.semester,
            year: assignmentDetails.year,
          }
        : null,
    };
    let { error: insertError } = await supabase
      .from('privilege_elevations')
      .insert(insertPayload);

    // Fallback: if FK constraint on elevated_by fails, retry with elevated_by=null
    const isElevatedByFkError =
      insertError?.message?.includes('privilege_elevations_elevated_by_fkey') ||
      insertError?.message?.includes('foreign key constraint');
    if (insertError && isElevatedByFkError) {
      const retry = await supabase.from('privilege_elevations').insert({
        ...insertPayload,
        elevated_by: null,
      });
      insertError = retry.error;
    }

    // If audit record still fails: role was already assigned (user_profiles update succeeded).
    // Return success so UI shows correct feedback - run fix_privilege_elevations_elevated_by_fk.sql to fix the audit trail.
    if (insertError) {
      console.warn('Privilege elevation audit record failed (role was assigned):', insertError.message);
    }

    // Create notification for the user about their new role
    const metadataText = assignmentDetails
      ? ` for ${assignmentDetails.category} - ${assignmentDetails.faculty}, ${assignmentDetails.department}`
      : '';
    await createNotification({
      user_id: lecturerId,
      title: 'Privilege Elevated',
      message: `You have been assigned the Chief Examiner role${metadataText}. You can now manage exam workflows and assign roles to other lecturers.`,
      type: 'warning',
    });

    // Alert the actor and all Super Admins so every elevation is visible in notifications
    const { data: actorProfile } = await supabase
      .from('user_profiles')
      .select('name')
      .eq('id', elevatedBy)
      .single();
    const actorName = (actorProfile as any)?.name || 'Admin';
    const admins = await getSuperAdminUserIds();
    const seen = new Set<string>();
    for (const admin of admins) {
      if (seen.has(admin.id)) continue;
      seen.add(admin.id);
      const isActor = admin.id === elevatedBy;
      await createNotification({
        user_id: admin.id,
        title: 'Chief Examiner Role Assigned',
        message: isActor
          ? `You elevated ${targetName} to Chief Examiner.`
          : `${actorName} elevated ${targetName} to Chief Examiner.`,
        type: 'warning',
      });
    }
    // Ensure the actor gets a notification even if not in Super Admin list (e.g. Chief Examiner)
    if (!seen.has(elevatedBy)) {
      await createNotification({
        user_id: elevatedBy,
        title: 'Chief Examiner Role Assigned',
        message: `You elevated ${targetName} to Chief Examiner.`,
        type: 'warning',
      });
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Appoint Vetters, Team Leads, or Setters (Chief Examiner only).
// Role is NOT added to user_profiles until the user accepts the consent agreement on next login.
export async function appointRole(
  userId: string,
  role: 'Vetter' | 'Team Lead' | 'Setter',
  appointedBy: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get current user roles and name - using user_profiles instead of users
    const { data: user, error: userError } = await supabase
      .from('user_profiles')
      .select('roles, name')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return { success: false, error: 'User not found' };
    }
    const targetName = (user as any).name || 'User';

    const currentRoles = user.roles || [];
    if (currentRoles.includes(role)) {
      return { success: false, error: `User is already a ${role}` };
    }

    // Do NOT add the role to user_profiles here. User must accept consent on next login first.
    // We only record the assignment in privilege_elevations; role is granted on consent accept.

    // CRITICAL: Delete any existing consent acceptance for this role
    // This ensures that when a role is reassigned, the user must accept the consent again
    // This prevents showing "Accepted" status for newly assigned roles
    // Use a transaction-like approach: delete first, then assign
    const { error: deleteConsentError, count: deleteCount } = await supabase
      .from('role_consent_acceptances')
      .delete({ count: 'exact' })
      .eq('user_id', userId)
      .eq('role', role);
    
    if (deleteConsentError) {
      console.warn(`Warning: Could not delete old consent acceptance for ${role} role (user: ${userId}):`, deleteConsentError);
      // If it's an RLS error, log it specifically
      if (deleteConsentError.code === '42501' || deleteConsentError.message.includes('permission') || deleteConsentError.message.includes('policy')) {
        console.error(`⚠️ RLS POLICY ISSUE: Cannot delete consent acceptance. May need DELETE policy for Chief Examiners.`);
      }
      // Don't fail the assignment if consent deletion fails - log and continue
    } else {
      console.log(`✅ Deleted ${deleteCount || 0} old consent acceptance(s) for ${role} role (user: ${userId}) - user must accept again`);
    }

    // Record privilege elevation (with FK fallback for elevated_by)
    let insertResult = await supabase.from('privilege_elevations').insert({
      user_id: userId,
      elevated_by: appointedBy,
      role_granted: role,
      is_active: true,
    });
    if (insertResult.error) {
      const isElevatedByFk =
        insertResult.error.message?.includes('privilege_elevations_elevated_by_fkey') ||
        insertResult.error.message?.includes('foreign key constraint');
      if (isElevatedByFk) {
        insertResult = await supabase.from('privilege_elevations').insert({
          user_id: userId,
          elevated_by: null,
          role_granted: role,
          is_active: true,
        });
      }
      if (insertResult.error) {
        // Role was already assigned; audit record failed - continue with success
        console.warn('Privilege elevation audit record failed (role was assigned):', insertResult.error.message);
      }
    }

    // Create notification: user must accept consent on next login to receive the role
    const roleMessages: Record<string, string> = {
      'Setter': 'You have been assigned the Setter role. On your next login you will be asked to accept the role agreement; once you accept, you can submit exam drafts within the deadline window.',
      'Vetter': 'You have been assigned the Vetter role. On your next login you will be asked to accept the role agreement; once you accept, you can join vetting sessions to review exam papers.',
      'Team Lead': 'You have been assigned the Team Lead role. On your next login you will be asked to accept the role agreement; once you accept, you can compile and integrate exam drafts from setters.',
    };

    await createNotification({
      user_id: userId,
      title: 'Role assignment – consent required',
      message: roleMessages[role] || `You have been assigned the ${role} role. Please log in and accept the role agreement to activate it.`,
      type: 'warning',
    });

    // Alert the actor and all Super Admins so every elevation is visible in notifications
    const { data: actorProfile } = await supabase
      .from('user_profiles')
      .select('name')
      .eq('id', appointedBy)
      .single();
    const actorName = (actorProfile as any)?.name || 'Admin';
    const admins = await getSuperAdminUserIds();
    const seen = new Set<string>();
    for (const admin of admins) {
      if (seen.has(admin.id)) continue;
      seen.add(admin.id);
      const isActor = admin.id === appointedBy;
      await createNotification({
        user_id: admin.id,
        title: 'Role Assigned',
        message: isActor
          ? `You assigned ${role} to ${targetName}.`
          : `${actorName} assigned ${role} to ${targetName}.`,
        type: 'warning',
      });
    }
    // Ensure the actor gets a notification even if not in Super Admin list (e.g. Chief Examiner)
    if (!seen.has(appointedBy)) {
      await createNotification({
        user_id: appointedBy,
        title: 'Role Assigned',
        message: `You assigned ${role} to ${targetName}.`,
        type: 'warning',
      });
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Revoke a role (revokedBy: actor name from App, or actor id from PrivilegeElevationPanel; revokedById: optional actor id when revokedBy is name)
export async function revokeRole(
  userId: string,
  role: string,
  revokedBy: string,
  revokedById?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get current user roles and name - using user_profiles instead of users
    const { data: user, error: userError } = await supabase
      .from('user_profiles')
      .select('roles, name')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return { success: false, error: 'User not found' };
    }
    const targetName = (user as any).name || 'User';

    const currentRoles = user.roles || [];

    // Remove the role from user_profiles only if it's there (user had accepted). If they declined before accepting, role was never added.
    if (currentRoles.includes(role)) {
      const updatedRoles = currentRoles.filter((r) => r !== role);
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({ roles: updatedRoles })
        .eq('id', userId);

      if (updateError) {
        return { success: false, error: updateError.message };
      }
    }

    // Always mark privilege elevation as inactive (works for both accepted and pending-consent assignments)
    await supabase
      .from('privilege_elevations')
      .update({
        revoked_at: new Date().toISOString(),
        is_active: false,
      })
      .eq('user_id', userId)
      .eq('role_granted', role)
      .eq('is_active', true);

    // Notify the user that their role was revoked (same style as session expired / privilege elevated)
    await createNotification({
      user_id: userId,
      title: 'Privilege Revoked',
      message: `Your ${role} role has been revoked.`,
      type: 'warning',
    });

    // Alert the actor and all Super Admins (revokedBy may be actor id from PrivilegeElevationPanel or actor name from App; revokedById from App when revokedBy is name)
    const looksLikeId = revokedBy.length >= 30 && /^[a-f0-9-]+$/i.test(revokedBy);
    const actorId = revokedById || (looksLikeId ? revokedBy : undefined);
    const { data: actorRow } = actorId
      ? await supabase.from('user_profiles').select('name').eq('id', actorId).single()
      : { data: null };
    const actorName = actorRow ? (actorRow as any).name : revokedBy;
    const admins = await getSuperAdminUserIds();
    const seen = new Set<string>();
    for (const admin of admins) {
      if (seen.has(admin.id)) continue;
      seen.add(admin.id);
      const isActor = admin.id === actorId || (!actorId && admin.name === revokedBy);
      await createNotification({
        user_id: admin.id,
        title: 'Privilege Revoked',
        message: isActor
          ? `You revoked ${role} from ${targetName}.`
          : `${actorName} revoked ${role} from ${targetName}.`,
        type: 'warning',
      });
    }
    // Ensure the actor gets a notification even if not in Super Admin list (e.g. Chief Examiner)
    if (actorId && !seen.has(actorId)) {
      await createNotification({
        user_id: actorId,
        title: 'Privilege Revoked',
        message: `You revoked ${role} from ${targetName}.`,
        type: 'warning',
      });
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Get privilege elevation history for a user
export async function getPrivilegeHistory(userId: string): Promise<PrivilegeElevation[]> {
  try {
    const { data, error } = await supabase
      .from('privilege_elevations')
      .select('*')
      .eq('user_id', userId)
      .order('granted_at', { ascending: false });

    if (error) {
      console.error('Error fetching privilege history:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching privilege history:', error);
    return [];
  }
}


