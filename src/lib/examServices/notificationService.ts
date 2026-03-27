import { supabase } from '../supabase';
import type { Notification } from '../supabase';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isUuid = (value?: string | null): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

// Create a notification
export async function createNotification(data: {
  user_id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success' | 'deadline';
  related_exam_paper_id?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    if (!data.user_id || !data.title || !data.message) {
      return { success: false, error: 'Missing required notification fields' };
    }

    const payload = {
      ...data,
      ...(isUuid(data.related_exam_paper_id) ? {} : { related_exam_paper_id: undefined }),
    };

    console.log('📤 Creating notification:', { 
      user_id: data.user_id, 
      title: data.title,
      type: data.type 
    });

    // Use plain INSERT without .select() so RLS setups that allow INSERT
    // but restrict SELECT still work reliably. Retry once for transient failures.
    let lastError: any = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const { error } = await supabase
        .from('notifications')
        .insert(payload);

      if (!error) {
        console.log('✅ Notification created successfully');
        return { success: true };
      }

      lastError = error;
      console.error(`❌ Error creating notification (attempt ${attempt}/2):`, {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        data: data,
      });

      if (attempt < 2) {
        await sleep(200);
      }
    }

    return { success: false, error: lastError?.message || 'Failed to create notification' };
  } catch (error: any) {
    console.error('❌ Exception creating notification:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

// Get notifications for a user
export async function getUserNotifications(
  userId: string,
  unreadOnly: boolean = false
): Promise<Notification[]> {
  try {
    let query = supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (unreadOnly) {
      query = query.eq('is_read', false);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching notifications:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching notifications:', error);
    return [];
  }
}

// Mark notification as read
export async function markNotificationAsRead(
  notificationId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Mark all notifications as read for a user
export async function markAllNotificationsAsRead(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Delete notification
export async function deleteNotification(
  notificationId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', notificationId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Clear all notifications for a user
export async function clearAllNotifications(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('user_id', userId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Get unread notification count
export async function getUnreadCount(userId: string): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) {
      console.error('Error fetching unread count:', error);
      return 0;
    }

    return count || 0;
  } catch (error) {
    console.error('Error fetching unread count:', error);
    return 0;
  }
}











