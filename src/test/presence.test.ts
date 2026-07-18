import { describe, expect, it, vi } from "vitest";
import { InputSanitizer } from "../core/security";
import { LatencyBudget, LatencyMeter } from "../core/performance";
import {
  CodecPreference,
  ParticipantRole,
  ReactionKind,
  type Room,
} from "../core/types";
import {
  deserializeMediaPacket,
  serializeMediaPacket,
  type EncodedMediaPacket,
} from "../media/codec";
import {
  RoomClock,
  RoomTransport,
  type ControlMessage,
} from "../media/room-transport";
import {
  GatheringSetup,
  JoinConfig,
  RoomResolver,
} from "../presence/controllers";
import { InviteArtifacts } from "../presence/invitations";
import { PresenceStore } from "../presence/presence-store";
import { ReactionCounter, ReactionSender } from "../presence/reactions";

describe("Presence entry", () => {
  it("requires a 1–60 character gathering name and defaults it", () => {
    expect(new GatheringSetup().hasValidName()).toBe(true);
    expect(new GatheringSetup("").hasValidName()).toBe(false);
    expect(new GatheringSetup("x".repeat(60)).hasValidName()).toBe(true);
    expect(new GatheringSetup("x".repeat(61)).hasValidName()).toBe(false);
  });

  it("normalizes both plain codes and invite links", () => {
    const sanitizer = new InputSanitizer();
    expect(sanitizer.parseRoomReference(" abc234 ")).toBe("ABC234");
    expect(sanitizer.parseRoomReference("https://cenacle.test/r/abc234")).toBe(
      "ABC234",
    );
    expect(() => sanitizer.parseRoomReference("ABC01I")).toThrow(TypeError);
  });

  it("resolves links through the same room lookup and preserves pre-join state", async () => {
    const api = { resolve: vi.fn().mockResolvedValue({ code: "ABC234" }) };
    const resolver = new RoomResolver(api as never, new InputSanitizer());
    await expect(
      resolver.resolve("https://cenacle.test/r/abc234"),
    ).resolves.toEqual({ code: "ABC234", status: "open" });
    expect(api.resolve).toHaveBeenCalledWith("ABC234");
    expect(new JoinConfig(" Quinn ", false, false)).toMatchObject({
      micEnabled: false,
      cameraEnabled: false,
    });
    expect(new JoinConfig(" Quinn ").resolvedName()).toBe("Quinn");
  });
});

describe("Presence media", () => {
  it("round-trips encoded H.264 and VP9 packet metadata and bytes", () => {
    for (const codec of ["avc1.42E01E", "vp09.00.10.08"]) {
      const packet: EncodedMediaPacket = {
        media: "video",
        participantId: "p1",
        codec,
        timestamp: 123,
        duration: 33_333,
        key: true,
        captureTime: 1_000,
        data: new Uint8Array([1, 2, 3, 4]),
      };
      expect(deserializeMediaPacket(serializeMediaPacket(packet))).toEqual(
        packet,
      );
    }
    expect(Object.values(CodecPreference)).toEqual(["h264", "vp9"]);
  });

  it("retains a non-mutating live latency sample and enforces the 400 ms budget", () => {
    const meter = new LatencyMeter();
    expect(meter.readout()).toBe("— ms");
    const sample = meter.measure(1_000, 1_320);
    expect(meter.latestSample()).toEqual(sample);
    const copy = meter.latestSample()!;
    copy.glassToGlassMs = 0;
    expect(meter.readout()).toBe("320 ms");
    expect(
      new LatencyBudget().shouldDrop({
        captureTs: 0,
        renderTs: 601,
        glassToGlassMs: 601,
      }),
    ).toBe(true);
  });

  it("normalizes sender and receiver timestamps to the room origin clock", () => {
    const senderClock = new RoomClock();
    const receiverClock = new RoomClock();
    senderClock.observe(1_000, 1_105, 1_010);
    receiverClock.observe(2_000, 1_108, 2_016);
    expect(senderClock.now(1_020)).toBe(1_120);
    expect(receiverClock.now(2_028)).toBe(1_128);
    expect(receiverClock.now(2_028) - senderClock.now(1_020)).toBe(8);
    expect(senderClock.uncertaintyMs()).toBe(5);
  });

  it("replays a roster received during transport setup to the room listener", async () => {
    const transport = new RoomTransport("https://rooms.cenacle.test");
    const roster: ControlMessage = {
      type: "roster",
      participants: [{ id: "host" }, { id: "guest" }],
    };
    (
      transport as unknown as {
        emit(event: "control", message: ControlMessage): void;
      }
    ).emit("control", roster);
    const listener = vi.fn();

    transport.on("control", listener);
    await Promise.resolve();

    expect(listener).toHaveBeenCalledWith(roster);
  });
});

describe("Presence controls and reactions", () => {
  it("marks host, self, mute, camera, and speaking state in the roster snapshot", () => {
    const store = new PresenceStore();
    store.replaceParticipants([
      {
        id: "host",
        displayName: "Host",
        role: ParticipantRole.Host,
        isSelf: true,
        isMuted: false,
        isCameraOff: false,
        isSpeaking: false,
      },
    ]);
    store.setMuted(true);
    store.setCameraOff(true);
    store.applyRelayed({
      participantId: "host",
      isMuted: true,
      isCameraOff: true,
      isSpeaking: true,
    });
    expect(store.snapshot()).toMatchObject({
      presentCount: 1,
      participants: [
        {
          role: ParticipantRole.Host,
          isSelf: true,
          isMuted: true,
          isCameraOff: true,
          isSpeaking: true,
        },
      ],
    });
  });

  it("sends reactions as datagrams no faster than the client interval", async () => {
    const sendReaction = vi.fn().mockResolvedValue(undefined);
    const sender = new ReactionSender("p1", { sendReaction } as never);
    await expect(sender.send(ReactionKind.Amen, 1_000)).resolves.toBe(true);
    await expect(sender.send(ReactionKind.RaisedHand, 1_500)).resolves.toBe(
      false,
    );
    await expect(sender.send(ReactionKind.RaisedHand, 1_750)).resolves.toBe(
      true,
    );
    expect(sendReaction).toHaveBeenCalledTimes(2);
  });

  it("maintains a rolling 60-second reaction count that ages down to zero", () => {
    vi.spyOn(Date, "now").mockReturnValue(10_000);
    const counter = new ReactionCounter();
    counter.record({ kind: ReactionKind.Amen, senderId: "a", sentAt: 10_000 });
    counter.record({
      kind: ReactionKind.RaisedHand,
      senderId: "b",
      sentAt: 20_000,
    });
    expect(counter.count(69_999)).toBe(2);
    expect(counter.count(70_000)).toBe(1);
    expect(counter.count(80_000)).toBe(0);
    vi.restoreAllMocks();
  });
});

describe("Invitations", () => {
  it("uses one exact code in the display, link, and QR payload", async () => {
    const encode = vi.fn(async (text: string) => ({ dataUrl: `data:${text}` }));
    const room: Room = {
      code: "ABC234",
      role: ParticipantRole.Host,
      appOrigin: "https://cenacle.test/",
      participantId: "host",
      credential: { code: "ABC234", token: "token", expiresAt: 10 },
    };
    const artifacts = new InviteArtifacts({ encode });
    await artifacts.build(room);
    expect(artifacts.code).toBe("ABC234");
    expect(artifacts.link).toBe("https://cenacle.test/r/ABC234");
    expect(encode).toHaveBeenCalledWith(artifacts.link);
    expect(artifacts.qr?.dataUrl).toContain("/r/ABC234");
  });
});
