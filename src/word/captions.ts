import { liveRegionAnnouncer, LiveRegionPoliteness } from "../core/accessibility";
import { CaptionSegmentStatus, type CaptionSegment } from "../core/types";
import type { LocalStore } from "../core/local-store";

export const supportedCaptionLanguages = [
  ["en-US", "English (United States)"],
  ["es-ES", "Español"],
  ["fr-FR", "Français"],
  ["sw-KE", "Kiswahili"],
  ["pt-BR", "Português (Brasil)"]
] as const;

export class OnDeviceTranscriber {
  language = "en-US";
  private recognition: SpeechRecognition | null = null;

  configure(language: string): void { this.language = language; }

  isAvailable(): boolean {
    return Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition);
  }

  start(speakerId: string, speakerName: string, emit: (segment: CaptionSegment) => void): void {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) throw new DOMException("On-device transcription is unavailable.", "NotSupportedError");
    this.recognition = new Recognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = this.language;
    this.recognition.processLocally = true;
    this.recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result) continue;
        const text = result?.[0]?.transcript?.trim();
        if (!text) continue;
        emit({
          speakerId,
          speakerName,
          text,
          status: result.isFinal ? CaptionSegmentStatus.Finalized : CaptionSegmentStatus.InProgress
        });
      }
    };
    this.recognition.onend = () => this.recognition?.start();
    this.recognition.start();
  }

  push(_frame: AudioData): void {
    // The browser's local speech runtime taps the selected audio source directly.
  }

  stop(): void {
    const recognition = this.recognition;
    this.recognition = null;
    recognition?.stop();
  }
}

export class CaptionController {
  enabled: boolean;
  language: string;
  private onSegmentListener: ((segment: CaptionSegment) => void) | null = null;

  constructor(private readonly transcriber: OnDeviceTranscriber, private readonly store: LocalStore) {
    const settings = store.loadSettings();
    this.enabled = settings.captionsEnabled;
    this.language = settings.captionLanguage;
  }

  start(speakerId: string, speakerName: string, listener: (segment: CaptionSegment) => void): void {
    if (!this.enabled || !this.transcriber.isAvailable()) return;
    this.onSegmentListener = listener;
    this.transcriber.configure(this.language);
    this.transcriber.start(speakerId, speakerName, (segment) => this.onSegment(segment));
  }

  onAudioFrame(frame: AudioData): void { if (this.enabled) this.transcriber.push(frame); }

  onSegment(segment: CaptionSegment): void {
    this.onSegmentListener?.(segment);
    if (segment.status === CaptionSegmentStatus.Finalized) {
      liveRegionAnnouncer.announce(`${segment.speakerName}: ${segment.text}`, LiveRegionPoliteness.Polite);
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    const settings = this.store.loadSettings();
    this.store.saveSettings({ ...settings, captionsEnabled: on });
    if (!on) this.stop();
  }

  setLanguage(code: string): void {
    if (!supportedCaptionLanguages.some(([language]) => language === code)) throw new RangeError("Unsupported caption language.");
    this.language = code;
    this.transcriber.configure(code);
    const settings = this.store.loadSettings();
    this.store.saveSettings({ ...settings, captionLanguage: code });
  }

  stop(): void { this.transcriber.stop(); }
}
