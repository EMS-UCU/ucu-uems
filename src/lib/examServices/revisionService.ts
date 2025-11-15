import { supabase } from '../supabase';
import type { ExamPaper, VettingComment } from '../supabase';
import { addWorkflowEvent } from './workflowService';
import { createNotification } from './notificationService';

// Start revision process (Team Lead addresses comments)
export async function startRevision(
  examPaperId: string,
  teamLeadId: string,
  revisedFileUrl: string,
  revisedFileName: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get current version
    const { data: examPaper } = await supabase
      .from('exam_papers')
      .select('version_number')
      .eq('id', examPaperId)
      .single();

    const newVersion = (examPaper?.version_number || 1) + 1;

    // Update exam paper
    const { error: updateError } = await supabase
      .from('exam_papers')
      .update({
        status: 'revision_in_progress',
        version_number: newVersion,
        file_url: revisedFileUrl,
        file_name: revisedFileName,
        updated_at: new Date().toISOString(),
      })
      .eq('id', examPaperId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    // Create new version
    await supabase.from('exam_versions').insert({
      exam_paper_id: examPaperId,
      version_number: newVersion,
      file_url: revisedFileUrl,
      file_name: revisedFileName,
      created_by: teamLeadId,
      notes: 'Revision addressing vetting comments',
    });

    // Mark all comments as addressed
    const { data: session } = await supabase
      .from('vetting_sessions')
      .select('id')
      .eq('exam_paper_id', examPaperId)
      .eq('status', 'completed')
      .single();

    if (session) {
      await supabase
        .from('vetting_comments')
        .update({ is_addressed: true })
        .eq('vetting_session_id', session.id)
        .eq('is_addressed', false);
    }

    // Add workflow event
    await addWorkflowEvent({
      exam_paper_id: examPaperId,
      actor_id: teamLeadId,
      action: 'Revision Started',
      description: 'Team Lead started revision addressing vetting comments',
      from_status: 'vetted_with_comments',
      to_status: 'revision_in_progress',
    });

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Submit revised exam to Chief Examiner (Team Lead)
export async function submitRevisedExam(
  examPaperId: string,
  teamLeadId: string,
  finalFileUrl: string,
  finalFileName: string,
  notes?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Update exam paper
    const { error: updateError } = await supabase
      .from('exam_papers')
      .update({
        status: 'resubmitted_to_chief_examiner',
        file_url: finalFileUrl,
        file_name: finalFileName,
        updated_at: new Date().toISOString(),
      })
      .eq('id', examPaperId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    // Get current version and create new one
    const { data: examPaper } = await supabase
      .from('exam_papers')
      .select('version_number')
      .eq('id', examPaperId)
      .single();

    await supabase.from('exam_versions').insert({
      exam_paper_id: examPaperId,
      version_number: examPaper?.version_number || 1,
      file_url: finalFileUrl,
      file_name: finalFileName,
      created_by: teamLeadId,
      notes: notes || 'Revised exam resubmitted to Chief Examiner',
    });

    // Add workflow event
    await addWorkflowEvent({
      exam_paper_id: examPaperId,
      actor_id: teamLeadId,
      action: 'Revised Exam Resubmitted',
      description: notes || 'Revised exam resubmitted to Chief Examiner for final approval',
      from_status: 'revision_in_progress',
      to_status: 'resubmitted_to_chief_examiner',
    });

    // Notify chief examiner
    const { data: examPaperData } = await supabase
      .from('exam_papers')
      .select('chief_examiner_id')
      .eq('id', examPaperId)
      .single();

    if (examPaperData?.chief_examiner_id) {
      await createNotification({
        user_id: examPaperData.chief_examiner_id,
        title: 'Revised Exam Submitted',
        message: 'Team Lead has resubmitted revised exam for final approval',
        type: 'info',
        related_exam_paper_id: examPaperId,
      });
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Get unaddressed comments for an exam
export async function getUnaddressedComments(examPaperId: string): Promise<VettingComment[]> {
  try {
    // Get completed vetting session
    const { data: session } = await supabase
      .from('vetting_sessions')
      .select('id')
      .eq('exam_paper_id', examPaperId)
      .eq('status', 'completed')
      .single();

    if (!session) {
      return [];
    }

    const { data: comments, error } = await supabase
      .from('vetting_comments')
      .select('*')
      .eq('vetting_session_id', session.id)
      .eq('is_addressed', false)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching unaddressed comments:', error);
      return [];
    }

    return comments || [];
  } catch (error) {
    console.error('Error fetching unaddressed comments:', error);
    return [];
  }
}

// Get all comments for an exam
export async function getAllComments(examPaperId: string): Promise<VettingComment[]> {
  try {
    const { data: session } = await supabase
      .from('vetting_sessions')
      .select('id')
      .eq('exam_paper_id', examPaperId)
      .single();

    if (!session) {
      return [];
    }

    const { data: comments, error } = await supabase
      .from('vetting_comments')
      .select('*')
      .eq('vetting_session_id', session.id)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching comments:', error);
      return [];
    }

    return comments || [];
  } catch (error) {
    console.error('Error fetching comments:', error);
    return [];
  }
}









