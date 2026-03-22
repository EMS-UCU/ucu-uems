import { JitsiMeeting } from '@jitsi/react-sdk';
import { memo, useCallback, useMemo } from 'react';

const JITSI_ROOM = 'ucu-uems-vetting-main';
const JITSI_DOMAIN = 'meet.jit.si';

interface VettingConferenceProps {
  currentUserName?: string | null;
  currentUserId?: string | null;
  paperId?: string | null;
  enabledVetters: string[];
  isVetter: boolean;
  isChiefExaminer: boolean;
}

function VettingConferenceInner({
  currentUserName,
  currentUserId,
  enabledVetters,
  isVetter,
  isChiefExaminer,
}: VettingConferenceProps) {
  const canJoin = useMemo(() => {
    if (!currentUserId) return false;
    if (isChiefExaminer) return true;
    if (isVetter) return true;
    if (enabledVetters && enabledVetters.length > 0) {
      return enabledVetters.includes(currentUserId);
    }
    return false;
  }, [currentUserId, enabledVetters, isVetter, isChiefExaminer]);

  const displayName = (currentUserName || 'Participant').trim();

  // Stable identities — new literals every parent render make @jitsi/react-sdk tear down and reload the iframe.
  const userInfo = useMemo(() => ({ displayName }), [displayName]);

  const configOverwrite = useMemo(
    () => ({
      startWithAudioMuted: true,
      prejoinPageEnabled: false,
    }),
    []
  );

  const interfaceConfigOverwrite = useMemo(
    () => ({
      HIDE_INVITE_MORE_HEADER: true,
    }),
    []
  );

  const getIFrameRef = useCallback((node: HTMLIFrameElement | null) => {
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
  }, [isChiefExaminer]);

  if (!canJoin) {
    return null;
  }

  const containerClassName = isChiefExaminer
    ? 'mt-4 rounded-xl border border-slate-300 bg-slate-900/90 overflow-hidden'
    : 'fixed bottom-4 right-4 z-40 w-80 h-56 rounded-xl border border-slate-300 bg-slate-900/95 overflow-hidden shadow-2xl';

  return (
    <div className={containerClassName}>
      <JitsiMeeting
        key="ucu-uems-vetting-jitsi"
        roomName={JITSI_ROOM}
        domain={JITSI_DOMAIN}
        userInfo={userInfo}
        configOverwrite={configOverwrite}
        interfaceConfigOverwrite={interfaceConfigOverwrite}
        getIFrameRef={getIFrameRef}
      />
    </div>
  );
}

function vettersEqual(a: string[], b: string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export const VettingConference = memo(VettingConferenceInner, (prev, next) => {
  return (
    prev.currentUserId === next.currentUserId &&
    prev.isChiefExaminer === next.isChiefExaminer &&
    prev.isVetter === next.isVetter &&
    (prev.currentUserName || '') === (next.currentUserName || '') &&
    vettersEqual(prev.enabledVetters, next.enabledVetters)
  );
});
