export enum CodecPreference {
  H264 = "h264",
  VP9 = "vp9"
}

export enum ParticipantRole {
  Host = "host",
  Participant = "participant"
}

export enum ConnectionState {
  Live = "live",
  Dropped = "dropped",
  Reconnecting = "reconnecting",
  Closed = "closed"
}

export enum ReactionKind {
  Amen = "amen",
  RaisedHand = "raised-hand"
}

export interface Reaction {
  kind: ReactionKind;
  senderId: string;
  sentAt: number;
}

export interface Participant {
  id: string;
  displayName: string;
  role: ParticipantRole;
  isSelf: boolean;
  isMuted: boolean;
  isCameraOff: boolean;
  isSpeaking: boolean;
}

export interface LocalControlState {
  micMuted: boolean;
  cameraOff: boolean;
  captionsOn: boolean;
  companionOpen: boolean;
}

export interface PresenceUpdate {
  participantId: string;
  isMuted: boolean;
  isCameraOff: boolean;
  isSpeaking?: boolean;
}

export interface RoomCredential {
  code: string;
  token: string;
  expiresAt: number;
}

export interface Room {
  code: string;
  role: ParticipantRole;
  appOrigin: string;
  participantId: string;
  credential: RoomCredential;
}

export interface RoomSessionState {
  room: Room;
  displayName: string;
  roster: Participant[];
  controls: LocalControlState;
  connection: ConnectionState;
  latencyMs: number | null;
  captionLine: string;
}

export interface SettingsModel {
  cameraId: string;
  microphoneId: string;
  speakerId: string;
  codec: CodecPreference;
  captionsEnabled: boolean;
  captionLanguage: string;
  ambientVisualsEnabled: boolean;
  audioReactiveEnabled: boolean;
}

export const defaultSettings: SettingsModel = {
  cameraId: "",
  microphoneId: "",
  speakerId: "",
  codec: CodecPreference.H264,
  captionsEnabled: true,
  captionLanguage: "en-US",
  ambientVisualsEnabled: true,
  audioReactiveEnabled: true
};

export interface Passage {
  id: string;
  reference: string;
  text: string;
  contextUrl: string;
  themes: string[];
}

export interface MatchResult {
  matched: boolean;
  passage?: Passage;
  suggestions: string[];
}

export interface Reflection {
  text: string;
  illustrativeReference?: string;
  affirmation: string;
  isDirective: false;
}

export interface JournalEntry {
  id: string;
  text: string;
  createdAt: string;
  keptReflection?: Reflection;
}

export enum CaptionSegmentStatus {
  InProgress = "in-progress",
  Finalized = "finalized"
}

export interface CaptionSegment {
  speakerId: string;
  speakerName: string;
  text: string;
  status: CaptionSegmentStatus;
}

export interface DeviceInfo {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
}

export interface DownloadProgress {
  bytesTotal: number;
  bytesDone: number;
  percent: number;
  etaSeconds: number;
}

export function inviteLink(room: Pick<Room, "code" | "appOrigin">): string {
  return `${room.appOrigin.replace(/\/$/, "")}/r/${room.code}`;
}
