import { JitsiMeeting } from '@jitsi/react-sdk';
import { useMemo } from 'react';

interface VettingConferenceProps {
  currentUserName?: string | null;
  currentUserId?: string | null;
  paperId?: string | null;
  enabledVetters: string[]; // user IDs allowed to join this call
  isVetter: boolean;
  isChiefExaminer: boolean;
}

export function VettingConference({
  currentUserName,
  currentUserId,
  paperId,
  enabledVetters,
  isVetter,
  isChiefExaminer,
}: VettingConferenceProps) {
  // Only Chief Examiner and explicitly enabled vetters may join
  const canJoin = useMemo(() => {
    if (!currentUserId) return false;
    if (isChiefExaminer) return true;
    if (isVetter && enabledVetters.includes(currentUserId)) return true;
    return false;
  }, [currentUserId, enabledVetters, isVetter, isChiefExaminer]);

  if (!canJoin || !paperId) {
    return null;
  }

  const roomName = `ucu-uems-vetting-${paperId}`;
  const displayName = currentUserName || 'Participant';

  return (
    <div className="mt-4 rounded-xl border border-slate-300 bg-slate-900/90 overflow-hidden">
      <JitsiMeeting
        roomName={roomName}
        domain="meet.jit.si"
        userInfo={{
          displayName,
        }}
        configOverwrite={{
          startWithAudioMuted: true,
          prejoinPageEnabled: false,
        }}
        interfaceConfigOverwrite={{
          HIDE_INVITE_MORE_HEADER: true,
        }}
        getIFrameRef={(node) => {
          if (node) {
            node.style.height = '420px';
            node.style.width = '100%';
          }
        }}
      />
    </div>
  );
}

