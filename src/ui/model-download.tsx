import { useEffect, useState } from "react";
import type { DownloadProgress } from "../core/types";
import {
  AiCapability,
  aiCapabilityStore,
  modelDownloadController,
} from "../word/on-device-model";
import {
  AppShell,
  Icon,
  LinkButton,
  PrivacySeal,
  StateView,
} from "./components";
import { navigate } from "./router";

export function ModelDownloadPage({
  capability,
}: {
  capability: AiCapability;
}) {
  const [progress, setProgress] = useState<DownloadProgress | null>(
    modelDownloadController.progress,
  );
  const [error, setError] = useState("");

  useEffect(() => modelDownloadController.subscribe(setProgress), []);

  const start = async () => {
    setError("");
    try {
      await modelDownloadController.start(setProgress);
    } catch (reason) {
      setError(
        (reason as Error).message || "The model download did not complete.",
      );
    }
  };

  if (capability === AiCapability.Ready || aiCapabilityStore.isReady()) {
    return (
      <AppShell>
        <StateView
          mark="sage"
          title="Word is ready"
          message="The on-device model finished downloading. No page reload is needed."
        >
          <LinkButton to="/word/scripture" className="btn btn--primary">
            Open Scripture
          </LinkButton>
          <LinkButton to="/word/journal" className="btn btn--ghost">
            Open journal
          </LinkButton>
        </StateView>
      </AppShell>
    );
  }

  if (capability === AiCapability.Unsupported) {
    return (
      <AppShell>
        <StateView
          title="On-device Word is unavailable"
          message="This browser or device does not expose a compatible local model. Cenacle will not send private text to a cloud fallback."
        >
          <LinkButton to="/support" className="btn btn--primary">
            See browser support
          </LinkButton>
        </StateView>
      </AppShell>
    );
  }

  const downloading = capability === AiCapability.Downloading;
  const percent = progress?.percent ?? 0;
  const eta =
    progress && progress.etaSeconds > 0
      ? `About ${formatEta(progress.etaSeconds)} remaining`
      : "Preparing the local model…";

  return (
    <AppShell>
      <main className="container container-narrow section">
        <section className="card card--raised stack gap-5">
          <div>
            <span className="eyebrow">
              <Icon name="sparkle" size={16} />
              One-time setup
            </span>
            <h1 className="h1 mt-3">Download the on-device model</h1>
            <p className="lede mt-3">
              Word reflections and local language features use an estimated 1.9
              GB browser model. It runs on this device after download.
            </p>
          </div>
          <div>
            <div className="between">
              <span className="label">
                {downloading ? "Downloading" : "Ready to download"}
              </span>
              <span className="mono">{percent}% · 1.9 GB</span>
            </div>
            <div
              className="progress mt-2"
              role="progressbar"
              aria-label="On-device model download"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <div className="progress__bar" style={{ width: `${percent}%` }} />
            </div>
            <p className="hint">
              {downloading
                ? eta
                : "Download progress and an estimate will appear here."}
            </p>
          </div>
          {error && (
            <div className="banner banner--danger" role="alert">
              <Icon name="alert" />
              <span>{error}</span>
            </div>
          )}
          <div className="cluster gap-3">
            {!downloading && (
              <button
                className="btn btn--primary btn--lg"
                onClick={() => void start()}
              >
                Download model
              </button>
            )}
            {downloading && (
              <button
                className="btn btn--primary"
                onClick={() => {
                  modelDownloadController.continueInBackground();
                  navigate("/");
                }}
              >
                Continue in background
              </button>
            )}
            <LinkButton to="/" className="btn btn--quiet">
              Not now
            </LinkButton>
          </div>
          <div className="banner banner--sage">
            <Icon name="shield" />
            <div>
              <p className="banner__title">On-device · zero private requests</p>
              <p className="small muted">
                Presence remains available while this downloads. Journal text
                and themes are never sent with the model request.
              </p>
            </div>
          </div>
          <PrivacySeal />
        </section>
      </main>
    </AppShell>
  );
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} seconds`;
  return `${Math.ceil(seconds / 60)} minutes`;
}
