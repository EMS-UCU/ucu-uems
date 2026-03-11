import { supabase } from './supabase';
import type { PrivilegeElevation } from './supabase';
import { createNotification } from './examServices/notificationService';
import { getSuperAdminUserIds } from './auth';

/** One person can only hold one of these roles at a time (Chief Examiner, Team Lead, Vetter, Setter). */
const OPERATIONAL_ROLES = ['Chief Examiner', 'Team Lead', 'Vetter', 'Setter'] as const;

function hasAnyOperationalRole(roles: string[]): boolean {
  return roles.some((r) => OPERATIONAL_ROLES.includes(r as any));
}

function getExistingOperationalRole(roles: string[]): string | null {
  const found = roles.find((r) => OPERATIONAL_ROLES.includes(r as any));
  return found ?? null;
}

function isConstraintError(message?: string, constraint?: string): boolean {
  if (!message || !constraint) return false;
  return message.includes(constraint) || message.includes('foreign key constraint');
}

async function upsertPrivilegeElevationByUserId(
  payload: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  if (typeof payload.user_id !== 'string') {
    return { success: false, error: 'Missing user_id for upsert fallback' };
  }

  const userId = payload.user_id;
  const updatePayload: Record<string, unknown> = {
    elevated_by: typeof payload.elevated_by === 'string' ? payload.elevated_by : null,
    role_granted: payload.role_granted,
    is_active: true,
    revoked_at: null,
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : null,
  };

  let { error: updateByIdError } = await supabase
    .from('privilege_elevations')
    .update(updatePayload)
    .eq('id', userId);

  if (!updateByIdError) return { success: true };
  if (isConstraintError(updateByIdError.message, 'privilege_elevations_elevated_by_fkey')) {
    ({ error: updateByIdError } = await supabase
      .from('privilege_elevations')
      .update({ ...updatePayload, elevated_by: null })
      .eq('id', userId));
    if (!updateByIdError) return { success: true };
  }

  let { error: updateByUserError } = await supabase
    .from('privilege_elevations')
    .update(updatePayload)
    .eq('user_id', userId);

  if (updateByUserError && isConstraintError(updateByUserError.message, 'privilege_elevations_elevated_by_fkey')) {
    ({ error: updateByUserError } = await supabase
      .from('privilege_elevations')
      .update({ ...updatePayload, elevated_by: null })
      .eq('user_id', userId));
  }

  if (!updateByUserError) return { success: true };

  return { success: false, error: updateByUserError.message };
}

async function insertPrivilegeElevationWithFallback(
  payload: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  let insertResult = await supabase.from('privilege_elevations').insert(payload);

  if (!insertResult.error) return { success: true };

  const initialMessage = insertResult.error.message || '';

  // Existing fallback for elevated_by FK issues.
  if (isConstraintError(initialMessage, 'privilege_elevations_elevated_by_fkey')) {
    insertResult = await supabase
      .from('privilege_elevations')
      .insert({ ...payload, elevated_by: null });
    if (!insertResult.error) return { success: true };
  }

  const nextMessage = insertResult.error?.message || initialMessage;

  // Some DBs have id FK to user_profiles/auth.users. Retry with id=user_id.
  if (
    isConstraintError(nextMessage, 'privilege_elevations_id_fkey') &&
    typeof payload.user_id === 'string'
  ) {
    insertResult = await supabase
      .from('privilege_elevations')
      .insert({ ...payload, id: payload.user_id });
    if (!insertResult.error) return { success: true };

    // Combine both fallbacks if both constraints are present.
    if (isConstraintError(insertResult.error?.message || '', 'privilege_elevations_elevated_by_fkey')) {
      insertResult = await supabase
        .from('privilege_elevations')
        .insert({ ...payload, id: payload.user_id, elevated_by: null });
      if (!insertResult.error) return { success: true };
    }
  }

  // Some deployments model privilege_elevations as one-row-per-user.
  // If PK conflicts, reuse that row as the active assignment record.
  if (isConstraintError(nextMessage, 'privilege_elevations_pkey')) {
    return upsertPrivilegeElevationByUserId(payload);
  }

  return { success: false, error: insertResult.error?.message || 'Failed to insert privilege elevation' };
}

// Elevate a lecturer to Chief Examiner (Super Admin only)
export async function elevateToChiefExaminer(
  lecturerId: string,
  elevatedBy: string,
  assignmentDetails?: {
    category?: 'Undergraduate' | 'Postgraduate';
    faculty?: string;
    department?: string;
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
    const existing = getExistingOperationalRole(currentRoles);
    if (existing) {
      return {
        success: false,
        error: `This person already has the ${existing} role. A user can only hold one operational role (Chief Examiner, Team Lead, Vetter, or Setter) at a time.`,
      };
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
    const insertPayload: Record<string, unknown> = {
      user_id: lecturerId,
      elevated_by: elevatedBy,
      role_granted: 'Chief Examiner',
      is_active: true,
      metadata: assignmentDetails
        ? {
            category: assignmentDetails.category,
            faculty: assignmentDetails.faculty,
            department: assignmentDetails.department,
            semester: assignmentDetails.semester,
            year: assignmentDetails.year,
          }
        : null,
    };
    const insertAudit = await insertPrivilegeElevationWithFallback(insertPayload);
    if (!insertAudit.success) {
      console.warn(
        'Privilege elevation audit record failed (role was assigned):',
        insertAudit.error
      );
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

// Appoint Vetters, Team Leads, or Setters (Chief Examiner only)
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
    const existing = getExistingOperationalRole(currentRoles);
    if (existing) {
      return {
        success: false,
        error: `This person already has the ${existing} role. A user can only hold one operational role (Chief Examiner, Team Lead, Vetter, or Setter) at a time.`,
      };
    }

    // Block duplicate pending assignment for the same role.
    const { data: existingAssignments, error: existingAssignmentsError } = await supabase
      .from('privilege_elevations')
      .select('id, role_granted, is_active')
      .eq('user_id', userId)
      .eq('is_active', true)
      .in('role_granted', OPERATIONAL_ROLES as unknown as string[]);

    if (existingAssignmentsError) {
      return { success: false, error: existingAssignmentsError.message };
    }

    if ((existingAssignments || []).some((entry: any) => entry.role_granted === role)) {
      return { success: false, error: `A pending or active ${role} assignment already exists for this user.` };
    }
    const existingPendingOperational = (existingAssignments || []).find(
      (entry: any) => entry.role_granted !== role
    );
    if (existingPendingOperational) {
      return {
        success: false,
        error: `This person already has an active or pending ${existingPendingOperational.role_granted} assignment.`,
      };
    }

    // Record privilege elevation (with FK fallback for elevated_by)
    const insertPayload: Record<string, unknown> = {
      user_id: userId,
      elevated_by: appointedBy,
      role_granted: role,
      is_active: true,
      metadata: {
        consent_status: 'pending',
        assigned_at: new Date().toISOString(),
      },
    };
    const insertResult = await insertPrivilegeElevationWithFallback(insertPayload);
    if (!insertResult.success) {
      return { success: false, error: insertResult.error };
    }

    // Reset previous acceptance for this role so reassignment starts as pending.
    const { error: resetConsentError } = await supabase
      .from('role_consent_acceptances')
      .delete()
      .eq('user_id', userId)
      .eq('role', role);
    if (resetConsentError) {
      console.warn('Could not reset previous role consent record:', resetConsentError.message);
    }

    // Create notification for the user about pending consent
    const roleMessages: Record<string, string> = {
      Setter: 'You have been selected for the Setter role. Please review and accept the consent form to activate this role.',
      Vetter: 'You have been selected for the Vetter role. Please review and accept the consent form to activate this role.',
      'Team Lead': 'You have been selected for the Team Lead role. Please review and accept the consent form to activate this role.',
    };

    await createNotification({
      user_id: userId,
      title: 'Role Assignment Pending Consent',
      message: roleMessages[role] || `You have been assigned the ${role} role.`,
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
    const hadRoleInProfile = currentRoles.includes(role);

    // Remove the role from profile only if it exists there.
    if (hadRoleInProfile) {
      const updatedRoles = currentRoles.filter((r) => r !== role);
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({ roles: updatedRoles })
        .eq('id', userId);

      if (updateError) {
        return { success: false, error: updateError.message };
      }
    }

    // Mark privilege elevation as inactive
    const { error: deactivateError } = await supabase
      .from('privilege_elevations')
      .update({
        revoked_at: new Date().toISOString(),
        is_active: false,
        metadata: { consent_status: 'declined', declined_at: new Date().toISOString() },
      })
      .eq('user_id', userId)
      .eq('role_granted', role)
      .eq('is_active', true);

    if (deactivateError) {
      return { success: false, error: deactivateError.message };
    }

    // Notify the user that their role was revoked (same style as session expired / privilege elevated)
    await createNotification({
      user_id: userId,
      title: 'Privilege Revoked',
      message: hadRoleInProfile
        ? `Your ${role} role has been revoked.`
        : `Your pending ${role} assignment was cancelled.`,
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


