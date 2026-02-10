import { supabase } from '../supabase';
import type { WorkflowTimelineEntry } from '../supabase';

// Add a workflow timeline event
export async function addWorkflowEvent(data: {
  exam_paper_id: string;
  actor_id?: string;
  action: string;
  description?: string;
  from_status?: string;
  to_status?: string;
  metadata?: Record<string, any>;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('workflow_timeline')
      .insert({
        ...data,
        metadata: data.metadata ? JSON.stringify(data.metadata) : null,
      });

    if (error) {
      console.error('Error adding workflow event:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Get workflow timeline for an exam paper
export async function getWorkflowTimeline(
  examPaperId: string
): Promise<WorkflowTimelineEntry[]> {
  try {
    const { data, error } = await supabase
      .from('workflow_timeline')
      .select('*')
      .eq('exam_paper_id', examPaperId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching workflow timeline:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching workflow timeline:', error);
    return [];
  }
}

// Get workflow timeline with user names
export async function getWorkflowTimelineWithUsers(
  examPaperId: string
): Promise<(WorkflowTimelineEntry & { actor_name?: string })[]> {
  try {
    const { data: timeline, error } = await supabase
      .from('workflow_timeline')
      .select('*')
      .eq('exam_paper_id', examPaperId)
      .order('created_at', { ascending: false });

    if (error || !timeline) {
      console.error('Error fetching workflow timeline:', error);
      return [];
    }

    // Get unique actor IDs
    const actorIds = timeline
      .map((t) => t.actor_id)
      .filter((id): id is string => Boolean(id));

    if (actorIds.length === 0) {
      return timeline;
    }

    // Fetch user names
    const { data: users } = await supabase
      .from('users')
      .select('id, name')
      .in('id', actorIds);

    const userMap = new Map(users?.map((u) => [u.id, u.name]) || []);

    // Add actor names to timeline
    return timeline.map((entry) => ({
      ...entry,
      actor_name: entry.actor_id ? userMap.get(entry.actor_id) : undefined,
    }));
  } catch (error) {
    console.error('Error fetching workflow timeline with users:', error);
    return [];
  }
}











