import { JitsiMeeting } from '@jitsi/react-sdk';
import { useCallback, useMemo, useState } from 'react';

interface VettingConferenceProps {
  currentUserName?: string | null;
  currentUserId?: string | null;
  roomSeed?: string | null;
  enabledVetters: string[]; // user IDs allowed to join this call
  joinedVetters?: Array<{ id: string; name: string }>;
  isVetter: boolean;
  isChiefExaminer: boolean;
  compactMode?: boolean;
}

export function VettingConference({
  currentUserName,
  currentUserId,
  roomSeed,
  enabledVetters,
  joinedVetters = [],
  isVetter,
  isChiefExaminer,
  compactMode = false,
}: VettingConferenceProps) {
  const [participantNames, setParticipantNames] = useState<string[]>([]);

  // Only Chief Examiner and explicitly enabled vetters may join
  const canJoin = useMemo(() => {
    if (!currentUserId) return false;
    if (isChiefExaminer) return true;
    if (isVetter && enabledVetters.includes(currentUserId)) return true;
    return false;
  }, [currentUserId, enabledVetters, isVetter, isChiefExaminer]);

  const normalizedRoomSeed = roomSeed?.trim();

  const updateParticipantsFromApi = useCallback((api: any) => {
    try {
      const participants = (api?.getParticipantsInfo?.() ?? []) as Array<{ displayName?: string }>;
      const names = participants
        .map((participant) => participant.displayName?.trim())
        .filter((name): name is string => Boolean(name));
      setParticipantNames(Array.from(new Set(names)));
    } catch {
      // Non-blocking: do not fail the conference if participant listing is unavailable.
    }
  }, []);

  const localParticipantNames = useMemo(() => {
    const joinedNames = joinedVetters
      .map((vetter) => vetter.name?.trim())
      .filter((name): name is string => Boolean(name));
    return Array.from(new Set(joinedNames));
  }, [joinedVetters]);

  if (!canJoin || !normalizedRoomSeed) {
    return null;
  }

  const roomName = `ucu-uems-vetting-${normalizedRoomSeed}`;
  const displayName = currentUserName || 'Participant';

  return (
    <div
      className={
        compactMode
          ? 'fixed bottom-6 right-6 z-40 w-72 rounded-xl border border-slate-300 bg-slate-900/95 overflow-hidden shadow-2xl'
          : 'mt-4 rounded-xl border border-slate-300 bg-slate-900/90 overflow-hidden'
      }
    >
      {isChiefExaminer && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-700 bg-slate-950/80 px-3 py-2 text-xs text-slate-100">
          <span className="font-semibold text-emerald-300">Live vetters:</span>
          {localParticipantNames.length > 0 ? (
            localParticipantNames.map((name) => (
              <span key={name} className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-emerald-200">
                {name}
              </span>
            ))
          ) : (
            <span className="text-slate-300">Waiting for vetters to join...</span>
          )}
          {participantNames.length > 0 && (
            <span className="ml-auto rounded-full bg-blue-500/20 px-2 py-0.5 text-blue-200">
              In call: {participantNames.length}
            </span>
          )}
        </div>
      )}
      <JitsiMeeting
        roomName={roomName}
        domain="meet.jit.si"
        userInfo={{
          displayName,
          email: `${(currentUserId || 'participant').replace(/[^a-zA-Z0-9_-]/g, '')}@ucu-uems.local`,
        }}
        configOverwrite={{
          startWithAudioMuted: true,
          prejoinPageEnabled: false,
          disableModeratorIndicator: true,
        }}
        interfaceConfigOverwrite={{
          HIDE_INVITE_MORE_HEADER: true,
          SHOW_JITSI_WATERMARK: false,
          SHOW_WATERMARK_FOR_GUESTS: false,
          DEFAULT_REMOTE_DISPLAY_NAME: 'Vetter',
          DEFAULT_LOCAL_DISPLAY_NAME: displayName,
        }}
        onApiReady={(api) => {
          updateParticipantsFromApi(api);
          api.addListener?.('participantJoined', () => updateParticipantsFromApi(api));
          api.addListener?.('participantLeft', () => updateParticipantsFromApi(api));
          api.addListener?.('videoConferenceJoined', () => updateParticipantsFromApi(api));
        }}
        getIFrameRef={(node) => {
          if (node) {
            node.style.height = compactMode ? '190px' : '420px';
            node.style.width = '100%';
          }
        }}
      />
    </div>
  );
}

