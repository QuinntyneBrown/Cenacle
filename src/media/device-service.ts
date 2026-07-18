import type { DeviceInfo } from "../core/types";

export class MediaDeviceService {
  async enumerate(): Promise<DeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.map((device, index) => ({
      deviceId: device.deviceId,
      kind: device.kind,
      label: device.label || `${this.kindLabel(device.kind)} ${index + 1}`
    }));
  }

  acquire(cameraId?: string, microphoneId?: string, cameraEnabled = true, micEnabled = true): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      video: cameraEnabled ? (cameraId ? { deviceId: { exact: cameraId } } : true) : false,
      audio: micEnabled ? (microphoneId ? { deviceId: { exact: microphoneId } } : true) : false
    });
  }

  acquireMicrophone(microphoneId?: string): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      video: false,
      audio: microphoneId ? { deviceId: { exact: microphoneId } } : true
    });
  }

  stop(stream?: MediaStream | null): void {
    stream?.getTracks().forEach((track) => track.stop());
  }

  private kindLabel(kind: MediaDeviceKind): string {
    if (kind === "videoinput") return "Camera";
    if (kind === "audioinput") return "Microphone";
    return "Speaker";
  }
}

export class MicTest {
  levelDb = -Infinity;
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private frame = 0;

  async start(microphoneId: string | undefined, onLevel: (db: number) => void): Promise<void> {
    this.stop();
    this.stream = await new MediaDeviceService().acquireMicrophone(microphoneId);
    this.context = new AudioContext({ latencyHint: "interactive" });
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 512;
    this.context.createMediaStreamSource(this.stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const update = () => {
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
      this.levelDb = rms > 0 ? Math.max(-96, 20 * Math.log10(rms)) : -Infinity;
      onLevel(this.levelDb);
      this.frame = requestAnimationFrame(update);
    };
    update();
  }

  isFlat(): boolean {
    return !Number.isFinite(this.levelDb) || this.levelDb < -72;
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.context?.close();
    this.stream = null;
    this.context = null;
  }
}
