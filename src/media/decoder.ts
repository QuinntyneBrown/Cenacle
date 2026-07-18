import { LatencyBudget, LatencyMeter } from "../core/performance";
import type { EncodedMediaPacket } from "./codec";

export class FrameRenderer {
  private context: CanvasRenderingContext2D | null;
  private callback: (() => void) | null = null;

  constructor(readonly surface: HTMLCanvasElement) {
    this.context = surface.getContext("2d", { alpha: false, desynchronized: true });
  }

  render(frame: VideoFrame): void {
    requestAnimationFrame(() => {
      if (!this.context) return;
      this.surface.width = frame.displayWidth;
      this.surface.height = frame.displayHeight;
      this.context.drawImage(frame, 0, 0);
      frame.close();
      this.callback?.();
    });
  }

  showCameraOff(): void {
    if (!this.context) return;
    this.context.fillStyle = "#0e1b2a";
    this.context.fillRect(0, 0, this.surface.width, this.surface.height);
    this.context.fillStyle = "#f6ce8b";
    this.context.textAlign = "center";
    this.context.fillText("Camera off", this.surface.width / 2, this.surface.height / 2);
  }

  onFrame(callback: () => void): void { this.callback = callback; }
}

export class MediaDecoderPipeline {
  private readonly decoders = new Map<string, VideoDecoder>();
  private readonly audioDecoders = new Map<string, AudioDecoder>();
  private readonly audio = new AudioPlayback();
  readonly latency = new LatencyMeter();
  readonly budget = new LatencyBudget();

  constructor(private readonly rendererFor: (participantId: string) => FrameRenderer | null) {}

  decode(packet: EncodedMediaPacket): void {
    if (packet.media === "audio") {
      this.decodeAudio(packet);
      return;
    }
    const sample = this.latency.measure(packet.captureTime, Date.now());
    if (this.budget.shouldDrop(sample) && !packet.key) return;
    let decoder = this.decoders.get(packet.participantId);
    if (!decoder) {
      decoder = new VideoDecoder({
        output: (frame) => this.rendererFor(packet.participantId)?.render(frame) ?? frame.close(),
        error: (error) => console.error("Video decoder", error)
      });
      decoder.configure({ codec: packet.codec, hardwareAcceleration: "prefer-hardware", optimizeForLatency: true });
      this.decoders.set(packet.participantId, decoder);
    }
    if (decoder.decodeQueueSize > 2 && !packet.key) return;
    decoder.decode(new EncodedVideoChunk({
      type: packet.key ? "key" : "delta",
      timestamp: packet.timestamp,
      duration: packet.duration ?? undefined,
      data: packet.data
    }));
  }

  close(): void {
    this.decoders.forEach((decoder) => decoder.close());
    this.audioDecoders.forEach((decoder) => decoder.close());
    this.decoders.clear();
    this.audioDecoders.clear();
    this.audio.close();
  }

  audioLevel(participantId: string): number { return this.audio.level(participantId); }

  private decodeAudio(packet: EncodedMediaPacket): void {
    let decoder = this.audioDecoders.get(packet.participantId);
    if (!decoder) {
      decoder = new AudioDecoder({
        output: (data) => this.audio.play(packet.participantId, data),
        error: (error) => console.error("Audio decoder", error)
      });
      decoder.configure({ codec: packet.codec, sampleRate: 48_000, numberOfChannels: 1 });
      this.audioDecoders.set(packet.participantId, decoder);
    }
    if (decoder.decodeQueueSize > 4) return;
    decoder.decode(new EncodedAudioChunk({
      type: packet.key ? "key" : "delta",
      timestamp: packet.timestamp,
      duration: packet.duration ?? undefined,
      data: packet.data
    }));
  }
}

export class AudioPlayback {
  readonly context = new AudioContext({ latencyHint: "interactive" });
  readonly output = this.context.createGain();
  private nextTime = 0;
  private readonly levels = new Map<string, number>();

  constructor() { this.output.connect(this.context.destination); }

  play(participantId: string, data: AudioData): void {
    const channels = data.numberOfChannels;
    const buffer = this.context.createBuffer(channels, data.numberOfFrames, data.sampleRate);
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const samples = new Float32Array(data.numberOfFrames);
      data.copyTo(samples, { planeIndex: channel, format: "f32-planar" });
      buffer.copyToChannel(samples, channel);
      for (const sample of samples) sum += sample * sample;
    }
    this.levels.set(participantId, Math.sqrt(sum / Math.max(1, data.numberOfFrames * channels)));
    data.close();
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.output);
    this.nextTime = Math.max(this.context.currentTime, Math.min(this.nextTime, this.context.currentTime + 0.1));
    source.start(this.nextTime);
    this.nextTime += buffer.duration;
  }

  level(participantId: string): number { return this.levels.get(participantId) ?? 0; }
  close(): void { void this.context.close(); }
}

export class ActiveSpeakerDetector {
  readonly threshold = 0.06;
  private speaking = false;

  update(level: number): void { this.speaking = level >= this.threshold; }
  isSpeaking(): boolean { return this.speaking; }
}
