import { CodecPreference } from "../core/types";

export interface CodecSelection {
  codec: CodecPreference;
  codecString: string;
  hardwareAccelerated: boolean;
  config: VideoEncoderConfig;
}

const CODECS: Record<CodecPreference, string> = {
  [CodecPreference.H264]: "avc1.42E01E",
  [CodecPreference.VP9]: "vp09.00.10.08"
};

export class CodecNegotiator {
  constructor(readonly preferred: CodecPreference) {}

  async negotiate(width = 1280, height = 720): Promise<CodecSelection> {
    const order = [this.preferred, ...Object.values(CodecPreference).filter((item) => item !== this.preferred)];
    for (const codec of order) {
      const hardware = await this.supportsHardware(codec, width, height);
      if (hardware) return this.selection(codec, width, height, true);
    }
    for (const codec of order) {
      const selection = this.selection(codec, width, height, false);
      if ((await VideoEncoder.isConfigSupported(selection.config)).supported) return selection;
    }
    throw new DOMException("No supported H.264 or VP9 encoder is available.", "NotSupportedError");
  }

  async supportsHardware(codec: CodecPreference, width = 1280, height = 720): Promise<boolean> {
    const selection = this.selection(codec, width, height, true);
    try {
      return Boolean((await VideoEncoder.isConfigSupported(selection.config)).supported);
    } catch {
      return false;
    }
  }

  private selection(codec: CodecPreference, width: number, height: number, hardware: boolean): CodecSelection {
    return {
      codec,
      codecString: CODECS[codec],
      hardwareAccelerated: hardware,
      config: {
        codec: CODECS[codec],
        width,
        height,
        bitrate: 1_200_000,
        framerate: 30,
        latencyMode: "realtime",
        hardwareAcceleration: hardware ? "prefer-hardware" : "no-preference",
        avc: codec === CodecPreference.H264 ? { format: "avc" } : undefined
      }
    };
  }
}

export interface EncodedMediaPacket {
  media: "video" | "audio";
  participantId: string;
  codec: string;
  timestamp: number;
  duration: number | null;
  key: boolean;
  captureTime: number;
  data: Uint8Array;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function serializeMediaPacket(packet: EncodedMediaPacket): Uint8Array {
  const header = encoder.encode(JSON.stringify({
    media: packet.media,
    participantId: packet.participantId,
    codec: packet.codec,
    timestamp: packet.timestamp,
    duration: packet.duration,
    key: packet.key,
    captureTime: packet.captureTime
  }));
  const output = new Uint8Array(4 + header.length + packet.data.length);
  new DataView(output.buffer).setUint32(0, header.length);
  output.set(header, 4);
  output.set(packet.data, 4 + header.length);
  return output;
}

export function deserializeMediaPacket(bytes: Uint8Array): EncodedMediaPacket {
  if (bytes.byteLength < 4) throw new TypeError("Media packet is too short.");
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0);
  if (headerLength > bytes.byteLength - 4) throw new TypeError("Media packet header is invalid.");
  const header = JSON.parse(decoder.decode(bytes.slice(4, 4 + headerLength))) as Omit<EncodedMediaPacket, "data">;
  return { ...header, data: bytes.slice(4 + headerLength) };
}

export class MediaEncoderPipeline {
  private video: VideoEncoder | null = null;
  private audio: AudioEncoder | null = null;
  private stopped = false;
  private audioEnabled = true;
  private videoEnabled = true;
  private readonly captureTimes = {
    audio: new Map<number, number>(),
    video: new Map<number, number>()
  };

  constructor(
    private readonly participantId: string,
    private readonly publish: (packet: EncodedMediaPacket) => Promise<void>,
    private readonly now: () => number = Date.now
  ) {}

  async start(stream: MediaStream, selection: CodecSelection): Promise<void> {
    this.stopped = false;
    const videoTrack = stream.getVideoTracks()[0];
    this.videoEnabled = Boolean(videoTrack?.enabled);
    if (videoTrack) {
      this.video = new VideoEncoder({
        output: (chunk) => void this.emitChunk("video", selection.codecString, chunk),
        error: (error) => console.error("Video encoder", error)
      });
      this.video.configure(selection.config);
      void this.processVideo(videoTrack);
    }
    const audioTrack = stream.getAudioTracks()[0];
    this.audioEnabled = Boolean(audioTrack?.enabled);
    if (audioTrack && typeof AudioEncoder === "function") {
      this.audio = new AudioEncoder({
        output: (chunk) => void this.emitChunk("audio", "opus", chunk),
        error: (error) => console.error("Audio encoder", error)
      });
      this.audio.configure({ codec: "opus", sampleRate: 48_000, numberOfChannels: 1, bitrate: 64_000 });
      void this.processAudio(audioTrack);
    }
  }

  stop(): void {
    this.stopped = true;
    this.video?.close();
    this.audio?.close();
    this.video = null;
    this.audio = null;
    this.captureTimes.video.clear();
    this.captureTimes.audio.clear();
  }

  setAudioEnabled(enabled: boolean): void { this.audioEnabled = enabled; }
  setVideoEnabled(enabled: boolean): void { this.videoEnabled = enabled; }

  private async processVideo(track: MediaStreamTrack): Promise<void> {
    const Processor = window.MediaStreamTrackProcessor;
    if (!Processor) throw new DOMException("Track processing is unavailable.", "NotSupportedError");
    const reader = new Processor<VideoFrame>({ track, maxBufferSize: 2 }).readable.getReader();
    let index = 0;
    try {
      while (!this.stopped) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        if (this.videoEnabled && (this.video?.encodeQueueSize ?? 0) < 2) {
          this.captureTimes.video.set(value.timestamp, this.now());
          this.video?.encode(value, { keyFrame: index++ % 60 === 0 });
        }
        value.close();
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async processAudio(track: MediaStreamTrack): Promise<void> {
    const Processor = window.MediaStreamTrackProcessor;
    if (!Processor) return;
    const reader = new Processor<AudioData>({ track, maxBufferSize: 4 }).readable.getReader();
    try {
      while (!this.stopped) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        if (this.audioEnabled && (this.audio?.encodeQueueSize ?? 0) < 4) {
          this.captureTimes.audio.set(value.timestamp, this.now());
          this.audio?.encode(value);
        }
        value.close();
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async emitChunk(media: "video" | "audio", codec: string, chunk: EncodedVideoChunk | EncodedAudioChunk): Promise<void> {
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    await this.publish({
      media,
      participantId: this.participantId,
      codec,
      timestamp: chunk.timestamp,
      duration: chunk.duration ?? null,
      key: chunk.type === "key",
      captureTime: this.captureTimes[media].get(chunk.timestamp) ?? this.now(),
      data
    });
    this.captureTimes[media].delete(chunk.timestamp);
  }
}
