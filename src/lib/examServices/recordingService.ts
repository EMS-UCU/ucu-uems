import { supabase } from '../supabase';

const STORAGE_BUCKET = 'vetting_recordings';

/**
 * Upload video recording to Supabase Storage
 * @param videoBlob - The video blob from MediaRecorder
 * @param sessionId - The vetting session ID
 * @param examPaperId - The exam paper ID
 * @returns Object with recording URL and file path, or error
 */
export async function uploadVettingRecording(
  videoBlob: Blob,
  sessionId: string,
  examPaperId: string
): Promise<{ 
  recordingUrl?: string; 
  filePath?: string; 
  fileSize?: number;
  error?: string 
}> {
  try {
    // Create a unique filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `${examPaperId}/${sessionId}-${timestamp}.webm`;
    const filePath = fileName;

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, videoBlob, {
        contentType: 'video/webm',
        upsert: false, // Don't overwrite existing files
      });

    if (error) {
      console.error('Error uploading recording:', error);
      return { error: error.message };
    }

    // Get public URL for the uploaded file
    const { data: urlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(filePath);

    const recordingUrl = urlData.publicUrl;
    const fileSize = videoBlob.size;

    return {
      recordingUrl,
      filePath,
      fileSize,
    };
  } catch (error: any) {
    console.error('Error in uploadVettingRecording:', error);
    return { error: error.message || 'Failed to upload recording' };
  }
}

/**
 * Get a signed URL for viewing a recording (for private bucket access)
 * @param filePath - The storage path to the recording
 * @param expiresIn - URL expiration time in seconds (default: 1 hour)
 * @returns Signed URL or error
 */
export async function getRecordingSignedUrl(
  filePath: string,
  expiresIn: number = 3600
): Promise<{ url?: string; error?: string }> {
  try {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(filePath, expiresIn);

    if (error) {
      return { error: error.message };
    }

    return { url: data.signedUrl };
  } catch (error: any) {
    return { error: error.message || 'Failed to get signed URL' };
  }
}

/**
 * Delete a recording from storage
 * @param filePath - The storage path to the recording
 * @returns Success status or error
 */
export async function deleteRecording(
  filePath: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .remove([filePath]);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to delete recording' };
  }
}

