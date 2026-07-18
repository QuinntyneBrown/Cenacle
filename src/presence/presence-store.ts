import type { LocalControlState, Participant, PresenceUpdate } from "../core/types";

export class PresenceStore {
  participants: Participant[] = [];
  localControls: LocalControlState = {
    micMuted: false,
    cameraOff: false,
    captionsOn: true,
    companionOpen: false
  };
  private readonly listeners = new Set<() => void>();

  get presentCount(): number { return this.participants.length; }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): { participants: Participant[]; localControls: LocalControlState; presentCount: number } {
    return {
      participants: structuredClone(this.participants),
      localControls: { ...this.localControls },
      presentCount: this.presentCount
    };
  }

  replaceParticipants(participants: Participant[]): void {
    this.participants = participants;
    this.notify();
  }

  setMuted(muted: boolean): void {
    this.localControls.micMuted = muted;
    this.updateSelf({ isMuted: muted });
  }

  setCameraOff(off: boolean): void {
    this.localControls.cameraOff = off;
    this.updateSelf({ isCameraOff: off });
  }

  setCaptionsOn(on: boolean): void {
    this.localControls.captionsOn = on;
    this.notify();
  }

  setCompanionOpen(open: boolean): void {
    this.localControls.companionOpen = open;
    this.notify();
  }

  applyRelayed(update: PresenceUpdate): void {
    this.participants = this.participants.map((participant) =>
      participant.id === update.participantId
        ? {
            ...participant,
            isMuted: update.isMuted,
            isCameraOff: update.isCameraOff,
            isSpeaking: update.isSpeaking ?? participant.isSpeaking
          }
        : participant
    );
    this.notify();
  }

  remove(participantId: string): void {
    this.participants = this.participants.filter((participant) => participant.id !== participantId);
    this.notify();
  }

  private updateSelf(update: Partial<Participant>): void {
    this.participants = this.participants.map((participant) => participant.isSelf ? { ...participant, ...update } : participant);
    this.notify();
  }

  private notify(): void { this.listeners.forEach((listener) => listener()); }
}
