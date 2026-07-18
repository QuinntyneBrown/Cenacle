interface Window {
  WebTransport?: typeof WebTransport;
  VideoEncoder?: typeof VideoEncoder;
  VideoDecoder?: typeof VideoDecoder;
  AudioEncoder?: typeof AudioEncoder;
  AudioDecoder?: typeof AudioDecoder;
  MediaStreamTrackProcessor?: typeof MediaStreamTrackProcessor;
  LanguageModel?: LanguageModelFactory;
  ai?: { languageModel?: LegacyLanguageModelFactory };
  documentPictureInPicture?: {
    requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
  };
  SpeechRecognition?: typeof SpeechRecognition;
  webkitSpeechRecognition?: typeof SpeechRecognition;
}

interface LanguageModelFactory {
  availability(options?: unknown): Promise<"available" | "downloadable" | "downloading" | "unavailable">;
  create(options?: {
    initialPrompts?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    monitor?: (monitor: EventTarget) => void;
  }): Promise<LanguageModelSession>;
}

interface LanguageModelSession {
  prompt(input: string): Promise<string>;
  destroy(): void;
}

interface LegacyLanguageModelFactory {
  capabilities(): Promise<{ available?: string }>;
  create(options?: unknown): Promise<LanguageModelSession>;
}

declare class MediaStreamTrackProcessor<T extends VideoFrame | AudioData = VideoFrame> {
  constructor(options: { track: MediaStreamTrack; maxBufferSize?: number });
  readonly readable: ReadableStream<T>;
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

declare class SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  processLocally?: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface WebTransportOptions {
  allowPooling?: boolean;
  requireUnreliable?: boolean;
}
