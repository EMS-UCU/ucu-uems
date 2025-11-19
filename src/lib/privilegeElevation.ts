import { supabase } from './supabase';
import type { PrivilegeElevation } from './supabase';
import { createNotification } from './examServices/notificationService';

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
    // Get current user roles - using user_profiles instead of users
    const { data: user, error: userError } = await supabase
      .from('user_profiles')
      .select('roles')
      .eq('id', lecturerId)
      .single();

    if (userError || !user) {
      return { success: false, error: 'User not found' };
    }

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
    const { error: insertError } = await supabase
      .from('privilege_elevations')
      .insert({
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
      });

    if (insertError) {
      return { success: false, error: insertError.message };
    }

    // Create notification for the user about their new role
    const metadataText = assignmentDetails
      ? ` for ${assignmentDetails.category} - ${assignmentDetails.faculty}, ${assignmentDetails.department}`
      : '';
    await createNotification({
      user_id: lecturerId,
      title: 'Chief Examiner Role Assigned',
      message: `You have been assigned the Chief Examiner role${metadataText}. You can now manage exam workflows and assign roles to other lecturers.`,
      type: 'success',
    });

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
    // Get current user roles - using user_profiles instead of users
    const { data: user, error: userError } = await supabase
      .from('user_profiles')
      .select('roles')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return { success: false, error: 'User not found' };
    }

    const currentRoles = user.roles || [];
    if (currentRoles.includes(role)) {
      return { success: false, error: `User is already a ${role}` };
    }

    // Add the role
    const updatedRoles = [...currentRoles, role];

    // Update user roles - using user_profiles instead of users
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({ roles: updatedRoles })
      .eq('id', userId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    // Record privilege elevation
    await supabase
      .from('privilege_elevations')
      .insert({
        user_id: userId,
        elevated_by: appointedBy,
        role_granted: role,
        is_active: true,
      });

    // Create notification for the user about their new role
    const roleMessages: Record<string, string> = {
      'Setter': 'You have been assigned the Setter role. You can now submit exam drafts within the deadline window.',
      'Vetter': 'You have been assigned the Vetter role. You can now join vetting sessions to review exam papers.',
      'Team Lead': 'You have been assigned the Team Lead role. You can now compile and integrate exam drafts from setters.',
    };

    await createNotification({
      user_id: userId,
      title: `${role} Role Assigned`,
      message: roleMessages[role] || `You have been assigned the ${role} role.`,
      type: 'success',
    });

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Revoke a role
export async function revokeRole(
  userId: string,
  role: string,
  revokedBy: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get current user roles - using user_profiles instead of users
    const { data: user, error: userError } = await supabase
      .from('user_profiles')
      .select('roles')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return { success: false, error: 'User not found' };
    }

    const currentRoles = user.roles || [];
    if (!currentRoles.includes(role)) {
      return { success: false, error: `User is not a ${role}` };
    }

    // Remove the role (but keep base role)
    const updatedRoles = currentRoles.filter((r) => r !== role);

    // Update user roles - using user_profiles instead of users
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({ roles: updatedRoles })
      .eq('id', userId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    // Mark privilege elevation as inactive
    await supabase
      .from('privilege_elevations')
      .update({
        revoked_at: new Date().toISOString(),
        is_active: false,
      })
      .eq('user_id', userId)
      .eq('role_granted', role)
      .eq('is_active', true);

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


