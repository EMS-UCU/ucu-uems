# Vetting Session Video Recording Implementation

This document describes the implementation of video recording storage for vetting sessions for audit purposes.

## Overview

Video recordings of vetting sessions are now automatically captured, stored in Supabase Storage, and can be retrieved by the Chief Examiner for audit purposes.

## Components

### 1. Database Schema (`add_vetting_recording_storage.sql`)

Added the following columns to the `vetting_sessions` table:
- `recording_url` - Public/private URL to the video recording
- `recording_file_path` - Storage path in Supabase Storage
- `recording_file_size` - Size of the recording file in bytes
- `recording_duration_seconds` - Duration of the recording
- `recording_started_at` - Timestamp when recording started
- `recording_completed_at` - Timestamp when recording completed

### 2. Recording Service (`src/lib/examServices/recordingService.ts`)

Service functions for handling video recordings:
- `uploadVettingRecording()` - Uploads video blob to Supabase Storage
- `getRecordingSignedUrl()` - Gets signed URL for private bucket access
- `deleteRecording()` - Deletes a recording from storage

### 3. Vetting Service Updates (`src/lib/examServices/vettingService.ts`)

Updated functions:
- `completeVettingSession()` - Now accepts optional recording data and stores it in the database
- `getVettingSessionsWithRecordings()` - Retrieves sessions that have recordings
- `getVettingSessionWithRecording()` - Gets a specific session with recording info

### 4. Chief Examiner Service (`src/lib/examServices/chiefExaminerService.ts`)

New functions for Chief Examiner:
- `getVettingRecordings()` - Gets all recordings for a Chief Examiner
- `getRecordingUrl()` - Gets viewing URL for a specific recording (with signed URL support)

### 5. Frontend Implementation (`src/App.tsx`)

Recording functionality:
- MediaRecorder instances are created for each vetter when they join the session
- Recording starts automatically when camera access is granted
- Recording stops and uploads when a vetter completes the session
- Recordings are stored with metadata (duration, file size, timestamps)

## Setup Instructions

### 1. Run Database Migration

Execute `add_vetting_recording_storage.sql` in the Supabase SQL Editor to add the recording columns to the `vetting_sessions` table.

### 2. Create Storage Bucket

1. Go to Supabase Dashboard → Storage
2. Create a new bucket named `vetting-recordings`
3. Set it as **Private** (for security/audit purposes)
4. Set file size limit (recommended: 500MB or higher)

### 3. Configure Storage Policies

Create RLS policies for the storage bucket to allow:
- **Upload**: Authenticated users with Vetter role (during vetting session)
- **Read**: Authenticated users with Chief Examiner role

Example policies:
```sql
-- Allow authenticated users to upload recordings during vetting
CREATE POLICY "Allow vetting recording uploads"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'vetting-recordings' AND
  (storage.foldername(name))[1] IS NOT NULL
);

-- Allow Chief Examiners to read recordings
CREATE POLICY "Allow Chief Examiner to view recordings"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'vetting-recordings'
);
```

## Usage

### For Vetters

Vetters don't need to do anything special - recordings start automatically when they join a vetting session and stop when they complete it.

### For Chief Examiners

Chief Examiners can retrieve recordings using the service functions:

```typescript
import { getVettingRecordings, getRecordingUrl } from './lib/examServices/chiefExaminerService';

// Get all recordings for a Chief Examiner
const recordings = await getVettingRecordings(chiefExaminerId);

// Get viewing URL for a specific recording
const { url, error } = await getRecordingUrl(sessionId);
```

## Technical Details

### Recording Format
- Format: WebM (VP9 codec)
- Quality: 2.5 Mbps video bitrate
- Audio: Disabled (video only)
- Collection: Data collected every second during recording

### Storage Structure
Recordings are stored in Supabase Storage with the following structure:
```
vetting-recordings/
  {examPaperId}/
    {sessionId}-{timestamp}.webm
```

### Error Handling
- If recording fails to start, the session continues (monitoring is prioritized)
- If upload fails, an error is logged but doesn't prevent session completion
- Recording data is stored in the session record for later retrieval

## Future Enhancements

1. **UI for Chief Examiner**: Add a UI panel to view and download recordings
2. **Recording Playback**: Integrate video player in the Chief Examiner dashboard
3. **Multi-Vetter Recordings**: Support combining multiple vetter recordings
4. **Recording Compression**: Add client-side compression before upload
5. **Retention Policy**: Implement automatic deletion of old recordings

## Notes

- Recordings are automatically linked to vetting sessions in the database
- Each vetter has their own recording that starts when they join the session
- Recordings are stored in Supabase Storage for long-term audit purposes
- Signed URLs are used for private bucket access (1-hour expiration by default)

