import { useEffect, useMemo, useRef, useState } from "react";
import { FocusManager, ReduceMotion } from "../core/accessibility";
import { localStore } from "../core/local-store";
import { LoadStrategy } from "../core/performance";
import {
  CaptionSegmentStatus,
  ParticipantRole,
  ReactionKind,
  type CaptionSegment,
  type Participant,
} from "../core/types";
import { FrameRenderer, MediaDecoderPipeline } from "../media/decoder";
import { MediaStreamLevelMeter } from "../media/device-service";
import type { ControlMessage } from "../media/room-transport";
import type { DegradationPlan } from "../core/capabilities";
import { WordDecision } from "../core/capabilities";
import {
  RoomLifecycleController,
  type LiveRoomResources,
} from "../presence/controllers";
import { InviteArtifacts, Clipboard } from "../presence/invitations";
import { PresenceStore } from "../presence/presence-store";
import {
  MoteRenderer,
  ReactionCounter,
  ReactionReceiver,
  ReactionSender,
} from "../presence/reactions";
import { RoomApi } from "../presence/room-api";
import {
  AudioAnalyser,
  SanctuaryLayer,
  StillBackdrop,
  VisualsSettings,
  WebGpuProbe,
} from "../sanctuary/sanctuary";
import { FloatingCompanionController } from "../sanctuary/floating-companion";
import { CaptionController, OnDeviceTranscriber } from "../word/captions";
import {
  AccessibleDialog,
  AppShell,
  Icon,
  PrivacySeal,
  Toggle,
} from "./components";
import { JournalPanel, ScripturePanel } from "./word";

interface RoomPageProps {
  resources: LiveRoomResources;
  displayName: string;
  roomOrigin: string;
  plan: DegradationPlan;
  onExit: () => void;
}

export function RoomPage({
  resources,
  displayName,
  roomOrigin,
  plan,
  onExit,
}: RoomPageProps) {
  const store = useMemo(() => new PresenceStore(), []);
  const lifecycle = useMemo(
    () => new RoomLifecycleController(resources, new RoomApi(roomOrigin)),
    [resources, roomOrigin],
  );
  const reactionCounter = useMemo(() => new ReactionCounter(), []);
  const reactionSender = useMemo(
    () => new ReactionSender(resources.room.participantId, resources.transport),
    [resources],
  );
  const decoder = useMemo(
    () =>
      new MediaDecoderPipeline(
        (id) => rendererFor(id),
        () => resources.transport.roomNow(),
        localStore.loadSettings().speakerId,
      ),
    [],
  );
  const captionController = useMemo(
    () => new CaptionController(new OnDeviceTranscriber(), localStore),
    [],
  );
  const pip = useMemo(() => new FloatingCompanionController(), []);
  const localLevel = useMemo(() => new MediaStreamLevelMeter(), []);
  const renderers = useRef(new Map<string, FrameRenderer>());
  const remoteCanvases = useRef(new Map<string, HTMLCanvasElement>());
  const localVideo = useRef<HTMLVideoElement>(null);
  const stageNode = useRef<HTMLDivElement>(null);
  const reactionLayer = useRef<HTMLDivElement>(null);
  const sanctuaryCanvas = useRef<HTMLCanvasElement>(null);
  const roomRoot = useRef<HTMLDivElement>(null);
  const reconnectOverlay = useRef<HTMLDivElement>(null);
  const [version, setVersion] = useState(0);
  const [caption, setCaption] = useState<CaptionSegment | null>(null);
  const [captionRuntimeReady, setCaptionRuntimeReady] = useState(false);
  const [reactionCount, setReactionCount] = useState(0);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [companionOpen, setCompanionOpen] = useState(false);
  const [companionTab, setCompanionTab] = useState<"scripture" | "journal">(
    "scripture",
  );
  const [reconnecting, setReconnecting] = useState(false);
  const reconnectingRef = useRef(false);
  const [reconnectFailed, setReconnectFailed] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [ended, setEnded] = useState(false);
  const [toast, setToast] = useState("");
  const captionTrack = useMemo(
    () => decoder.captionTrack(resources.stream),
    [decoder, resources.stream],
  );
  const captionsAvailable =
    plan.word === WordDecision.Enabled && captionRuntimeReady;
  const captionSpeaker = () => {
    const participant =
      store.participants.find((item) => item.isSpeaking) ??
      store.participants.find((item) => item.isSelf);
    return {
      id: participant?.id ?? resources.room.participantId,
      name: participant?.displayName ?? displayName,
    };
  };

  function rendererFor(id: string): FrameRenderer | null {
    const existing = renderers.current.get(id);
    if (existing) return existing;
    const canvas = remoteCanvases.current.get(id);
    if (!canvas) return null;
    const renderer = new FrameRenderer(canvas);
    renderers.current.set(id, renderer);
    return renderer;
  }

  useEffect(
    () => store.subscribe(() => setVersion((value) => value + 1)),
    [store],
  );
  useEffect(() => {
    let mounted = true;
    store.localControls = {
      micMuted: !resources.stream
        .getAudioTracks()
        .some((track) => track.enabled),
      cameraOff: !resources.stream
        .getVideoTracks()
        .some((track) => track.enabled),
      captionsOn: localStore.loadSettings().captionsEnabled,
      companionOpen: false,
    };
    store.replaceParticipants([
      {
        id: resources.room.participantId,
        displayName,
        role: resources.room.role,
        isSelf: true,
        isMuted: store.localControls.micMuted,
        isCameraOff: store.localControls.cameraOff,
        isSpeaking: false,
      },
    ]);
    if (localVideo.current) {
      localVideo.current.srcObject = resources.stream;
      void localVideo.current.play();
    }
    const cleanupControl = resources.transport.on("control", onControl);
    const cleanupMedia = resources.transport.on("media", (packet) => {
      decoder.decode(packet);
      if (packet.media === "audio") {
        window.setTimeout(() => {
          const participant = store.participants.find(
            (item) => item.id === packet.participantId,
          );
          if (participant)
            store.applyRelayed({
              participantId: participant.id,
              isMuted: participant.isMuted,
              isCameraOff: participant.isCameraOff,
              isSpeaking: decoder.audioLevel(participant.id) >= 0.06,
            });
        }, 0);
      }
      setVersion((value) => value + 1);
    });
    const cleanupDrop = resources.transport.on("drop", () => void reconnect());
    if (plan.word === WordDecision.Enabled) {
      void captionController.availability().then((availability) => {
        if (!mounted || availability !== "available") return;
        setCaptionRuntimeReady(true);
        if (captionController.enabled) {
          captionController.start(
            resources.room.participantId,
            displayName,
            setCaption,
            captionTrack ?? undefined,
            captionSpeaker,
          );
        }
      });
    }
    let wasSpeaking = false;
    void localLevel.start(resources.stream, (rms) => {
      const speaking = !store.localControls.micMuted && rms >= 0.06;
      if (speaking === wasSpeaking) return;
      wasSpeaking = speaking;
      store.applyRelayed({
        participantId: resources.room.participantId,
        isMuted: store.localControls.micMuted,
        isCameraOff: store.localControls.cameraOff,
        isSpeaking: speaking,
      });
      void resources.transport
        .signalPresence({
          participantId: resources.room.participantId,
          isMuted: store.localControls.micMuted,
          isCameraOff: store.localControls.cameraOff,
          isSpeaking: speaking,
        })
        .catch(() => undefined);
    });
    return () => {
      mounted = false;
      cleanupControl();
      cleanupMedia();
      cleanupDrop();
      captionController.stop();
      decoder.close();
      localLevel.stop();
    };
  }, []);

  useEffect(() => {
    if (!sanctuaryCanvas.current || !roomRoot.current) return;
    const settings = new VisualsSettings(localStore);
    const layer = new SanctuaryLayer(
      settings,
      new WebGpuProbe(),
      new StillBackdrop(roomRoot.current),
    );
    const analyser = new AudioAnalyser();
    analyser.connect(decoder.audioAnalysisOutput());
    new LoadStrategy().deferGpuInit(() => {
      if (sanctuaryCanvas.current)
        void layer
          .mount(sanctuaryCanvas.current, analyser)
          .catch(() => new StillBackdrop(roomRoot.current!).show());
    });
    return () => layer.unmount();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(
      () => setReactionCount(reactionCounter.count()),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [reactionCounter]);

  useEffect(() => {
    if (!reconnecting || !reconnectOverlay.current) return;
    const focus = new FocusManager();
    focus.trap(reconnectOverlay.current, document.activeElement as HTMLElement | null);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLeaveOpen(true);
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("keydown", escape);
      focus.release();
    };
  }, [reconnecting]);

  const snapshot = store.snapshot();
  void version;

  const onControl = (message: ControlMessage) => {
    if (message.type === "roster") {
      const participants = (
        message.participants as Array<Omit<Participant, "isSelf">>
      ).map((participant) => ({
        ...participant,
        isSelf: participant.id === resources.room.participantId,
      }));
      store.replaceParticipants(participants);
    } else if (message.type === "presence") {
      store.applyRelayed(message.update);
    } else if (message.type === "participant-left") {
      store.remove(message.participantId);
    } else if (message.type === "room-ended") {
      setEnded(true);
    } else if (message.type === "reaction" && reactionLayer.current) {
      const receiver = new ReactionReceiver(
        new MoteRenderer(new ReduceMotion().enabled, reactionLayer.current),
        reactionCounter,
      );
      receiver.onReaction(message.reaction);
      setReactionCount(reactionCounter.count());
    }
  };

  const reconnect = async () => {
    if (reconnectingRef.current) return;
    reconnectingRef.current = true;
    setReconnectFailed(false);
    setReconnecting(true);
    const connected = await lifecycle.reconnect(setReconnectAttempt);
    reconnectingRef.current = false;
    setReconnectFailed(!connected);
    setReconnecting(!connected);
  };

  const toggleMic = async () => {
    const muted = !snapshot.localControls.micMuted;
    resources.transport.setAudioSending(resources.stream, !muted);
    resources.encoder.setAudioEnabled(!muted);
    store.setMuted(muted);
    await resources.transport.signalPresence({
      participantId: resources.room.participantId,
      isMuted: muted,
      isCameraOff: snapshot.localControls.cameraOff,
    });
  };

  const toggleCamera = async () => {
    const off = !snapshot.localControls.cameraOff;
    resources.transport.setVideoSending(resources.stream, !off);
    resources.encoder.setVideoEnabled(!off);
    store.setCameraOff(off);
    await resources.transport.signalPresence({
      participantId: resources.room.participantId,
      isMuted: snapshot.localControls.micMuted,
      isCameraOff: off,
    });
  };

  const toggleCaptions = () => {
    const on = !snapshot.localControls.captionsOn;
    store.setCaptionsOn(on);
    captionController.setEnabled(on);
    if (on)
      captionController.start(
        resources.room.participantId,
        displayName,
        setCaption,
        captionTrack ?? undefined,
        captionSpeaker,
      );
    else setCaption(null);
  };

  const sendReaction = async (kind = ReactionKind.Amen) => {
    const sent = await reactionSender.send(kind);
    if (!sent) setToast("Reactions are gently rate-limited.");
  };

  const exit = async (ending = false) => {
    if (ending) await lifecycle.confirmEnd();
    else await lifecycle.confirmLeave();
    onExit();
  };

  const floatingSession = () => ({
    muted: snapshot.localControls.micMuted,
    latencyMs: decoder.latency.latestSample()?.glassToGlassMs ?? null,
    captionLine: caption?.text ?? "",
    toggleMute: () => void toggleMic(),
    leave: () => {
      pip.returnToTab();
      setLeaveOpen(true);
    },
  });

  useEffect(() => {
    pip.update(floatingSession());
  }, [pip, version, caption?.text, snapshot.localControls.micMuted]);

  useEffect(() => () => pip.returnToTab(), [pip]);

  const active =
    snapshot.participants.find((participant) => participant.isSpeaking) ??
    snapshot.participants.find(
      (participant) => participant.role === ParticipantRole.Host,
    ) ??
    snapshot.participants[0];
  const remotes = snapshot.participants.filter(
    (participant) => !participant.isSelf,
  );

  if (ended)
    return (
      <AppShell night>
        <main className="state">
          <div className="state__inner">
            <div className="state__mark state__mark--sage">
              <Icon name="shield" />
            </div>
            <h1>The gathering has ended</h1>
            <p>
              The host closed the room for everyone. Your journal, saved
              passages, and settings remain on this device.
            </p>
            <button className="btn btn--primary mt-5" onClick={onExit}>
              Return home
            </button>
          </div>
        </main>
      </AppShell>
    );

  return (
    <AppShell night>
      <div
        className="room-shell"
        ref={roomRoot}
        data-room-code={resources.room.code}
      >
        <canvas
          className="sanctuary-canvas"
          ref={sanctuaryCanvas}
          aria-hidden="true"
        />
        <header className="between">
          <div className="cluster gap-3">
            <span className="pill">
              <span className="dot dot--live" />
              Live · <span className="mono">{resources.room.code}</span>
            </span>
            <span className="pill">
              <Icon name="users" size={16} />
              {snapshot.presentCount} present
            </span>
          </div>
          <div className="cluster gap-2">
            <span className="pill">
              <span className="mono">{decoder.latency.readout()}</span>{" "}
              glass-to-glass
            </span>
            {resources.room.role === ParticipantRole.Host && (
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => setInviteOpen(true)}
              >
                Invite
              </button>
            )}
          </div>
        </header>
        <main className="room-main">
          <section className="room-stage">
            <div
              className={`stage stage-live ${active?.isSpeaking ? "tile--speaking" : ""}`}
              ref={stageNode}
            >
              <div className="stage__glow" />
              {active?.isSelf ? (
                <video ref={localVideo} muted playsInline />
              ) : active ? (
                <canvas
                  className="remote-video"
                  ref={(node) => {
                    if (node) remoteCanvases.current.set(active.id, node);
                  }}
                />
              ) : null}
              {active?.isCameraOff && (
                <div
                  className="center"
                  style={{ position: "absolute", inset: 0 }}
                >
                  <span className="pill">Camera off</span>
                </div>
              )}
              <span className="tile__name">
                {active?.displayName ?? "Waiting for someone to join"}
                {active?.role === ParticipantRole.Host ? " · host" : ""}
                {active?.isSpeaking ? " · speaking" : ""}
              </span>
              {caption && snapshot.localControls.captionsOn && (
                <div className="captions">
                  <span className="cap-speaker">{caption.speakerName}</span>
                  <span
                    className={`cap-text ${caption.status === CaptionSegmentStatus.InProgress ? "live" : ""}`}
                  >
                    {caption.text}
                  </span>
                </div>
              )}
              <div className="reaction-layer" ref={reactionLayer} />
              <div className="pip-controls">
                <span className="mono">{decoder.latency.readout()}</span>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => void toggleMic()}
                >
                  {snapshot.localControls.micMuted ? "Unmute" : "Mute"}
                </button>
                <button
                  className="btn btn--danger btn--sm"
                  onClick={() => setLeaveOpen(true)}
                >
                  Leave
                </button>
              </div>
            </div>
            <div className="filmstrip">
              {snapshot.participants.map((participant) => (
                <div
                  className={`tile ${participant.role === ParticipantRole.Host ? "tile--host" : ""} ${participant.isSpeaking ? "tile--speaking" : ""}`}
                  key={participant.id}
                >
                  {participant.isSelf ? (
                    <video
                      muted
                      playsInline
                      ref={(node) => {
                        if (node) {
                          node.srcObject = resources.stream;
                          void node.play();
                        }
                      }}
                    />
                  ) : (
                    <canvas
                      className="remote-video"
                      ref={(node) => {
                        if (node)
                          remoteCanvases.current.set(participant.id, node);
                      }}
                    />
                  )}
                  <span className="tile__name">
                    {participant.displayName}
                    {participant.isSelf ? " · you" : ""}
                    {participant.isMuted ? " · muted" : ""}
                  </span>
                  {participant.isCameraOff && (
                    <span className="tile__muted">Camera off</span>
                  )}
                </div>
              ))}
            </div>
          </section>
          <aside
            className={`side-rail panel ${companionOpen ? "is-open" : ""}`}
          >
            <div className="panel__head">
              <h2 className="h3">
                {companionOpen ? "Private companion" : "People"}
              </h2>
              {companionOpen && (
                <button
                  className="btn btn--quiet btn--sm"
                  onClick={() => {
                    setCompanionOpen(false);
                    store.setCompanionOpen(false);
                  }}
                >
                  Close
                </button>
              )}
            </div>
            <div className="panel__body">
              {companionOpen ? (
                <>
                  {plan.word === WordDecision.Enabled ? (
                    <>
                      <div className="companion-tabs">
                        <button
                          className="pill"
                          aria-pressed={companionTab === "scripture"}
                          onClick={() => setCompanionTab("scripture")}
                        >
                          Scripture
                        </button>
                        <button
                          className="pill"
                          aria-pressed={companionTab === "journal"}
                          onClick={() => setCompanionTab("journal")}
                        >
                          Journal
                        </button>
                      </div>
                      {companionTab === "scripture" ? (
                        <ScripturePanel compact />
                      ) : (
                        <JournalPanel compact />
                      )}
                    </>
                  ) : (
                    <div className="banner banner--warn">
                      On-device AI is unavailable. Word features are hidden; the
                      gathering stays live.
                    </div>
                  )}
                </>
              ) : (
                <Roster participants={snapshot.participants} />
              )}
            </div>
          </aside>
        </main>
        <footer className="room-dock dock">
          <Control
            icon="mic"
            label={snapshot.localControls.micMuted ? "Unmute" : "Mute"}
            off={snapshot.localControls.micMuted}
            onClick={() => void toggleMic()}
          />
          <Control
            icon="camera"
            label={
              snapshot.localControls.cameraOff ? "Camera on" : "Camera off"
            }
            off={snapshot.localControls.cameraOff}
            onClick={() => void toggleCamera()}
          />
          {captionsAvailable && (
            <Control
              icon="captions"
              label={
                snapshot.localControls.captionsOn
                  ? "Captions on"
                  : "Captions off"
              }
              off={!snapshot.localControls.captionsOn}
              onClick={toggleCaptions}
            />
          )}
          {plan.word === WordDecision.Enabled && (
            <Control
              icon="word"
              label={
                resources.room.role === ParticipantRole.Host
                  ? "Surface a passage"
                  : "Follow along in the Word"
              }
              accent
              onClick={() => {
                setCompanionOpen(true);
                store.setCompanionOpen(true);
              }}
            />
          )}
          <Control
            icon="sparkle"
            label={`Amen · ${reactionCount}`}
            accent
            onClick={() => void sendReaction(ReactionKind.Amen)}
          />
          <Control
            icon="sparkle"
            label="Raise hand"
            onClick={() => void sendReaction(ReactionKind.RaisedHand)}
          />
          {pip.isSupported() && (
            <Control
              icon="pip"
              label="Float room"
              onClick={() => {
                if (stageNode.current)
                  void pip
                    .pop(stageNode.current, floatingSession())
                    .catch(() => setToast("Floating window could not open."));
              }}
            />
          )}
          <Control
            icon="leave"
            label={
              resources.room.role === ParticipantRole.Host ? "End" : "Leave"
            }
            leave
            onClick={() =>
              resources.room.role === ParticipantRole.Host
                ? setEndOpen(true)
                : setLeaveOpen(true)
            }
          />
        </footer>
        <InviteDialog
          open={inviteOpen}
          resources={resources}
          onClose={() => setInviteOpen(false)}
        />
        <AccessibleDialog
          open={leaveOpen}
          title="Leave this gathering?"
          onClose={() => setLeaveOpen(false)}
          footer={
            <>
              <button
                className="btn btn--quiet"
                onClick={() => setLeaveOpen(false)}
              >
                Stay
              </button>
              <button
                className="btn btn--danger-solid"
                onClick={() => void exit(false)}
              >
                Leave room
              </button>
            </>
          }
        >
          <p>You can rejoin with the same link while the room stays open.</p>
        </AccessibleDialog>
        <AccessibleDialog
          open={endOpen}
          destructive
          title="End the gathering for everyone?"
          onClose={() => setEndOpen(false)}
          footer={
            <>
              <button
                className="btn btn--quiet"
                onClick={() => setEndOpen(false)}
              >
                Keep gathering
              </button>
              <button
                className="btn btn--danger-solid"
                onClick={() => void exit(true)}
              >
                End gathering
              </button>
            </>
          }
        >
          <p>
            The room will close for everyone and this link will no longer reopen
            it. On-device journal entries, passages, and settings will not be
            deleted.
          </p>
        </AccessibleDialog>
        {reconnecting && (
          <div
            className="overlay"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="reconnect-title"
            ref={reconnectOverlay}
          >
            <div className="stack gap-3">
              <h2 id="reconnect-title">{reconnectFailed ? "Connection lost" : "Reconnecting"}</h2>
              <p className="reconnect-detail" role="status" aria-live="assertive">
                Attempt {reconnectAttempt} of {lifecycle.maxAttempts} · last
                latency {decoder.latency.readout()}
              </p>
              <p>{reconnectFailed ? "The live room origin could not be reached. Retry the connection or leave the room." : "Outbound media is paused until the room is stable."}</p>
              {reconnectFailed && <button className="btn btn--primary" onClick={() => void reconnect()}>Try again</button>}
              <button
                className="btn btn--danger"
                onClick={() => setLeaveOpen(true)}
              >
                Leave room
              </button>
            </div>
          </div>
        )}
        {toast && (
          <div className="toast-region">
            <div className="toast" role="status">
              {toast}
              <button onClick={() => setToast("")}>×</button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Roster({ participants }: { participants: Participant[] }) {
  return (
    <ul className="roster-list">
      {participants.map((participant) => (
        <li key={participant.id}>
          <span>
            {participant.displayName}
            {participant.isSelf ? " (you)" : ""}
          </span>
          <span className="small muted">
            {participant.role === ParticipantRole.Host ? "Host · " : ""}
            {participant.isSpeaking ? "Speaking · " : ""}
            {participant.isMuted ? "Muted" : "Mic on"}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Control({
  icon,
  label,
  onClick,
  accent = false,
  off = false,
  leave = false,
}: {
  icon: "mic" | "camera" | "captions" | "word" | "sparkle" | "pip" | "leave";
  label: string;
  onClick: () => void;
  accent?: boolean;
  off?: boolean;
  leave?: boolean;
}) {
  return (
    <button
      className={`control ${accent ? "control--accent" : ""} ${off ? "control--off" : ""} ${leave ? "control--leave" : ""}`}
      onClick={onClick}
      aria-label={label}
    >
      <Icon name={icon} />
      <span className="control__label">{label}</span>
    </button>
  );
}

function InviteDialog({
  open,
  resources,
  onClose,
}: {
  open: boolean;
  resources: LiveRoomResources;
  onClose: () => void;
}) {
  const [artifacts, setArtifacts] = useState<InviteArtifacts | null>(null);
  const [copied, setCopied] = useState("");
  useEffect(() => {
    if (!open) return;
    const value = new InviteArtifacts();
    void value.build(resources.room).then(() => setArtifacts(value));
  }, [open, resources.room]);
  const copy = async (value: string, label: string) => {
    const ok = await new Clipboard().writeText(value);
    setCopied(
      ok
        ? `${label} copied.`
        : "Clipboard unavailable. Select the text below to copy it.",
    );
  };
  return (
    <AccessibleDialog
      open={open}
      title="Invite someone"
      onClose={onClose}
      footer={
        <button className="btn btn--primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <p>Rooms stay small on purpose.</p>
      {artifacts && (
        <div className="stack gap-4 mt-4">
          <div className="field">
            <label className="label" htmlFor="invite-link">
              Invite link
            </label>
            <div className="cluster">
              <input
                className="input mono"
                id="invite-link"
                readOnly
                value={artifacts.link}
                onFocus={(event) => event.currentTarget.select()}
              />
              <button
                className="btn btn--ghost"
                onClick={() => void copy(artifacts.link, "Link")}
              >
                <Icon name="copy" />
                Copy
              </button>
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="invite-code">
              Room code
            </label>
            <div className="cluster">
              <input
                className="input code-input mono"
                id="invite-code"
                readOnly
                value={artifacts.code}
                onFocus={(event) => event.currentTarget.select()}
              />
              <button
                className="btn btn--ghost"
                onClick={() => void copy(artifacts.code, "Code")}
              >
                Copy
              </button>
            </div>
          </div>
          {artifacts.qr && (
            <img
              src={artifacts.qr.dataUrl}
              width="220"
              height="220"
              alt={`QR code for room ${artifacts.code}`}
            />
          )}
          <p role="status" className="small">
            {copied}
          </p>
        </div>
      )}
    </AccessibleDialog>
  );
}
