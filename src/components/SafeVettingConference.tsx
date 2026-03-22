import { Component, type ErrorInfo, type ReactNode } from 'react';
import { VettingConference } from './VettingConference';

interface SafeVettingConferenceProps {
  currentUserName?: string | null;
  currentUserId?: string | null;
  paperId?: string | null;
  enabledVetters: string[];
  isVetter: boolean;
  isChiefExaminer: boolean;
  visibleForUser: boolean;
}

interface SafeVettingConferenceState {
  hasError: boolean;
}

export class SafeVettingConference extends Component<
  SafeVettingConferenceProps,
  SafeVettingConferenceState
> {
  state: SafeVettingConferenceState = {
    hasError: false,
  };

  static getDerivedStateFromError(): SafeVettingConferenceState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('Vetting conference error:', error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return null;
    }

    const { visibleForUser, ...conferenceProps } = this.props;
    if (!visibleForUser) {
      return null;
    }

    return <VettingConference {...conferenceProps} />;
  }
}
