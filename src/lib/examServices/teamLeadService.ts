import { supabase } from '../supabase';
import type { ExamPaper } from '../supabase';
import { addWorkflowEvent } from './workflowService';
import { createNotification } from './notificationService';

// Integrate exams from multiple setters (Team Lead)
export async function integrateExams(
  examPaperIds: string[],
  integratedFileUrl: string,
  integratedFileName: string,
  teamLeadId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Update all exam papers to integrated status
    const { error: updateError } = await supabase
      .from('exam_papers')
      .update({
        status: 'integrated_by_team_lead',
        team_lead_id: teamLeadId,
        updated_at: new Date().toISOString(),
      })
      .in('id', examPaperIds);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    // Create a new integrated exam paper (or update the first one with integrated file)
    const { data: firstExam } = await supabase
      .from('exam_papers')
      .select('*')
      .eq('id', examPaperIds[0])
      .single();

    if (firstExam) {
      // Update the first exam with integrated file
      await supabase
        .from('exam_papers')
        .update({
          file_url: integratedFileUrl,
          file_name: integratedFileName,
        })
        .eq('id', examPaperIds[0]);

      // Add workflow events for all exams
      for (const examId of examPaperIds) {
        await addWorkflowEvent({
          exam_paper_id: examId,
          actor_id: teamLeadId,
          action: 'Integrated by Team Lead',
          description: 'All exam papers integrated into one document',
          from_status: 'submitted_to_repository',
          to_status: 'integrated_by_team_lead',
        });
      }

      // Notify chief examiner
      if (firstExam.chief_examiner_id) {
        await createNotification({
          user_id: firstExam.chief_examiner_id,
          title: 'Exams Integrated',
          message: `Team Lead has integrated ${examPaperIds.length} exam paper(s)`,
          type: 'info',
          related_exam_paper_id: examPaperIds[0],
        });
      }
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Send integrated exam to Chief Examiner
export async function sendToChiefExaminer(
  examPaperId: string,
  teamLeadId: string,
  chiefExaminerId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error: updateError } = await supabase
      .from('exam_papers')
      .update({
        status: 'sent_to_chief_examiner',
        chief_examiner_id: chiefExaminerId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', examPaperId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    // Add workflow event
    await addWorkflowEvent({
      exam_paper_id: examPaperId,
      actor_id: teamLeadId,
      action: 'Sent to Chief Examiner',
      description: 'Integrated exam sent to Chief Examiner for vetting appointment',
      from_status: 'integrated_by_team_lead',
      to_status: 'sent_to_chief_examiner',
    });

    // Notify chief examiner
    await createNotification({
      user_id: chiefExaminerId,
      title: 'Exam Ready for Vetting',
      message: 'Team Lead has sent integrated exam for vetting appointment',
      type: 'info',
      related_exam_paper_id: examPaperId,
    });

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Get exams for team lead
export async function getTeamLeadExams(teamLeadId: string): Promise<ExamPaper[]> {
  try {
    const { data, error } = await supabase
      .from('exam_papers')
      .select('*')
      .eq('team_lead_id', teamLeadId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching team lead exams:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching team lead exams:', error);
    return [];
  }
}

// Get exams submitted to repository (for team lead to integrate)
export async function getExamsForIntegration(campus?: string): Promise<ExamPaper[]> {
  try {
    let query = supabase
      .from('exam_papers')
      .select('*')
      .eq('status', 'submitted_to_repository')
      .order('submitted_at', { ascending: true });

    if (campus) {
      query = query.eq('campus', campus);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching exams for integration:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching exams for integration:', error);
    return [];
  }
}












