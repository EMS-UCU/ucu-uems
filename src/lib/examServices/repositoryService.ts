/**
 * Repository Service
 * Manages approved papers repository, unlock operations, and password generation
 */

import { supabase } from '../supabase';
import type { ExamPaper } from '../supabase';
import { generatePasswordWithHash } from './passwordService';
import { createNotification } from './notificationService';
import { verifyPassword } from './passwordService';

export interface ApprovedPaper extends ExamPaper {
  printing_due_date?: string;
  printing_due_time?: string;
  is_locked?: boolean;
  unlock_password_hash?: string;
  password_generated_at?: string;
  unlocked_at?: string;
  unlocked_by?: string;
  unlock_expires_at?: string;
}

const parseDueDateTimeLocal = (dateValue?: string | null, timeValue?: string | null): Date | null => {
  if (!dateValue || !timeValue) return null;
  const normalizedDate = String(dateValue).trim().slice(0, 10);
  const normalizedTime = String(timeValue).trim().slice(0, 5);
  const [year, month, day] = normalizedDate.split('-').map((v) => Number(v));
  const [hours, minutes] = normalizedTime.split(':').map((v) => Number(v));
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes)
  ) {
    return null;
  }
  return new Date(year, Math.max(0, month - 1), day, hours, minutes, 0, 0);
};

/**
 * Get all approved papers from repository
 */
export async function getApprovedPapersRepository(): Promise<ApprovedPaper[]> {
  try {
    console.log('📥 Fetching approved papers from repository...');
    
    // First, let's check all papers to see what statuses exist
    const { data: allPapers, error: allError } = await supabase
      .from('exam_papers')
      .select('id, status, approval_status, course_code, course_name, is_locked')
      .order('created_at', { ascending: false })
      .limit(10);
    
    console.log('📊 All papers (first 10):', allPapers);
    console.log('📊 Statuses found:', allPapers?.map(p => ({ id: p.id, status: p.status, is_locked: p.is_locked })));
    
    // Now fetch approved/locked papers.
    // Primary filter: approval_status = 'approved_for_printing'.
    // Backwards compatibility: also include any papers where the legacy
    // workflow `status` is 'approved_for_printing'.
    // Extra safety: also include any papers where is_locked = true, in case
    // approval_status didn't update correctly due to RLS or other issues.
    const { data, error } = await supabase
      .from('exam_papers')
      .select('*')
      .or('approval_status.eq.approved_for_printing,status.eq.approved_for_printing,is_locked.eq.true')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Error fetching approved papers:', {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
      return [];
    }

    console.log('✅ Approved papers query result (raw):', {
      count: data?.length || 0,
      papers: data?.map(p => ({
        id: p.id,
        course_code: p.course_code,
        workflow_status: p.status,
        approval_status: p.approval_status,
        is_locked: p.is_locked,
        printing_due_date: p.printing_due_date
      }))
    });

    // If no approved papers found, try querying without status filter to see what exists
    if (!data || data.length === 0) {
      console.log('⚠️ No approved papers found. Checking all papers with different statuses...');
      const { data: allStatuses, error: allStatusesError } = await supabase
        .from('exam_papers')
        .select('id, status, course_code, course_name, is_locked, printing_due_date, printing_due_time')
        .order('created_at', { ascending: false })
        .limit(20);
      
      if (allStatusesError) {
        console.error('❌ Error fetching all papers:', allStatusesError);
      } else {
        console.log('📋 All papers in database (last 20):', allStatuses);
        console.log('📊 Status breakdown:', {
          total: allStatuses?.length || 0,
          workflow_statuses: allStatuses?.reduce((acc: any, p: any) => {
            acc[p.status] = (acc[p.status] || 0) + 1;
            return acc;
          }, {}),
          approval_statuses: allStatuses?.reduce((acc: any, p: any) => {
            const approvalStatus = p.approval_status || 'none';
            acc[approvalStatus] = (acc[approvalStatus] || 0) + 1;
            return acc;
          }, {}),
          locked_count: allStatuses?.filter((p: any) => p.is_locked === true).length || 0
        });
      }
      
      // Check specifically for papers that might be approved but with different approval_status
      const { data: lockedPapers, error: lockedError } = await supabase
        .from('exam_papers')
        .select('id, status, approval_status, course_code, course_name, is_locked, printing_due_date')
        .eq('is_locked', true)
        .order('created_at', { ascending: false });
      
      if (lockedError) {
        console.error('❌ Error fetching locked papers:', lockedError);
      } else {
        console.log('🔒 Papers with is_locked=true:', lockedPapers);
      }
      
      // Also check for papers with approval_status containing "approved" or "print"
      const { data: approvedLike, error: approvedLikeError } = await supabase
        .from('exam_papers')
        .select('id, status, approval_status, course_code, course_name, is_locked')
        .or('approval_status.ilike.%approved%,approval_status.ilike.%print%')
        .order('created_at', { ascending: false });
      
      if (approvedLikeError) {
        console.error('❌ Error fetching approved-like papers:', approvedLikeError);
      } else {
        console.log('📄 Papers with "approved" or "print" in approval_status:', approvedLike);
      }
    }

    // Normalize results so that any paper that has been approved for printing is
    // treated as locked in the UI, even if the underlying `is_locked` flag was
    // not set correctly due to older data or partial updates.
    const normalized = (data || []).map((paper: any) => {
      const isApproved =
        paper.approval_status === 'approved_for_printing' ||
        paper.status === 'approved_for_printing';

      // If the paper is approved but `is_locked` is missing/false, force it to true
      // in the frontend representation so that Super Admins see it as locked.
      if (isApproved && (paper.is_locked === null || paper.is_locked === false || typeof paper.is_locked === 'undefined')) {
        return {
          ...paper,
          is_locked: true,
        };
      }

      return paper;
    });

    console.log('✅ Approved papers after normalization:', {
      count: normalized.length,
      papers: normalized.map(p => ({
        id: p.id,
        course_code: p.course_code,
        workflow_status: p.status,
        approval_status: p.approval_status,
        is_locked: p.is_locked,
        printing_due_date: p.printing_due_date
      }))
    });

    return normalized as ApprovedPaper[];
  } catch (error) {
    console.error('❌ Exception fetching approved papers:', error);
    return [];
  }
}

/**
 * Get papers that need password generation (for scheduled job)
 */
export async function getPapersNeedingPasswordGeneration(): Promise<ApprovedPaper[]> {
  try {
    const { data: papers, error: fetchError } = await supabase
      .from('exam_papers')
      .select('*')
      .or('approval_status.eq.approved_for_printing,status.eq.approved_for_printing')
      .eq('is_locked', true)
      .is('unlock_password_hash', null);

    if (fetchError) {
      console.error('Error fetching paper details:', fetchError);
      return [];
    }

    const now = new Date();
    return ((papers || []) as ApprovedPaper[]).filter((paper) => {
      const dueAt = parseDueDateTimeLocal(paper.printing_due_date, paper.printing_due_time);
      if (!dueAt) return false;
      return dueAt.getTime() <= now.getTime();
    });
  } catch (error) {
    console.error('Exception checking papers for password generation:', error);
    return [];
  }
}

/**
 * Generate password for a paper and notify Super Admin
 * @param examPaperId - The paper ID
 * @param force - If true, generate password even if due date hasn't passed (for testing)
 */
export async function generatePasswordForPaper(
  examPaperId: string,
  force: boolean = false,
  generatedByUserId?: string
): Promise<{ success: boolean; error?: string; password?: string }> {
  try {
    // Get paper details
    const { data: paper, error: fetchError } = await supabase
      .from('exam_papers')
      .select('*')
      .eq('id', examPaperId)
      .single();

    if (fetchError || !paper) {
      return { success: false, error: 'Paper not found' };
    }

    // Check if password already generated
    if (paper.unlock_password_hash && !force) {
      return { success: false, error: 'Password already generated for this paper' };
    }

    // Check if paper is approved and locked
    if (paper.approval_status !== 'approved_for_printing' || !paper.is_locked) {
      return { success: false, error: 'Paper must be approved and locked before generating password' };
    }

    // Check if due date has passed (unless forcing)
    if (!force && paper.printing_due_date && paper.printing_due_time) {
      const dueDate = parseDueDateTimeLocal(paper.printing_due_date, paper.printing_due_time);
      if (!dueDate) {
        return { success: false, error: 'Invalid printing due date/time format on this paper' };
      }
      const now = new Date();
      if (dueDate > now) {
        return { success: false, error: `Paper is not due yet. Due: ${dueDate.toLocaleString()}` };
      }
    }

    // Generate password and hash
    const { plaintext, hash } = await generatePasswordWithHash(16);

    // Update paper with password hash
    const { error: updateError } = await supabase
      .from('exam_papers')
      .update({
        unlock_password_hash: hash,
        password_generated_at: new Date().toISOString(),
      })
      .eq('id', examPaperId);

    if (updateError) {
      console.error('Error updating paper with password:', updateError);
      return { success: false, error: updateError.message };
    }

    // Log password generation
    const { error: logError } = await supabase
      .from('paper_unlock_logs')
      .insert({
        exam_paper_id: examPaperId,
        password_hash: hash,
        generated_by: 'system',
      });

    if (logError) {
      console.error('Error logging password generation:', logError);
      // Don't fail if logging fails
    }

    // Get Super Admin users
    const { data: superAdmins, error: adminError } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('is_super_admin', true);

    const recipientIds = new Set<string>();
    if (!adminError && superAdmins && superAdmins.length > 0) {
      superAdmins.forEach((admin) => {
        if (admin?.id) recipientIds.add(admin.id);
      });
    }

    // Ensure the actor generating the password always receives the notification in the bell.
    if (generatedByUserId) {
      recipientIds.add(generatedByUserId);
    }
    // Fallback to the authenticated user id when a caller passes a non-Supabase id.
    const { data: authData } = await supabase.auth.getUser();
    if (authData?.user?.id) {
      recipientIds.add(authData.user.id);
    }

    if (recipientIds.size > 0) {
      // Format printing date/time
      const printingDate = paper.printing_due_date
        ? new Date(paper.printing_due_date).toLocaleDateString()
        : 'N/A';
      const printingTime = paper.printing_due_time || '00:00';

      // Notify all Super Admins
      const notifications = Array.from(recipientIds).map((adminId) =>
        createNotification({
          user_id: adminId,
          title: 'Paper Unlock Password Generated',
          message: `Password generated for ${paper.course_code} - ${paper.course_name}. Printing due: ${printingDate} at ${printingTime}. Password: ${plaintext}`,
          type: 'info',
          related_exam_paper_id: examPaperId,
        })
      );

      const results = await Promise.all(notifications);
      const failures = results.filter((result) => !result.success);
      if (failures.length > 0) {
        console.error('Some unlock password notifications failed to create:', failures);
      }
    } else {
      console.warn('No super-admin recipients found for unlock password notification.');
    }

    console.log('✅ Password generated for paper:', examPaperId);
    return { success: true, password: plaintext };
  } catch (error: any) {
    console.error('Exception generating password:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Unlock a paper with password (temporary unlock)
 * @param examPaperId - Paper ID to unlock
 * @param password - Plaintext password
 * @param userId - User ID unlocking the paper
 * @param unlockDurationHours - How long the unlock should last (default: 24 hours)
 */
export async function unlockPaper(
  examPaperId: string,
  password: string,
  userId: string,
  unlockDurationHours: number = 24
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get paper details
    const { data: paper, error: fetchError } = await supabase
      .from('exam_papers')
      .select('*')
      .eq('id', examPaperId)
      .single();

    if (fetchError || !paper) {
      return { success: false, error: 'Paper not found' };
    }

    // Check if paper is locked
    if (!paper.is_locked && !paper.unlock_password_hash) {
      return { success: false, error: 'Paper is not locked or password not generated yet' };
    }

    // Verify password
    if (!paper.unlock_password_hash) {
      return { success: false, error: 'Password not generated for this paper yet' };
    }

    const isValid = await verifyPassword(password, paper.unlock_password_hash);
    if (!isValid) {
      // Log failed unlock attempt
      console.warn('❌ Invalid password attempt for paper:', examPaperId);
      return { success: false, error: 'Invalid password' };
    }

    // Calculate unlock expiry
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + unlockDurationHours);

    // Unlock paper
    const { error: updateError } = await supabase
      .from('exam_papers')
      .update({
        is_locked: false,
        unlocked_at: new Date().toISOString(),
        unlocked_by: userId,
        unlock_expires_at: expiresAt.toISOString(),
      })
      .eq('id', examPaperId);

    if (updateError) {
      console.error('Error unlocking paper:', updateError);
      return { success: false, error: updateError.message };
    }

    // Log unlock event
    const { error: logError } = await supabase
      .from('paper_unlock_logs')
      .update({
        unlocked_at: new Date().toISOString(),
        unlocked_by: userId,
        unlock_expires_at: expiresAt.toISOString(),
      })
      .eq('exam_paper_id', examPaperId)
      .is('unlocked_at', null); // Only update if not already unlocked

    if (logError) {
      console.error('Error logging unlock:', logError);
      // Don't fail if logging fails
    }

    console.log('✅ Paper unlocked:', examPaperId);
    return { success: true };
  } catch (error: any) {
    console.error('Exception unlocking paper:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Re-lock a paper (after temporary unlock expires or manually)
 */
export async function reLockPaper(
  examPaperId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error: updateError } = await supabase
      .from('exam_papers')
      .update({
        is_locked: true,
        unlock_expires_at: null,
        unlocked_at: null,
        unlocked_by: null,
      })
      .eq('id', examPaperId);

    if (updateError) {
      console.error('Error re-locking paper:', updateError);
      return { success: false, error: updateError.message };
    }

    // Log re-lock event
    const { error: logError } = await supabase
      .from('paper_unlock_logs')
      .update({
        re_locked_at: new Date().toISOString(),
        re_locked_by: userId,
      })
      .eq('exam_paper_id', examPaperId)
      .is('re_locked_at', null);

    if (logError) {
      console.error('Error logging re-lock:', logError);
    }

    console.log('✅ Paper re-locked:', examPaperId);
    return { success: true };
  } catch (error: any) {
    console.error('Exception re-locking paper:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Check and re-lock expired temporary unlocks (for scheduled job)
 */
export async function checkAndReLockExpired(): Promise<number> {
  try {
    const { data, error } = await supabase.rpc('re_lock_expired_papers');

    if (error) {
      console.error('Error re-locking expired papers:', error);
      return 0;
    }

    return data || 0;
  } catch (error) {
    console.error('Exception re-locking expired papers:', error);
    return 0;
  }
}
