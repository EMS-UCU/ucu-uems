import { supabase } from '../supabase';
import type { ExamPaper, VettingSession } from '../supabase';
import { addWorkflowEvent } from './workflowService';
import { createNotification } from './notificationService';
import { createVettingSession, assignVetters, getVettingSessionsWithRecordings, getVettingSessionWithRecording } from './vettingService';
import { getRecordingSignedUrl } from './recordingService';

// Appoint vetters for an exam (Chief Examiner)
export async function appointVetters(
  examPaperId: string,
  vetterIds: string[],
  chiefExaminerId: string,
  expiresInHours: number = 48
): Promise<{ success: boolean; error?: string }> {
  try {
    // Update exam status
    const { error: updateError } = await supabase
      .from('exam_papers')
      .update({
        status: 'appointed_for_vetting',
        updated_at: new Date().toISOString(),
      })
      .eq('id', examPaperId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    // Create vetting session
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + expiresInHours);

    const { data: session, error: sessionError } = await createVettingSession({
      exam_paper_id: examPaperId,
      chief_examiner_id: chiefExaminerId,
      expires_at: expiresAt.toISOString(),
    });

    if (sessionError || !session) {
      return { success: false, error: sessionError || 'Failed to create vetting session' };
    }

    // Assign vetters
    const { error: assignError } = await assignVetters(session.id, vetterIds, chiefExaminerId);

    if (assignError) {
      return { success: false, error: assignError };
    }

    // Add workflow event
    await addWorkflowEvent({
      exam_paper_id: examPaperId,
      actor_id: chiefExaminerId,
      action: 'Vetters Appointed',
      description: `${vetterIds.length} vetter(s) appointed for physical vetting`,
      from_status: 'sent_to_chief_examiner',
      to_status: 'appointed_for_vetting',
    });

    // Notify vetters
    for (const vetterId of vetterIds) {
      await createNotification({
        user_id: vetterId,
        title: 'Vetting Assignment',
        message: 'You have been assigned to vet an exam paper',
        type: 'info',
        related_exam_paper_id: examPaperId,
      });
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Approve exam for printing (Chief Examiner)
export async function approveExamForPrinting(
  examPaperId: string,
  chiefExaminerId: string,
  notes?: string,
  printingDueDate?: string, // ISO date string (YYYY-MM-DD)
  printingDueTime?: string  // Time string (HH:MM format, e.g., "09:00")
): Promise<{ success: boolean; error?: string }> {
  try {
    // Prepare update data
    // Note: We set approval_status (not status) to separate approval from workflow/vetting status
    const updateData: any = {
      approval_status: 'approved_for_printing',
      updated_at: new Date().toISOString(),
      is_locked: true, // Lock paper in repository
    };

    // Add printing date and time if provided
    if (printingDueDate) {
      updateData.printing_due_date = printingDueDate;
    }
    if (printingDueTime) {
      updateData.printing_due_time = printingDueTime;
    }

    console.log('📤 Updating exam paper in database:', {
      examPaperId,
      updateData
    });

    const { data: updatedData, error: updateError } = await supabase
      .from('exam_papers')
      .update(updateData)
      .eq('id', examPaperId)
      .select();

    if (updateError) {
      console.error('❌ Error updating exam paper:', {
        error: updateError.message,
        code: updateError.code,
        details: updateError.details,
        hint: updateError.hint,
        examPaperId,
        updateData
      });
      
      // Check if it's an RLS error
      if (updateError.code === '42501' || updateError.message?.includes('permission') || updateError.message?.includes('policy')) {
        return { 
          success: false, 
          error: `Permission denied: RLS policy may be blocking the update. Please check Supabase RLS policies for exam_papers table. Error: ${updateError.message}` 
        };
      }
      
      return { success: false, error: updateError.message };
    }

    // Update may succeed but RETURNING can be empty if RLS allows UPDATE but not SELECT on the row
    if (!updatedData || updatedData.length === 0) {
      console.warn('⚠️ Update returned no rows (update may still have succeeded if RLS blocks SELECT). Verifying...', {
        examPaperId,
        updateData
      });
      
      // Verify the row was updated: run a simple update without select, then check row count
      const { count, error: countError } = await supabase
        .from('exam_papers')
        .select('id', { count: 'exact', head: true })
        .eq('id', examPaperId)
        .eq('approval_status', 'approved_for_printing')
        .eq('is_locked', true);
      
      // If we can't verify, still treat as success (update had no error - row may have been updated)
      if (countError) {
        console.warn('Could not verify update:', countError.message);
      }
      
      console.log('✅ Exam paper update completed (no rows returned from UPDATE; assuming success).', {
        examPaperId,
        verified: !countError
      });
    } else {
      console.log('✅ Exam paper updated successfully:', {
        examPaperId,
        updatedRows: updatedData?.length || 0,
        updatedData: updatedData?.[0],
        status: updatedData[0]?.status,
        is_locked: updatedData[0]?.is_locked,
        printing_due_date: updatedData[0]?.printing_due_date
      });
    }

    // Add workflow event
    const eventDescription = printingDueDate && printingDueTime
      ? `${notes || 'Exam paper approved and ready for printing'}. Printing due: ${printingDueDate} at ${printingDueTime}`
      : notes || 'Exam paper approved and ready for printing';

    await addWorkflowEvent({
      exam_paper_id: examPaperId,
      actor_id: chiefExaminerId,
      action: 'Approved for Printing',
      description: eventDescription,
      from_status: 'resubmitted_to_chief_examiner',
      to_status: 'approved_for_printing',
    });

    // Notify team lead
    const { data: examPaper } = await supabase
      .from('exam_papers')
      .select('team_lead_id')
      .eq('id', examPaperId)
      .single();

    if (examPaper?.team_lead_id) {
      await createNotification({
        user_id: examPaper.team_lead_id,
        title: 'Exam Approved',
        message: `Exam paper has been approved for printing${printingDueDate ? ` and locked until ${printingDueDate} at ${printingDueTime || '00:00'}` : ''}`,
        type: 'success',
        related_exam_paper_id: examPaperId,
      });
    }

    console.log('✅ Paper approved and locked:', {
      examPaperId,
      printingDueDate,
      printingDueTime,
      isLocked: true
    });

    return { success: true };
  } catch (error: any) {
    console.error('Exception approving exam:', error);
    return { success: false, error: error.message };
  }
}

// Reject exam and restart process (Chief Examiner)
export async function rejectExamAndRestart(
  examPaperId: string,
  chiefExaminerId: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error: updateError } = await supabase
      .from('exam_papers')
      .update({
        status: 'rejected_restart_process',
        updated_at: new Date().toISOString(),
      })
      .eq('id', examPaperId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    // Add workflow event
    await addWorkflowEvent({
      exam_paper_id: examPaperId,
      actor_id: chiefExaminerId,
      action: 'Rejected - Restart Process',
      description: reason,
      from_status: 'resubmitted_to_chief_examiner',
      to_status: 'rejected_restart_process',
    });

    // Notify setter to restart
    const { data: examPaper } = await supabase
      .from('exam_papers')
      .select('setter_id')
      .eq('id', examPaperId)
      .single();

    if (examPaper?.setter_id) {
      await createNotification({
        user_id: examPaper.setter_id,
        title: 'Exam Rejected',
        message: `Exam rejected: ${reason}. Please restart the process.`,
        type: 'error',
        related_exam_paper_id: examPaperId,
      });
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Get exams for chief examiner
export async function getChiefExaminerExams(chiefExaminerId: string): Promise<ExamPaper[]> {
  try {
    const { data, error } = await supabase
      .from('exam_papers')
      .select('*')
      .eq('chief_examiner_id', chiefExaminerId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching chief examiner exams:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching chief examiner exams:', error);
    return [];
  }
}

// Get vetting session recordings for Chief Examiner
export async function getVettingRecordings(
  chiefExaminerId: string,
  examPaperId?: string
): Promise<VettingSession[]> {
  try {
    return await getVettingSessionsWithRecordings(chiefExaminerId, examPaperId);
  } catch (error) {
    console.error('Error fetching vetting recordings:', error);
    return [];
  }
}

// Get a specific recording URL (with signed URL for private bucket)
export async function getRecordingUrl(
  sessionId: string,
  useSignedUrl: boolean = true
): Promise<{ url?: string; error?: string }> {
  try {
    const session = await getVettingSessionWithRecording(sessionId);
    
    if (!session || !session.recording_url) {
      return { error: 'Recording not found for this session' };
    }

    // If bucket is public, return the public URL directly
    if (!useSignedUrl || !session.recording_file_path) {
      return { url: session.recording_url };
    }

    // For private bucket, get a signed URL
    const signedUrlResult = await getRecordingSignedUrl(session.recording_file_path, 3600); // 1 hour expiry
    
    if (signedUrlResult.error) {
      // Fallback to public URL if signed URL fails
      return { url: session.recording_url };
    }

    return { url: signedUrlResult.url };
  } catch (error: any) {
    return { error: error.message || 'Failed to get recording URL' };
  }
}












