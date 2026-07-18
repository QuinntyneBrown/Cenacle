import { DeviceRecoveryResolver, type DegradationPlan, PresenceDecision } from "../core/capabilities";
import { ConnectionState, ParticipantRole, type Room } from "../core/types";
import { CodecNegotiator, MediaEncoderPipeline } from "../media/codec";
import { MediaDeviceService } from "../media/device-service";
import { RoomTransport } from "../media/room-transport";
import { RoomApi } from "./room-api";

export class GatheringSetup {
  constructor(
    public name = "Evening prayer",
    public cameraId = "",
    public microphoneId = "",
    public captionsEnabled = true,
    public visualsEnabled = true
  ) {}

  hasValidName(): boolean { return this.name.trim().length >= 1 && this.name.trim().length <= 60; }
}

export class JoinConfig {
  constructor(public displayName = "", public micEnabled = true, public cameraEnabled = true) {}
  resolvedName(): string { return this.displayName.trim() || "Guest"; }
}

export class RoomResolver {
  constructor(private readonly api: RoomApi, private readonly sanitizer: { parseRoomReference(value: string): string }) {}
  extractCode(input: string): string { return this.sanitizer.parseRoomReference(input); }
  isWellFormed(code: string): boolean { return /^[A-HJ-NP-Z2-9]{6}$/.test(code); }
  async resolve(input: string): Promise<{ code: string; status: "open" | "not-found" }> {
    const code = this.extractCode(input);
    return { code, status: (await this.api.resolve(code)) ? "open" : "not-found" };
  }
}

export interface LiveRoomResources {
  room: Room;
  displayName: string;
  stream: MediaStream;
  transport: RoomTransport;
  encoder: MediaEncoderPipeline;
}

export class GoLiveController {
  readonly recovery = new DeviceRecoveryResolver();

  constructor(
    private readonly plan: DegradationPlan,
    private readonly api: RoomApi,
    private readonly devices: MediaDeviceService,
    private readonly roomOrigin: string
  ) {}

  async goLive(
    setup: GatheringSetup,
    hostName: string,
    preferredCodec: ConstructorParameters<typeof CodecNegotiator>[0],
    existingStream?: MediaStream,
    cameraEnabled = true
  ): Promise<LiveRoomResources> {
    if (this.plan.presence !== PresenceDecision.Live) {
      throw new DOMException("Live gatherings need WebTransport and WebCodecs.", "NotSupportedError");
    }
    if (!setup.hasValidName()) throw new RangeError("Name the gathering with 1–60 characters.");
    const transport = new RoomTransport(this.roomOrigin);
    const ownsStream = !existingStream;
    const stream = existingStream ?? await this.devices.acquire(setup.cameraId, setup.microphoneId, cameraEnabled, true);
    let room: Room | null = null;
    let encoder: MediaEncoderPipeline | null = null;
    try {
      room = await this.api.create(setup.name.trim(), hostName.trim() || "Host");
      await transport.open(room.credential, room.participantId, hostName.trim() || "Host", ParticipantRole.Host);
      encoder = new MediaEncoderPipeline(room.participantId, (packet) => transport.publish(packet), () => transport.roomNow());
      await encoder.start(stream, await new CodecNegotiator(preferredCodec).negotiate());
      return { room, displayName: hostName.trim() || "Host", stream, transport, encoder };
    } catch (error) {
      encoder?.stop();
      transport.close(1, "go-live failed");
      if (room) await this.api.end(room).catch(() => undefined);
      if (ownsStream) this.devices.stop(stream);
      throw error;
    }
  }
}

export class EnterRoomController {
  constructor(
    private readonly api: RoomApi,
    private readonly devices: MediaDeviceService,
    private readonly roomOrigin: string
  ) {}

  async enter(
    code: string,
    config: JoinConfig,
    preferredCodec: ConstructorParameters<typeof CodecNegotiator>[0],
    existingStream?: MediaStream
  ): Promise<LiveRoomResources> {
    const transport = new RoomTransport(this.roomOrigin);
    const ownsStream = !existingStream;
    const stream = existingStream ?? await this.devices.acquire(undefined, undefined, config.cameraEnabled, config.micEnabled);
    let room: Room | null = null;
    let encoder: MediaEncoderPipeline | null = null;
    try {
      room = await this.api.admit(code, config.resolvedName());
      await transport.open(room.credential, room.participantId, config.resolvedName(), ParticipantRole.Participant);
      encoder = new MediaEncoderPipeline(room.participantId, (packet) => transport.publish(packet), () => transport.roomNow());
      await encoder.start(stream, await new CodecNegotiator(preferredCodec).negotiate());
      return { room, displayName: config.resolvedName(), stream, transport, encoder };
    } catch (error) {
      encoder?.stop();
      transport.close(1, "entry failed");
      if (room) await this.api.leave(room).catch(() => undefined);
      if (ownsStream) this.devices.stop(stream);
      throw error;
    }
  }
}

export class RoomLifecycleController {
  state = ConnectionState.Live;
  readonly maxAttempts = 5;
  readonly backoffMs = [500, 1_000, 2_000, 4_000, 8_000];

  constructor(readonly resources: LiveRoomResources, private readonly api: RoomApi) {}

  async confirmLeave(): Promise<void> {
    this.resources.transport.close();
    this.resources.encoder.stop();
    this.resources.stream.getTracks().forEach((track) => track.stop());
    await this.api.leave(this.resources.room).catch(() => undefined);
    this.state = ConnectionState.Closed;
  }

  async confirmEnd(): Promise<void> {
    if (this.resources.room.role !== ParticipantRole.Host) throw new DOMException("Only the host can end the gathering.", "NotAllowedError");
    await this.api.end(this.resources.room);
    this.resources.transport.close(1, "gathering ended");
    this.resources.encoder.stop();
    this.resources.stream.getTracks().forEach((track) => track.stop());
    this.state = ConnectionState.Closed;
  }

  async reconnect(onAttempt: (attempt: number) => void): Promise<boolean> {
    this.state = ConnectionState.Reconnecting;
    this.resources.transport.pauseOutbound();
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      onAttempt(attempt);
      await new Promise((resolve) => window.setTimeout(resolve, this.backoffMs[attempt - 1]));
      try {
        await this.resources.transport.open(
          this.resources.room.credential,
          this.resources.room.participantId,
          this.resources.displayName,
          this.resources.room.role
        );
        this.resources.transport.resumeOutbound();
        this.state = ConnectionState.Live;
        return true;
      } catch {
        // Continue the bounded retry schedule.
      }
    }
    this.state = ConnectionState.Dropped;
    return false;
  }
}
