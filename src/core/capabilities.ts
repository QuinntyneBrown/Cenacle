export enum Capability {
  WebTransport = "WebTransport",
  WebCodecs = "WebCodecs",
  WebGPU = "WebGPU",
  OnDeviceAI = "On-device AI"
}

export enum CapabilityState {
  Available = "available",
  Unavailable = "unavailable"
}

export enum PresenceDecision {
  Live = "live",
  Unsupported = "unsupported"
}

export enum WordDecision {
  Enabled = "enabled",
  Hidden = "hidden"
}

export enum SanctuaryDecision {
  GpuBackdrop = "gpu-backdrop",
  StillBackdrop = "still-backdrop"
}

export class CapabilityReport {
  constructor(readonly states: ReadonlyMap<Capability, CapabilityState>) {}

  stateOf(capability: Capability): CapabilityState {
    return this.states.get(capability) ?? CapabilityState.Unavailable;
  }

  presenceReady(): boolean {
    return [Capability.WebTransport, Capability.WebCodecs].every(
      (capability) => this.stateOf(capability) === CapabilityState.Available
    );
  }

  wordReady(): boolean {
    return this.stateOf(Capability.OnDeviceAI) === CapabilityState.Available;
  }

  visualsReady(): boolean {
    return this.stateOf(Capability.WebGPU) === CapabilityState.Available;
  }

  availableCount(): number {
    return [...this.states.values()].filter((state) => state === CapabilityState.Available).length;
  }
}

export interface DegradationPlan {
  presence: PresenceDecision;
  word: WordDecision;
  sanctuary: SanctuaryDecision;
}

type PromptWindow = Window & {
  LanguageModel?: { availability?: () => Promise<string> };
  ai?: { languageModel?: { capabilities?: () => Promise<{ available?: string }> } };
};

export class CapabilityDetector {
  async detect(): Promise<CapabilityReport> {
    const probes = await Promise.allSettled([
      this.probeWebTransport(),
      this.probeWebCodecs(),
      this.probeWebGpu(),
      this.probeOnDeviceAi()
    ]);
    const capabilities = Object.values(Capability);
    return new CapabilityReport(
      new Map(
        capabilities.map((capability, index) => [
          capability,
          probes[index]?.status === "fulfilled" && probes[index].value
            ? CapabilityState.Available
            : CapabilityState.Unavailable
        ])
      )
    );
  }

  private async probeWebTransport(): Promise<boolean> {
    return typeof window.WebTransport === "function";
  }

  private async probeWebCodecs(): Promise<boolean> {
    return typeof window.VideoEncoder === "function" && typeof window.VideoDecoder === "function";
  }

  private async probeWebGpu(): Promise<boolean> {
    return "gpu" in navigator && Boolean(await navigator.gpu?.requestAdapter());
  }

  private async probeOnDeviceAi(): Promise<boolean> {
    const promptWindow = window as PromptWindow;
    if (promptWindow.LanguageModel?.availability) {
      const state = await promptWindow.LanguageModel.availability();
      return state !== "unavailable";
    }
    if (promptWindow.ai?.languageModel?.capabilities) {
      const result = await promptWindow.ai.languageModel.capabilities();
      return result.available !== "no";
    }
    return false;
  }
}

export class DegradationPolicy {
  evaluate(report: CapabilityReport): DegradationPlan {
    return {
      presence: report.presenceReady() ? PresenceDecision.Live : PresenceDecision.Unsupported,
      word: report.wordReady() ? WordDecision.Enabled : WordDecision.Hidden,
      sanctuary: report.visualsReady()
        ? SanctuaryDecision.GpuBackdrop
        : SanctuaryDecision.StillBackdrop
    };
  }
}

export enum RecoveryState {
  PermissionBlocked = "permission-blocked",
  DeviceInUse = "device-in-use",
  DeviceMissing = "device-missing"
}

export class DeviceRecoveryResolver {
  resolve(error: DOMException): RecoveryState {
    if (["NotAllowedError", "SecurityError"].includes(error.name)) {
      return RecoveryState.PermissionBlocked;
    }
    if (["NotReadableError", "AbortError"].includes(error.name)) {
      return RecoveryState.DeviceInUse;
    }
    return RecoveryState.DeviceMissing;
  }

  joinWithCameraOff(microphoneId?: string): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      video: false,
      audio: microphoneId ? { deviceId: { exact: microphoneId } } : true
    });
  }
}
