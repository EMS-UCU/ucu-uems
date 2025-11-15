import { supabase } from '../supabase';
import type { ExamPaper, ExamVersion } from '../supabase';
import { addWorkflowEvent } from './workflowService';
import { createNotification } from './notificationService';

// Create a new exam paper (Setter - Week 5 notification)
export async function createExamPaper(data: {
  course_code: string;
  course_name: string;
  semester: string;
  academic_year: string;
  campus: string;
  setter_id: string;
  deadline: string;
}): Promise<{ success: boolean; examPaper?: ExamPaper; error?: string }> {
  try {
    const { data: examPaper, error } = await supabase
      .from('exam_papers')
      .insert({
        ...data,
        status: 'draft',
        version_number: 1,
      })
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    // Add workflow event
    await addWorkflowEvent({
      exam_paper_id: examPaper.id,
      actor_id: data.setter_id,
      action: 'Exam paper created',
      description: `Exam paper for ${data.course_code} created by setter`,
      to_status: 'draft',
    });

    return { success: true, examPaper };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Submit exam to repository (Setter)
export async function submitExamToRepository(
  examPaperId: string,
  fileUrl: string,
  fileName: string,
  fileSize: number,
  setterId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Update exam paper status
    const { error: updateError } = await supabase
      .from('exam_papers')
      .update({
        status: 'submitted_to_repository',
        file_url: fileUrl,
        file_name: fileName,
        file_size: fileSize,
        submitted_at: new Date().toISOString(),
      })
      .eq('id', examPaperId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    // Create exam version
    const { data: examPaper } = await supabase
      .from('exam_papers')
      .select('version_number')
      .eq('id', examPaperId)
      .single();

    await supabase.from('exam_versions').insert({
      exam_paper_id: examPaperId,
      version_number: examPaper?.version_number || 1,
      file_url: fileUrl,
      file_name: fileName,
      created_by: setterId,
      notes: 'Initial submission to repository',
    });

    // Add workflow event
    await addWorkflowEvent({
      exam_paper_id: examPaperId,
      actor_id: setterId,
      action: 'Submitted to repository',
      description: 'Exam paper submitted to central repository',
      from_status: 'draft',
      to_status: 'submitted_to_repository',
    });

    // Notify team lead
    const { data: examPaperData } = await supabase
      .from('exam_papers')
      .select('team_lead_id, course_code, course_name')
      .eq('id', examPaperId)
      .single();

    if (examPaperData?.team_lead_id) {
      await createNotification({
        user_id: examPaperData.team_lead_id,
        title: 'New Exam Submission',
        message: `New exam paper submitted: ${examPaperData.course_code} - ${examPaperData.course_name}`,
        type: 'info',
        related_exam_paper_id: examPaperId,
      });
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Get exam papers for a setter
export async function getSetterExams(setterId: string): Promise<ExamPaper[]> {
  try {
    const { data, error } = await supabase
      .from('exam_papers')
      .select('*')
      .eq('setter_id', setterId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching setter exams:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching setter exams:', error);
    return [];
  }
}

// Get exam paper by ID
export async function getExamPaper(examPaperId: string): Promise<ExamPaper | null> {
  try {
    const { data, error } = await supabase
      .from('exam_papers')
      .select('*')
      .eq('id', examPaperId)
      .single();

    if (error) {
      console.error('Error fetching exam paper:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error fetching exam paper:', error);
    return null;
  }
}

// Get exam versions
export async function getExamVersions(examPaperId: string): Promise<ExamVersion[]> {
  try {
    const { data, error } = await supabase
      .from('exam_versions')
      .select('*')
      .eq('exam_paper_id', examPaperId)
      .order('version_number', { ascending: false });

    if (error) {
      console.error('Error fetching exam versions:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching exam versions:', error);
    return [];
  }
}






