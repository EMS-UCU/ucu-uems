import { supabase } from '../supabase';
import type { VettingSession, VettingAssignment, VettingComment } from '../supabase';
import { addWorkflowEvent } from './workflowService';
import { createNotification } from './notificationService';

// Create a vetting session
export async function createVettingSession(data: {
  exam_paper_id: string;
  chief_examiner_id?: string;
  expires_at: string;
}): Promise<{ data?: VettingSession; error?: string }> {
  try {
    const { data: session, error } = await supabase
      .from('vetting_sessions')
      .insert({
        ...data,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      return { error: error.message };
    }

    return { data: session };
  } catch (error: any) {
    return { error: error.message };
  }
}

// Assign vetters to a session
export async function assignVetters(
  sessionId: string,
  vetterIds: string[],
  assignedBy: string
): Promise<{ error?: string }> {
  try {
    const assignments = vetterIds.map((vetterId) => ({
      vetting_session_id: sessionId,
      vetter_id: vetterId,
      assigned_by: assignedBy,
    }));

    const { error } = await supabase
      .from('vetting_assignments')
      .insert(assignments);

    if (error) {
      return { error: error.message };
    }

    return {};
  } catch (error: any) {
    return { error: error.message };
  }
}

// Start vetting session
export async function startVettingSession(
  sessionId: string,
  vetterId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('vetting_sessions')
      .update({
        status: 'in_progress',
        started_at: new Date().toISOString(),
      })
      .eq('id', sessionId);

    if (error) {
      return { success: false, error: error.message };
    }

    // Update exam paper status
    const { data: session } = await supabase
      .from('vetting_sessions')
      .select('exam_paper_id')
      .eq('id', sessionId)
      .single();

    if (session) {
      await supabase
        .from('exam_papers')
        .update({ status: 'vetting_in_progress' })
        .eq('id', session.exam_paper_id);

      await addWorkflowEvent({
        exam_paper_id: session.exam_paper_id,
        actor_id: vetterId,
        action: 'Vetting Started',
        description: 'Physical vetting session started',
        from_status: 'appointed_for_vetting',
        to_status: 'vetting_in_progress',
      });
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Add vetting comment
export async function addVettingComment(
  sessionId: string,
  vetterId: string,
  comment: {
    comment_text: string;
    page_number?: number;
    question_number?: string;
    comment_type?: 'general' | 'question_specific' | 'formatting' | 'content';
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('vetting_comments')
      .insert({
        vetting_session_id: sessionId,
        vetter_id: vetterId,
        ...comment,
      });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Complete vetting session
export async function completeVettingSession(
  sessionId: string,
  vetterId: string,
  scannedFileUrl: string,
  recordingData?: {
    recordingUrl: string;
    recordingFilePath: string;
    recordingFileSize: number;
    recordingDurationSeconds: number;
    recordingStartedAt: string;
    recordingCompletedAt: string;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const updateData: any = {
      status: 'completed',
      completed_at: new Date().toISOString(),
    };

    // Add recording data if provided
    if (recordingData) {
      updateData.recording_url = recordingData.recordingUrl;
      updateData.recording_file_path = recordingData.recordingFilePath;
      updateData.recording_file_size = recordingData.recordingFileSize;
      updateData.recording_duration_seconds = recordingData.recordingDurationSeconds;
      updateData.recording_started_at = recordingData.recordingStartedAt;
      updateData.recording_completed_at = recordingData.recordingCompletedAt;
    }

    const { error: sessionError } = await supabase
      .from('vetting_sessions')
      .update(updateData)
      .eq('id', sessionId);

    if (sessionError) {
      return { success: false, error: sessionError.message };
    }

    // Get exam paper ID
    const { data: session } = await supabase
      .from('vetting_sessions')
      .select('exam_paper_id')
      .eq('id', sessionId)
      .single();

    if (session) {
      // Update exam paper status
      await supabase
        .from('exam_papers')
        .update({
          status: 'vetted_with_comments',
          file_url: scannedFileUrl, // Scanned version with comments
        })
        .eq('id', session.exam_paper_id);

      // Add workflow event
      await addWorkflowEvent({
        exam_paper_id: session.exam_paper_id,
        actor_id: vetterId,
        action: 'Vetting Completed',
        description: 'Physical vetting completed, scanned copy with comments sent',
        from_status: 'vetting_in_progress',
        to_status: 'vetted_with_comments',
      });

      // Notify team lead
      const { data: examPaper } = await supabase
        .from('exam_papers')
        .select('team_lead_id')
        .eq('id', session.exam_paper_id)
        .single();

      if (examPaper?.team_lead_id) {
        await createNotification({
          user_id: examPaper.team_lead_id,
          title: 'Vetting Completed',
          message: 'Exam paper has been vetted. Scanned copy with comments available.',
          type: 'info',
          related_exam_paper_id: session.exam_paper_id,
        });
      }
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Get vetting sessions for a vetter
export async function getVetterSessions(vetterId: string): Promise<VettingSession[]> {
  try {
    const { data: assignments } = await supabase
      .from('vetting_assignments')
      .select('vetting_session_id')
      .eq('vetter_id', vetterId);

    if (!assignments || assignments.length === 0) {
      return [];
    }

    const sessionIds = assignments.map((a) => a.vetting_session_id);

    const { data: sessions, error } = await supabase
      .from('vetting_sessions')
      .select('*')
      .in('id', sessionIds)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching vetter sessions:', error);
      return [];
    }

    return sessions || [];
  } catch (error) {
    console.error('Error fetching vetter sessions:', error);
    return [];
  }
}

// Get vetting comments for a session
export async function getVettingComments(sessionId: string): Promise<VettingComment[]> {
  try {
    const { data, error } = await supabase
      .from('vetting_comments')
      .select('*')
      .eq('vetting_session_id', sessionId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching vetting comments:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching vetting comments:', error);
    return [];
  }
}

// Get vetting sessions with recordings for Chief Examiner
export async function getVettingSessionsWithRecordings(
  chiefExaminerId?: string,
  examPaperId?: string
): Promise<VettingSession[]> {
  try {
    let query = supabase
      .from('vetting_sessions')
      .select('*')
      .not('recording_url', 'is', null)
      .order('created_at', { ascending: false });

    if (chiefExaminerId) {
      query = query.eq('chief_examiner_id', chiefExaminerId);
    }

    if (examPaperId) {
      query = query.eq('exam_paper_id', examPaperId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching sessions with recordings:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching sessions with recordings:', error);
    return [];
  }
}

// Get a specific vetting session with recording
export async function getVettingSessionWithRecording(
  sessionId: string
): Promise<VettingSession | null> {
  try {
    const { data, error } = await supabase
      .from('vetting_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (error) {
      console.error('Error fetching session with recording:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error fetching session with recording:', error);
    return null;
  }
}











