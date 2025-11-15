import { supabase } from '../supabase';
import type { ExamPaper } from '../supabase';
import { addWorkflowEvent } from './workflowService';
import { createNotification } from './notificationService';
import { createVettingSession, assignVetters } from './vettingService';

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
  notes?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error: updateError } = await supabase
      .from('exam_papers')
      .update({
        status: 'approved_for_printing',
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
      action: 'Approved for Printing',
      description: notes || 'Exam paper approved and ready for printing',
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
        message: 'Exam paper has been approved for printing',
        type: 'success',
        related_exam_paper_id: examPaperId,
      });
    }

    return { success: true };
  } catch (error: any) {
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






