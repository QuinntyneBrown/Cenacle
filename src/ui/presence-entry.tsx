import { useEffect, useMemo, useRef, useState } from "react";
import { InputSanitizer } from "../core/security";
import { localStore } from "../core/local-store";
import { CodecPreference, type DeviceInfo } from "../core/types";
import type { CapabilityReport, DegradationPlan } from "../core/capabilities";
import { PresenceDecision } from "../core/capabilities";
import {
  MediaDeviceService,
  MediaStreamLevelMeter,
} from "../media/device-service";
import {
  EnterRoomController,
  GatheringSetup,
  GoLiveController,
  JoinConfig,
  RoomResolver,
  type LiveRoomResources,
} from "../presence/controllers";
import { RoomApi, RoomApiError } from "../presence/room-api";
import { Clipboard } from "../presence/invitations";
import {
  AppShell,
  AccessibleDialog,
  Icon,
  LinkButton,
  PrivacySeal,
  StateView,
  Toggle,
} from "./components";
import { navigate } from "./router";

interface EntryProps {
  roomOrigin: string;
  plan: DegradationPlan;
  report: CapabilityReport | null;
  onEntered: (resources: LiveRoomResources, displayName: string) => void;
}

export function LandingPage({ report }: { report: CapabilityReport | null }) {
  return (
    <AppShell>
      <main>
        <section className="hero">
          <div className="container hero__grid">
            <div>
              <span className="eyebrow">
                Acts 2 · all together in one place
              </span>
              <h1 className="display">
                The upper room,
                <br />
                now a <span className="emph">browser tab</span>.
              </h1>
              <p className="lede">
                Pray together with the immediacy of being in the same room —
                while private words stay on your device.
              </p>
              <div className="cluster gap-3 mt-6">
                <LinkButton to="/host" className="btn btn--primary btn--lg">
                  <Icon name="camera" />
                  Host a room
                </LinkButton>
                <LinkButton to="/join" className="btn btn--ghost btn--lg">
                  Join with a code
                </LinkButton>
              </div>
              <div className="cluster gap-4 mt-6">
                <span className="pill">
                  <span className="dot dot--live" />
                  Sub-second presence
                </span>
                <span className="pill pill--sage">
                  <span className="dot dot--sage" />
                  Nothing private leaves your device
                </span>
              </div>
            </div>
            <figure className="demo-window night">
              <div className="stage">
                <div className="stage__glow" />
                <div className="between mb-4">
                  <span className="pill">
                    <span className="dot dot--live" />
                    Live · Evening prayer
                  </span>
                  <PrivacySeal />
                </div>
                <div className="grid cols-2">
                  <div className="tile tile--host tile--speaking">
                    <div className="tile__fill" />
                    <span className="tile__name">Host · speaking</span>
                  </div>
                  <div className="tile">
                    <div className="tile__fill" />
                    <span className="tile__name">Maria</span>
                  </div>
                </div>
                <div className="between mt-4">
                  <span className="assent">🙌 6 amen</span>
                  <span className="pill">
                    <span className="mono">312 ms</span> glass-to-glass
                  </span>
                </div>
              </div>
            </figure>
          </div>
        </section>
        <section className="section">
          <div className="container">
            <div className="grid cols-3">
              <Feature
                icon="users"
                title="Presence"
                text="Browser-native capture, WebCodecs, and WebTransport for a small live room."
              />
              <Feature
                icon="word"
                title="Word"
                text="Scripture, journal reflections, and captions stay on-device."
              />
              <Feature
                icon="sparkle"
                title="Sanctuary"
                text="A WebGPU atmosphere that yields before presence video."
              />
            </div>
            <div className="center mt-6">
              <LinkButton to="/support" className="btn btn--quiet">
                Browser support ·{" "}
                {report ? `${report.availableCount()}/4 ready` : "checking…"}
              </LinkButton>
            </div>
          </div>
        </section>
      </main>
    </AppShell>
  );
}

function Feature({
  icon,
  title,
  text,
}: {
  icon: "users" | "word" | "sparkle";
  title: string;
  text: string;
}) {
  return (
    <article className="feature-card">
      <span className="glyph">
        <Icon name={icon} />
      </span>
      <h2 className="h3 mt-3">{title}</h2>
      <p className="muted mt-2">{text}</p>
    </article>
  );
}

export function HostPage({ roomOrigin, plan, report, onEntered }: EntryProps) {
  const api = useMemo(() => new RoomApi(roomOrigin), [roomOrigin]);
  const devices = useMemo(() => new MediaDeviceService(), []);
  const levelMeter = useMemo(() => new MediaStreamLevelMeter(), []);
  const controller = useMemo(
    () => new GoLiveController(plan, api, devices, roomOrigin),
    [plan, api, devices, roomOrigin],
  );
  const settings = useMemo(() => localStore.loadSettings(), []);
  const [setup, setSetup] = useState(
    () =>
      new GatheringSetup(
        "Evening prayer",
        settings.cameraId ?? "",
        settings.microphoneId ?? "",
        settings.captionsEnabled ?? true,
        settings.ambientVisualsEnabled ?? true,
      ),
  );
  const [hostName, setHostName] = useState("Host");
  const [deviceList, setDeviceList] = useState<DeviceInfo[]>([]);
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const previewRef = useRef<MediaStream | null>(null);
  const transferred = useRef(false);
  const [micDb, setMicDb] = useState(-Infinity);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    void devices.enumerate().then(setDeviceList);
    return () => {
      levelMeter.stop();
      if (!transferred.current) devices.stop(previewRef.current);
    };
  }, [devices, levelMeter]);
  useEffect(() => {
    previewRef.current = preview;
    if (preview) void levelMeter.start(preview, (_rms, db) => setMicDb(db));
    else levelMeter.stop();
  }, [preview, levelMeter]);

  const startPreview = async (camera = true) => {
    setError(null);
    try {
      devices.stop(preview);
      const stream = await devices.acquire(
        setup.cameraId,
        setup.microphoneId,
        camera,
        true,
      );
      setPreview(stream);
    } catch (reason) {
      setError(reason as Error);
    }
  };
  const goLive = async (camera = true) => {
    setBusy(true);
    setError(null);
    try {
      localStore.saveSettings({
        ...settings,
        cameraId: setup.cameraId,
        microphoneId: setup.microphoneId,
        captionsEnabled: setup.captionsEnabled,
        ambientVisualsEnabled: setup.visualsEnabled,
      });
      const usablePreview =
        preview && (camera || preview.getVideoTracks().length === 0)
          ? preview
          : undefined;
      const resources = await controller.goLive(
        setup,
        hostName,
        settings.codec ?? CodecPreference.H264,
        usablePreview,
        camera,
      );
      if (preview && resources.stream !== preview) devices.stop(preview);
      transferred.current = true;
      onEntered(resources, hostName.trim() || "Host");
    } catch (reason) {
      setError(reason as Error);
      setBusy(false);
    }
  };

  if (!report)
    return (
      <AppShell>
        <StateView
          mark="sage"
          title="Checking this browser"
          message="Cenacle is confirming WebTransport and WebCodecs before opening device setup."
        />
      </AppShell>
    );
  if (plan.presence === PresenceDecision.Unsupported)
    return (
      <AppShell>
        <StateView
          title="Live gathering unavailable here"
          message="This browser needs WebTransport and WebCodecs before it can host a live room."
        >
          <LinkButton to="/support" className="btn btn--primary">
            See browser support
          </LinkButton>
          <button
            className="btn btn--ghost"
            onClick={() =>
              void navigator.clipboard?.writeText(window.location.href)
            }
          >
            <Icon name="copy" />
            Copy link for another device
          </button>
        </StateView>
      </AppShell>
    );
  return (
    <AppShell>
      <main className="container section">
        <div className="setup-grid">
          <section className="stack gap-5">
            <div>
              <span className="eyebrow">Host a live gathering</span>
              <h1 className="h1 mt-3">Prepare the upper room</h1>
              <p className="lede mt-3">
                Your preview is private. Nothing is recorded.
              </p>
            </div>
            <div className="preview">
              <PreviewVideo stream={preview} />
              <span className="pill preview__label">Visible only to you</span>
            </div>
            <div>
              <div className="between">
                <span className="label">Microphone level</span>
                <span className="mono">
                  {Number.isFinite(micDb) ? `${Math.round(micDb)} dB` : "— dB"}
                </span>
              </div>
              <div
                className="progress mt-2"
                role="meter"
                aria-label="Private microphone level"
                aria-valuemin={-96}
                aria-valuemax={0}
                aria-valuenow={Number.isFinite(micDb) ? micDb : -96}
              >
                <div
                  className="progress__bar"
                  style={{
                    width: `${Math.max(0, Math.min(100, ((micDb + 72) / 72) * 100))}%`,
                  }}
                />
              </div>
              <p className="hint">
                Say a few words — the bar should move before you go live.
              </p>
            </div>
            <button
              className="btn btn--ghost"
              onClick={() => void startPreview()}
            >
              <Icon name="camera" />
              {preview ? "Refresh private preview" : "Start private preview"}
            </button>
          </section>
          <section className="panel">
            <div className="panel__head">
              <h2 className="h3">Gathering setup</h2>
              <span className="tag">WebCodecs · WebTransport</span>
            </div>
            <div className="panel__body stack gap-5">
              <div className="field">
                <label className="label" htmlFor="gathering-name">
                  Gathering name
                </label>
                <input
                  id="gathering-name"
                  className="input"
                  minLength={1}
                  maxLength={60}
                  value={setup.name}
                  onChange={(event) =>
                    setSetup(
                      Object.assign(new GatheringSetup(), setup, {
                        name: event.target.value,
                      }),
                    )
                  }
                />
                <p className="hint">
                  1–60 characters. A name is required before go-live.
                </p>
              </div>
              <div className="field">
                <label className="label" htmlFor="host-name">
                  Your display name
                </label>
                <input
                  id="host-name"
                  className="input"
                  maxLength={60}
                  value={hostName}
                  onChange={(event) => setHostName(event.target.value)}
                />
              </div>
              <DeviceSelect
                label="Camera"
                kind="videoinput"
                value={setup.cameraId}
                devices={deviceList}
                onChange={(value) =>
                  setSetup(
                    Object.assign(new GatheringSetup(), setup, {
                      cameraId: value,
                    }),
                  )
                }
              />
              <DeviceSelect
                label="Microphone"
                kind="audioinput"
                value={setup.microphoneId}
                devices={deviceList}
                onChange={(value) =>
                  setSetup(
                    Object.assign(new GatheringSetup(), setup, {
                      microphoneId: value,
                    }),
                  )
                }
              />
              <div className="settings-row">
                <div>
                  <p className="label">Live captions</p>
                  <p className="hint">On-device, default on.</p>
                </div>
                <Toggle
                  label="Live captions"
                  checked={setup.captionsEnabled}
                  onChange={(value) =>
                    setSetup(
                      Object.assign(new GatheringSetup(), setup, {
                        captionsEnabled: value,
                      }),
                    )
                  }
                />
              </div>
              <div className="settings-row">
                <div>
                  <p className="label">Living sanctuary visuals</p>
                  <p className="hint">WebGPU, default on.</p>
                </div>
                <Toggle
                  label="Sanctuary visuals"
                  checked={setup.visualsEnabled}
                  onChange={(value) =>
                    setSetup(
                      Object.assign(new GatheringSetup(), setup, {
                        visualsEnabled: value,
                      }),
                    )
                  }
                />
              </div>
              {error &&
                (isOriginError(error) ? (
                  <ConnectionBanner
                    error={error}
                    onRetry={() => void goLive()}
                  />
                ) : (
                  <DeviceError
                    error={error}
                    onRetry={() => void startPreview()}
                    onAudioOnly={() => void goLive(false)}
                  />
                ))}
              <button
                className="btn btn--primary btn--lg btn--block"
                disabled={busy || !setup.hasValidName()}
                onClick={() => void goLive()}
              >
                {busy ? "Opening the room…" : "Go live"}
              </button>
              <PrivacySeal />
            </div>
          </section>
        </div>
      </main>
    </AppShell>
  );
}

export function JoinPage({ roomOrigin }: { roomOrigin: string }) {
  const resolver = useMemo(
    () => new RoomResolver(new RoomApi(roomOrigin), new InputSanitizer()),
    [roomOrigin],
  );
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await resolver.resolve(input);
      if (result.status === "not-found")
        setError(
          `No open room matches ${result.code}. It may have ended or the code may be mistyped.`,
        );
      else navigate(`/r/${result.code}`);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AppShell>
      <main className="container container-narrow section">
        <div className="card card--raised stack gap-5">
          <div>
            <span className="eyebrow">Join a live gathering</span>
            <h1 className="h1 mt-3">Enter the room code</h1>
            <p className="lede mt-3">
              Use the six-character code or paste the invite link.
            </p>
          </div>
          <form
            className="field"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label className="label" htmlFor="room-code">
              Room code or invite link
            </label>
            <input
              className="input code-input"
              id="room-code"
              autoCapitalize="characters"
              autoComplete="off"
              value={input}
              onChange={(event) =>
                setInput(event.target.value.toUpperCase().slice(0, 300))
              }
              placeholder="ABC234"
            />
            {error && (
              <p className="hint" role="alert">
                {error}
              </p>
            )}
            <button className="btn btn--primary btn--lg mt-4" disabled={busy}>
              {busy ? "Finding the room…" : "Continue"}
            </button>
          </form>
          <p className="small muted">
            Codes are case-insensitive and normalize to uppercase.
          </p>
        </div>
      </main>
    </AppShell>
  );
}

export function GreenRoomPage({
  code,
  roomOrigin,
  onEntered,
  plan,
  report,
}: EntryProps & { code: string }) {
  const api = useMemo(() => new RoomApi(roomOrigin), [roomOrigin]);
  const devices = useMemo(() => new MediaDeviceService(), []);
  const controller = useMemo(
    () => new EnterRoomController(api, devices, roomOrigin),
    [api, devices, roomOrigin],
  );
  const [roomName, setRoomName] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [config, setConfig] = useState(new JoinConfig("", true, true));
  const [primer, setPrimer] = useState(true);
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const previewRef = useRef<MediaStream | null>(null);
  const transferred = useRef(false);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const settings = useMemo(() => localStore.loadSettings(), []);
  useEffect(() => {
    void api
      .resolve(code)
      .then((room) => {
        if (room) setRoomName(room.name);
        else setNotFound(true);
      })
      .catch((reason) => setError(reason as Error));
    return () => {
      if (!transferred.current) devices.stop(previewRef.current);
    };
  }, [api, code, devices]);
  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);

  const allow = async (camera = config.cameraEnabled) => {
    setPrimer(false);
    setError(null);
    try {
      const stream = await devices.acquire(
        undefined,
        undefined,
        camera,
        config.micEnabled,
      );
      setPreview(stream);
    } catch (reason) {
      setError(reason as Error);
    }
  };
  const enter = async (camera = config.cameraEnabled) => {
    setBusy(true);
    setError(null);
    try {
      let stream = preview;
      if (!stream || (camera && stream.getVideoTracks().length === 0))
        stream = await devices.acquire(
          undefined,
          undefined,
          camera,
          config.micEnabled,
        );
      const effective = new JoinConfig(
        config.displayName,
        config.micEnabled,
        camera,
      );
      stream.getAudioTracks().forEach((track) => {
        track.enabled = effective.micEnabled;
      });
      stream.getVideoTracks().forEach((track) => {
        track.enabled = effective.cameraEnabled;
      });
      const resources = await controller.enter(
        code,
        effective,
        settings.codec ?? CodecPreference.H264,
        stream,
      );
      transferred.current = true;
      onEntered(resources, effective.resolvedName());
    } catch (reason) {
      setError(reason as Error);
      setBusy(false);
    }
  };

  if (error && isOriginError(error))
    return (
      <AppShell>
        <StateView
          title="Live room connection unavailable"
          message={error.message}
        >
          <button
            className="btn btn--primary"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
          <LinkButton to="/support" className="btn btn--ghost">
            Connection help
          </LinkButton>
        </StateView>
      </AppShell>
    );
  if (notFound)
    return (
      <AppShell>
        <StateView
          title="Room not found"
          message={`No open room matches ${code}. It may have ended or the code may be mistyped.`}
        >
          <LinkButton to="/join" className="btn btn--primary">
            Try another code
          </LinkButton>
          <LinkButton to="/host" className="btn btn--ghost">
            Host a room
          </LinkButton>
        </StateView>
      </AppShell>
    );
  if (!report)
    return (
      <AppShell>
        <StateView
          mark="sage"
          title="Checking this browser"
          message="Cenacle is confirming live-room support before asking for device access."
        />
      </AppShell>
    );
  if (plan.presence === PresenceDecision.Unsupported)
    return (
      <AppShell>
        <StateView
          title="Live gathering unavailable here"
          message="This browser needs WebTransport and WebCodecs to enter the room."
        >
          <LinkButton to="/support" className="btn btn--primary">
            See browser support
          </LinkButton>
          <button
            className="btn btn--ghost"
            onClick={() => void new Clipboard().writeText(window.location.href)}
          >
            <Icon name="copy" />
            Copy room link for Chrome or Edge
          </button>
        </StateView>
      </AppShell>
    );
  return (
    <AppShell>
      <main className="container section">
        <div className="setup-grid">
          <section>
            <span className="eyebrow">Green room · {code}</span>
            <h1 className="h1 mt-3">{roomName || "Gathering"}</h1>
            <p className="lede mt-3">
              Preview privately, then enter when you are ready.
            </p>
            <div className="preview mt-5">
              <PreviewVideo stream={preview} />
              <span className="pill preview__label">Visible only to you</span>
            </div>
            <p className="banner banner--sage mt-4">
              <Icon name="shield" />
              Nothing is recorded.
            </p>
          </section>
          <section className="panel">
            <div className="panel__head">
              <h2 className="h3">Before you enter</h2>
              <span className="pill">
                <span className="dot dot--live" />
                Room open
              </span>
            </div>
            <div className="panel__body stack gap-5">
              <div className="field">
                <label className="label" htmlFor="display-name">
                  Display name
                </label>
                <input
                  className="input"
                  id="display-name"
                  maxLength={60}
                  value={config.displayName}
                  placeholder="Guest"
                  onChange={(event) =>
                    setConfig(
                      new JoinConfig(
                        event.target.value,
                        config.micEnabled,
                        config.cameraEnabled,
                      ),
                    )
                  }
                />
              </div>
              <div className="settings-row">
                <div>
                  <p className="label">Microphone</p>
                  <p className="hint">Carry this state into the room.</p>
                </div>
                <Toggle
                  label="Microphone on"
                  checked={config.micEnabled}
                  onChange={(value) =>
                    setConfig(
                      new JoinConfig(
                        config.displayName,
                        value,
                        config.cameraEnabled,
                      ),
                    )
                  }
                />
              </div>
              <div className="settings-row">
                <div>
                  <p className="label">Camera</p>
                  <p className="hint">Carry this state into the room.</p>
                </div>
                <Toggle
                  label="Camera on"
                  checked={config.cameraEnabled}
                  onChange={(value) =>
                    setConfig(
                      new JoinConfig(
                        config.displayName,
                        config.micEnabled,
                        value,
                      ),
                    )
                  }
                />
              </div>
              {error &&
                (error instanceof RoomApiError && error.code === "ROOM_FULL" ? (
                  <div className="banner banner--warn">
                    <p className="banner__title">This room is full</p>
                    <p>Rooms stay small on purpose.</p>
                    <div className="cluster gap-2 mt-3">
                      <button
                        className="btn btn--ghost"
                        onClick={() => void enter()}
                      >
                        Try again
                      </button>
                      <LinkButton to="/host" className="btn btn--quiet">
                        Host a room
                      </LinkButton>
                    </div>
                  </div>
                ) : isOriginError(error) ? (
                  <ConnectionBanner
                    error={error}
                    onRetry={() => void enter()}
                  />
                ) : (
                  <DeviceError
                    error={error}
                    onRetry={() => setPrimer(true)}
                    onAudioOnly={() => void allow(false)}
                  />
                ))}
              <button
                className="btn btn--primary btn--lg btn--block"
                disabled={busy || !preview}
                onClick={() => void enter()}
              >
                {busy ? "Entering…" : "Enter live room"}
              </button>
            </div>
          </section>
        </div>
      </main>
      <AccessibleDialog
        open={primer}
        title="Camera and microphone permission"
        onClose={() => setPrimer(false)}
        footer={
          <>
            <button className="btn btn--quiet" onClick={() => setPrimer(false)}>
              Not now
            </button>
            <button className="btn btn--primary" onClick={() => void allow()}>
              Allow camera &amp; mic
            </button>
          </>
        }
      >
        <p>
          Cenacle uses your camera and microphone so people in the gathering can
          see and hear you. Your browser will ask next.
        </p>
        <p className="mt-3">
          <strong>Nothing is recorded.</strong>
        </p>
      </AccessibleDialog>
    </AppShell>
  );
}

function PreviewVideo({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream;
      if (stream) void ref.current.play();
    }
  }, [stream]);
  return stream ? (
    <video ref={ref} muted playsInline aria-label="Private self-preview" />
  ) : (
    <div className="center" style={{ minHeight: 280 }}>
      <span className="muted">Private preview starts after permission</span>
    </div>
  );
}

function DeviceSelect({
  label,
  kind,
  value,
  devices,
  onChange,
}: {
  label: string;
  kind: MediaDeviceKind;
  value: string;
  devices: DeviceInfo[];
  onChange: (value: string) => void;
}) {
  const id = `host-${kind}`;
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <select
        className="select"
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">System default</option>
        {devices
          .filter((device) => device.kind === kind)
          .map((device) => (
            <option value={device.deviceId} key={device.deviceId}>
              {device.label}
            </option>
          ))}
      </select>
    </div>
  );
}

function DeviceError({
  error,
  onRetry,
  onAudioOnly,
}: {
  error: Error;
  onRetry: () => void;
  onAudioOnly: () => void;
}) {
  const permission =
    error.name === "NotAllowedError" || error.name === "SecurityError";
  const busy = error.name === "NotReadableError" || error.name === "AbortError";
  return (
    <div className="banner banner--danger" role="alert">
      <Icon name="alert" />
      <div>
        <p className="banner__title">
          {permission
            ? "Camera or microphone permission is blocked"
            : busy
              ? "A camera or microphone is in use"
              : "The device could not start"}
        </p>
        <p className="small">
          {permission
            ? "Allow access in browser settings, then try again."
            : busy
              ? "Close the other app using it, then try again."
              : error.message}
        </p>
        <div className="cluster gap-2 mt-3">
          <button className="btn btn--ghost btn--sm" onClick={onRetry}>
            Try again
          </button>
          <button className="btn btn--quiet btn--sm" onClick={onAudioOnly}>
            Join with camera off
          </button>
        </div>
      </div>
    </div>
  );
}

function isOriginError(error: Error): error is RoomApiError {
  return error instanceof RoomApiError && error.code === "ORIGIN_UNREACHABLE";
}

function ConnectionBanner({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}) {
  return (
    <div className="banner banner--danger" role="alert">
      <Icon name="alert" />
      <div>
        <p className="banner__title">Live room connection unavailable</p>
        <p className="small">{error.message}</p>
        <button className="btn btn--ghost btn--sm mt-3" onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  );
}
