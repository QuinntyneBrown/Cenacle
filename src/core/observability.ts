export enum FailureKind {
  Permission = "permission",
  Device = "device",
  Transport = "transport",
  Capability = "capability",
  Model = "model",
  Unexpected = "unexpected"
}

export enum DefinedState {
  Reconnecting = "reconnecting",
  RoomFull = "room-full",
  RoomNotFound = "room-not-found",
  UnsupportedBrowser = "unsupported-browser",
  AiUnavailable = "ai-unavailable",
  StillBackdrop = "still-backdrop",
  DeviceError = "device-error",
  ConnectionError = "connection-error",
  RecoverableError = "recoverable-error"
}

export interface ClientFailure {
  kind: FailureKind;
  code: string;
}

export interface OperationalEvent {
  name: OperationalEventName;
  value: number;
  at: number;
}

export type OperationalEventName =
  | "app_interactive_ms"
  | "origin_connect"
  | "origin_disconnect"
  | "reconnect_attempt"
  | "latency_ms"
  | "frame_budget_exceeded"
  | "unexpected_error";

export class DefinedStateRouter {
  route(failure: ClientFailure): DefinedState {
    const byCode: Record<string, DefinedState> = {
      ROOM_FULL: DefinedState.RoomFull,
      ROOM_NOT_FOUND: DefinedState.RoomNotFound,
      ORIGIN_UNREACHABLE: DefinedState.ConnectionError,
      AI_UNAVAILABLE: DefinedState.AiUnavailable,
      WEBGPU_UNAVAILABLE: DefinedState.StillBackdrop
    };
    const codedState = byCode[failure.code];
    if (codedState) return codedState;
    const byKind: Record<FailureKind, DefinedState> = {
      [FailureKind.Permission]: DefinedState.DeviceError,
      [FailureKind.Device]: DefinedState.DeviceError,
      [FailureKind.Transport]: DefinedState.Reconnecting,
      [FailureKind.Capability]: DefinedState.UnsupportedBrowser,
      [FailureKind.Model]: DefinedState.AiUnavailable,
      [FailureKind.Unexpected]: DefinedState.RecoverableError
    };
    return byKind[failure.kind];
  }
}

/** Fixed-schema telemetry; callers cannot attach text, identifiers, or arbitrary fields. */
export class TelemetryClient {
  private queue: OperationalEvent[] = [];

  constructor(private readonly endpoint: string) {}

  record(name: OperationalEventName, value: number): void {
    this.queue.push({ name, value, at: Date.now() });
  }

  async flush(): Promise<void> {
    if (!this.queue.length) return;
    const events = this.queue.splice(0, this.queue.length);
    try {
      await fetch(`${this.endpoint}/api/telemetry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events }),
        keepalive: true
      });
    } catch {
      this.queue.unshift(...events.slice(-50));
    }
  }
}

export enum OriginHealth {
  Reachable = "reachable",
  Unreachable = "unreachable"
}

export class OriginMonitor {
  constructor(readonly origin: string, readonly intervalMs = 15_000) {}

  async probe(signal?: AbortSignal): Promise<OriginHealth> {
    try {
      const response = await fetch(`${this.origin}/healthz`, { signal, cache: "no-store" });
      return response.ok ? OriginHealth.Reachable : OriginHealth.Unreachable;
    } catch {
      return OriginHealth.Unreachable;
    }
  }
}
