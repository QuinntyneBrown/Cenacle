import { useEffect, useMemo, useState } from "react";
import { localStore } from "../core/local-store";
import {
  CodecPreference,
  type DeviceInfo,
  type SettingsModel,
} from "../core/types";
import { MediaDeviceService, MicTest } from "../media/device-service";
import {
  AiCapability,
  aiCapabilityStore,
  modelDownloadController,
  ModelManager,
  onDeviceModel,
} from "../word/on-device-model";
import {
  CaptionLanguageAvailability,
  OnDeviceTranscriber,
  supportedCaptionLanguages,
} from "../word/captions";
import { AppShell, Icon, LinkButton, PrivacySeal, Toggle } from "./components";
import { navigate } from "./router";

export function SettingsPage() {
  const devices = useMemo(() => new MediaDeviceService(), []);
  const micTest = useMemo(() => new MicTest(), []);
  const captionRuntime = useMemo(() => new OnDeviceTranscriber(), []);
  const modelManager = useMemo(
    () => new ModelManager(onDeviceModel, aiCapabilityStore),
    [],
  );
  const [saved, setSaved] = useState(localStore.loadSettings());
  const [draft, setDraft] = useState<SettingsModel>(() =>
    structuredClone(saved),
  );
  const [deviceList, setDeviceList] = useState<DeviceInfo[]>([]);
  const [db, setDb] = useState(-Infinity);
  const [testing, setTesting] = useState(false);
  const [modelCapability, setModelCapability] = useState<AiCapability | null>(null);
  const [modelPercent, setModelPercent] = useState(modelDownloadController.progress?.percent ?? 0);
  const [captionLanguageStatus, setCaptionLanguageStatus] = useState<CaptionLanguageAvailability | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void devices.enumerate().then(setDeviceList);
    const unsubscribeCapability = aiCapabilityStore.subscribe(setModelCapability);
    const unsubscribeProgress = modelDownloadController.subscribe((progress) => setModelPercent(progress?.percent ?? 0));
    void modelManager.recheck().then(setModelCapability);
    return () => {
      micTest.stop();
      unsubscribeCapability();
      unsubscribeProgress();
    };
  }, [devices, micTest, modelManager]);

  useEffect(() => {
    captionRuntime.configure(draft.captionLanguage);
    setCaptionLanguageStatus(null);
    void captionRuntime.availability().then(setCaptionLanguageStatus);
  }, [captionRuntime, draft.captionLanguage]);

  const installCaptionLanguage = async () => {
    setCaptionLanguageStatus(CaptionLanguageAvailability.Downloading);
    const installed = await captionRuntime.installLanguage();
    setCaptionLanguageStatus(installed ? CaptionLanguageAvailability.Available : CaptionLanguageAvailability.Unavailable);
  };

  const list = (kind: MediaDeviceKind) =>
    deviceList.filter((device) => device.kind === kind);
  const update = <K extends keyof SettingsModel>(
    key: K,
    value: SettingsModel[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));
  const save = () => {
    localStore.saveSettings(draft);
    setSaved(structuredClone(draft));
    setMessage("Settings saved on this device.");
  };
  const cancel = () => {
    setDraft(structuredClone(saved));
    setMessage("Unsaved changes discarded.");
  };
  const startMic = async () => {
    if (testing) {
      micTest.stop();
      setTesting(false);
      return;
    }
    setTesting(true);
    try {
      await micTest.start(draft.microphoneId || undefined, setDb);
    } catch (error) {
      setMessage((error as Error).message);
      setTesting(false);
    }
  };

  return (
    <AppShell>
      <main className="container settings-layout">
        <div className="mb-6">
          <span className="eyebrow">
            <Icon name="gear" size={16} />
            Your room, your device
          </span>
          <h1 className="h2 mt-3">Settings</h1>
          <p className="lede mt-3">
            Everything here is saved to this device only.
          </p>
        </div>
        <div className="stack gap-5">
          <section className="panel">
            <div className="panel__head">
              <h2 className="h3">Camera &amp; microphone</h2>
              <span className="pill">
                <span className="dot dot--live" />
                Ready
              </span>
            </div>
            <div className="panel__body">
              <div className="grid cols-2">
                <DeviceSelect
                  label="Camera"
                  value={draft.cameraId}
                  devices={list("videoinput")}
                  onChange={(value) => update("cameraId", value)}
                />
                <DeviceSelect
                  label="Microphone"
                  value={draft.microphoneId}
                  devices={list("audioinput")}
                  onChange={(value) => update("microphoneId", value)}
                />
              </div>
              <div className="mt-4">
                <DeviceSelect
                  label="Speaker"
                  value={draft.speakerId}
                  devices={list("audiooutput")}
                  onChange={(value) => update("speakerId", value)}
                />
              </div>
              <div className="mt-5">
                <div className="between">
                  <span className="label">Test your mic</span>
                  <span className="mono">
                    {Number.isFinite(db) ? `${Math.round(db)} dB` : "— dB"}
                  </span>
                </div>
                <div
                  className="progress mt-2"
                  role="meter"
                  aria-label="Microphone input level"
                  aria-valuemin={-96}
                  aria-valuemax={0}
                  aria-valuenow={Number.isFinite(db) ? db : -96}
                >
                  <div
                    className="progress__bar"
                    style={{
                      width: `${Math.max(0, Math.min(100, ((db + 72) / 72) * 100))}%`,
                    }}
                  />
                </div>
                <p className="hint">
                  {testing && micTest.isFlat()
                    ? "The input is flat. Try another microphone above."
                    : "Say a few words — the bar should move."}
                </p>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => void startMic()}
                >
                  {testing ? "Stop test" : "Test microphone"}
                </button>
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel__head">
              <h2 className="h3">Presence</h2>
              <span className="tag">WebCodecs · WebTransport</span>
            </div>
            <div className="panel__body">
              <span className="label">Preferred codec</span>
              <div
                className="segmented"
                role="radiogroup"
                aria-label="Preferred video codec"
              >
                <button
                  role="radio"
                  aria-checked={draft.codec === CodecPreference.H264}
                  onClick={() => update("codec", CodecPreference.H264)}
                >
                  H.264
                </button>
                <button
                  role="radio"
                  aria-checked={draft.codec === CodecPreference.VP9}
                  onClick={() => update("codec", CodecPreference.VP9)}
                >
                  VP9
                </button>
              </div>
              <p className="hint">
                H.264 usually offers the broadest hardware path. VP9 can offer a
                sharper picture where hardware acceleration exists.
              </p>
              <span className="pill pill--accent mt-4">
                <span className="mono">&lt; 400 ms glass-to-glass</span>
              </span>
            </div>
          </section>
          <section className="panel">
            <div className="panel__head">
              <h2 className="h3">Captions &amp; Word</h2>
              <span className="tag">Prompt API · on-device</span>
            </div>
            <div className="panel__body">
              <div className="settings-row">
                <div>
                  <p className="label">Live captions</p>
                  <p className="hint">
                    Transcribe spoken prayer on this device.
                  </p>
                </div>
                <Toggle
                  label="Live captions"
                  checked={draft.captionsEnabled}
                  onChange={(value) => update("captionsEnabled", value)}
                />
              </div>
              <div className="field mt-5">
                <label className="label" htmlFor="caption-language">
                  Caption language
                </label>
                <select
                  className="select"
                  id="caption-language"
                  value={draft.captionLanguage}
                  onChange={(event) =>
                    update("captionLanguage", event.target.value)
                  }
                >
                  {supportedCaptionLanguages.map(([code, label]) => (
                    <option value={code} key={code}>
                      {label}
                    </option>
                  ))}
                </select>
                <div className="cluster gap-2 mt-3">
                  <span className="pill">{captionLanguageLabel(captionLanguageStatus)}</span>
                  {captionLanguageStatus === CaptionLanguageAvailability.Downloadable && <button className="btn btn--ghost btn--sm" onClick={() => void installCaptionLanguage()}>Install local language pack</button>}
                </div>
              </div>
              <div className="settings-row mt-5">
                <div>
                  <p className="label">On-device model</p>
                  <p className="hint">
                    Shared by captions and reflections. Presence stays live when
                    it is removed.
                  </p>
                </div>
                <div className="cluster gap-2">
                  <span className="pill pill--sage">{modelStatus(modelCapability, modelPercent)}</span>
                  {(modelCapability === AiCapability.Downloadable || modelCapability === AiCapability.Downloading) && <LinkButton to="/word/model" className="btn btn--primary btn--sm">{modelCapability === AiCapability.Downloading ? "View progress" : "Download"}</LinkButton>}
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() =>
                      void modelManager
                        .recheck()
                        .then(setModelCapability)
                    }
                  >
                    Re-check
                  </button>
                  {modelCapability === AiCapability.Ready && <button
                    className="btn btn--quiet btn--sm"
                    onClick={() => {
                      void modelManager.remove().then((result) => {
                        setMessage(result === "removed" ? "The local model was removed. Presence is unchanged." : "This browser requires model removal from its site AI settings. Presence is unchanged.");
                      });
                    }}
                  >
                    Remove
                  </button>}
                </div>
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel__head">
              <h2 className="h3">Sanctuary</h2>
              <span className="tag">WebGPU</span>
            </div>
            <div className="panel__body">
              <div className="settings-row">
                <div>
                  <p className="label">Ambient visuals</p>
                  <p className="hint">
                    A GPU-rendered atmosphere behind the room.
                  </p>
                </div>
                <Toggle
                  label="Ambient visuals"
                  checked={draft.ambientVisualsEnabled}
                  onChange={(value) => update("ambientVisualsEnabled", value)}
                />
              </div>
              <div className="settings-row">
                <div>
                  <p className="label">Audio-reactive worship</p>
                  <p className="hint">
                    Amplitude and frequency feed the shader locally.
                  </p>
                </div>
                <Toggle
                  label="Audio-reactive visuals"
                  checked={draft.audioReactiveEnabled}
                  onChange={(value) => update("audioReactiveEnabled", value)}
                />
              </div>
              <p className="hint mt-4">
                Your system reduce-motion setting is always respected.
              </p>
            </div>
          </section>
          <section className="panel">
            <div className="panel__head">
              <h2 className="h3">Privacy</h2>
              <PrivacySeal />
            </div>
            <div className="panel__body">
              <p>
                Journal entries, recent themes, saved passages, and settings are
                origin-scoped to this device.
              </p>
              <button
                className="btn btn--danger mt-4"
                onClick={() => {
                  if (
                    window.confirm(
                      "Clear all Cenacle data stored on this device?",
                    )
                  ) {
                    localStore.clearAll();
                    setDraft(structuredClone(localStore.loadSettings()));
                    setMessage("Local data cleared.");
                  }
                }}
              >
                Clear local data
              </button>
            </div>
          </section>
        </div>
        {message && (
          <p className="banner banner--sage mt-5" role="status">
            {message}
          </p>
        )}
        <div className="cluster mt-6" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn--quiet" onClick={cancel}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={save}>
            Save changes
          </button>
          <LinkButton to="/" className="btn btn--ghost">
            Done
          </LinkButton>
        </div>
      </main>
    </AppShell>
  );
}

function modelStatus(capability: AiCapability | null, percent: number): string {
  if (!capability) return "Checking…";
  if (capability === AiCapability.Ready) return "Ready · 1.9 GB";
  if (capability === AiCapability.Downloading) return `Downloading · ${percent}%`;
  if (capability === AiCapability.Downloadable) return "Available · not downloaded";
  return "Unavailable on this device";
}

function captionLanguageLabel(status: CaptionLanguageAvailability | null): string {
  if (!status) return "Checking local language…";
  if (status === CaptionLanguageAvailability.Available) return "Local language ready";
  if (status === CaptionLanguageAvailability.Downloadable) return "Local language pack available";
  if (status === CaptionLanguageAvailability.Downloading) return "Installing local language…";
  return "Local language unavailable";
}

function DeviceSelect({
  label,
  value,
  devices,
  onChange,
}: {
  label: string;
  value: string;
  devices: DeviceInfo[];
  onChange: (value: string) => void;
}) {
  const id = label.toLocaleLowerCase();
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
        {devices.map((device) => (
          <option value={device.deviceId} key={device.deviceId}>
            {device.label}
          </option>
        ))}
      </select>
    </div>
  );
}
