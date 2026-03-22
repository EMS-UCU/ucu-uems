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
  enabledVetters,
  isVetter,
  isChiefExaminer,
}: VettingConferenceProps) {
  // Chief Examiner and vetters both join the Jitsi conference so tiles appear for Chief.
  const canJoin = useMemo(() => {
    if (!currentUserId) return false;
    if (isChiefExaminer) return true;
    if (isVetter) return true;
    if (enabledVetters && enabledVetters.length > 0) {
      return enabledVetters.includes(currentUserId);
    }
    return false;
  }, [currentUserId, enabledVetters, isVetter, isChiefExaminer]);

  if (!canJoin) {
    return null;
  }

  // Shared room so Chief Examiner and all vetters land in the same conference.
  const roomName = 'ucu-uems-vetting-main';
  const displayName = currentUserName || 'Participant';

  const containerClassName = isChiefExaminer
    ? 'mt-4 rounded-xl border border-slate-300 bg-slate-900/90 overflow-hidden'
    : 'fixed bottom-4 right-4 z-40 w-80 h-56 rounded-xl border border-slate-300 bg-slate-900/95 overflow-hidden shadow-2xl';

  return (
    <div className={containerClassName}>
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
          if (!node) return;
          node.setAttribute(
            'allow',
            'camera; microphone; fullscreen; display-capture; autoplay; clipboard-write;'
          );
          if (isChiefExaminer) {
            node.style.height = '420px';
            node.style.width = '100%';
          } else {
            node.style.height = '224px';
            node.style.width = '320px';
          }
        }}
      />
    </div>
  );
}
