import type { DownloadProgress } from "../core/types";

export enum AiCapability {
  Unsupported = "unsupported",
  Downloadable = "downloadable",
  Downloading = "downloading",
  Ready = "ready"
}

export class CapabilityStore {
  current = AiCapability.Unsupported;
  private readonly listeners = new Set<(capability: AiCapability) => void>();

  set(capability: AiCapability): void {
    this.current = capability;
    this.listeners.forEach((listener) => listener(capability));
  }

  subscribe(listener: (capability: AiCapability) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isReady(): boolean { return this.current === AiCapability.Ready; }
}

export class OnDeviceModel {
  async availability(): Promise<AiCapability> {
    if (window.LanguageModel?.availability) {
      const state = await window.LanguageModel.availability();
      return {
        available: AiCapability.Ready,
        downloadable: AiCapability.Downloadable,
        downloading: AiCapability.Downloading,
        unavailable: AiCapability.Unsupported
      }[state];
    }
    if (window.ai?.languageModel?.capabilities) {
      const capability = await window.ai.languageModel.capabilities();
      if (capability.available === "readily") return AiCapability.Ready;
      if (capability.available === "after-download") return AiCapability.Downloadable;
    }
    return AiCapability.Unsupported;
  }

  async createSession(systemPrompt?: string): Promise<LanguageModelSession> {
    const options = systemPrompt
      ? { initialPrompts: [{ role: "system" as const, content: systemPrompt }] }
      : undefined;
    if (window.LanguageModel) return window.LanguageModel.create(options);
    if (window.ai?.languageModel) return window.ai.languageModel.create(options);
    throw new DOMException("The on-device model is unavailable.", "NotSupportedError");
  }

  async prompt(input: string, systemPrompt?: string): Promise<string> {
    const session = await this.createSession(systemPrompt);
    try {
      return await session.prompt(input);
    } finally {
      session.destroy();
    }
  }

  async download(onProgress: (progress: DownloadProgress) => void): Promise<void> {
    if (!window.LanguageModel) throw new DOMException("Model download is unavailable.", "NotSupportedError");
    const total = 1_900_000_000;
    const started = performance.now();
    const session = await window.LanguageModel.create({
      monitor(monitor) {
        monitor.addEventListener("downloadprogress", (event) => {
          const loaded = Math.min(1, Number((event as Event & { loaded?: number }).loaded ?? 0));
          const elapsed = Math.max(1, (performance.now() - started) / 1000);
          const remaining = loaded > 0 ? elapsed * (1 - loaded) / loaded : 0;
          onProgress({
            bytesTotal: total,
            bytesDone: Math.round(total * loaded),
            percent: Math.round(loaded * 100),
            etaSeconds: Math.round(remaining)
          });
        });
      }
    });
    session.destroy();
  }

  remove(): void {
    // The Prompt API currently delegates model removal to browser settings.
    // The UI links there and immediately re-checks availability.
  }
}

export class AiCapabilityDetector {
  constructor(private readonly model: OnDeviceModel, private readonly store: CapabilityStore) {}
  async detect(): Promise<AiCapability> {
    const capability = await this.model.availability().catch(() => AiCapability.Unsupported);
    this.store.set(capability);
    return capability;
  }
}

export class ModelDownloadController {
  background = false;
  constructor(private readonly model: OnDeviceModel, private readonly store: CapabilityStore) {}

  async start(onProgress: (progress: DownloadProgress) => void): Promise<void> {
    this.store.set(AiCapability.Downloading);
    await this.model.download(onProgress);
    this.store.set(AiCapability.Ready);
  }

  continueInBackground(): void { this.background = true; }
}

export class ModelManager {
  readonly sizeBytes = 1_900_000_000;
  constructor(private readonly model: OnDeviceModel, private readonly store: CapabilityStore) {}
  async status(): Promise<{ ready: boolean; sizeBytes: number }> {
    return { ready: (await this.model.availability()) === AiCapability.Ready, sizeBytes: this.sizeBytes };
  }
  async recheck(): Promise<AiCapability> {
    const state = await this.model.availability();
    this.store.set(state);
    return state;
  }
  remove(): void {
    this.model.remove();
    this.store.set(AiCapability.Downloadable);
  }
}

export const aiCapabilityStore = new CapabilityStore();
export const onDeviceModel = new OnDeviceModel();
