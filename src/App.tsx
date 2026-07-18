import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Capability,
  CapabilityState,
  CapabilityDetector,
  CapabilityReport,
  DegradationPolicy,
  PresenceDecision,
  SanctuaryDecision,
  WordDecision,
  type DegradationPlan,
} from "./core/capabilities";
import type { LiveRoomResources } from "./presence/controllers";
import {
  ErrorBoundary,
  LinkButton,
  StateView,
  AppShell,
} from "./ui/components";
import {
  GreenRoomPage,
  HostPage,
  JoinPage,
  LandingPage,
} from "./ui/presence-entry";
import { RoomPage } from "./ui/room";
import { navigate, usePath } from "./ui/router";
import { SettingsPage } from "./ui/settings";
import { SupportPage } from "./ui/support";
import { JournalPage, ScripturePage } from "./ui/word";
import { ModelDownloadPage } from "./ui/model-download";
import { TelemetryClient } from "./core/observability";
import {
  AiCapability,
  AiCapabilityDetector,
  aiCapabilityStore,
  onDeviceModel,
} from "./word/on-device-model";

const unavailablePlan: DegradationPlan = {
  presence: PresenceDecision.Unsupported,
  word: WordDecision.Hidden,
  sanctuary: SanctuaryDecision.StillBackdrop,
};
const bootStartedAt = performance.now();

interface ActiveRoom {
  resources: LiveRoomResources;
  displayName: string;
}

export default function App() {
  const path = usePath();
  const roomOrigin = useMemo(
    () =>
      (import.meta.env.VITE_ROOM_ORIGIN || "https://localhost:4433").replace(
        /\/$/,
        "",
      ),
    [],
  );
  const [report, setReport] = useState<CapabilityReport | null>(null);
  const [plan, setPlan] = useState<DegradationPlan>(unavailablePlan);
  const [aiCapability, setAiCapability] = useState<AiCapability | null>(null);
  const [activeRoom, setActiveRoom] = useState<ActiveRoom | null>(null);
  const telemetry = useMemo(
    () => new TelemetryClient(roomOrigin),
    [roomOrigin],
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      telemetry.record("app_interactive_ms", performance.now() - bootStartedAt);
      void telemetry.flush();
    });
    const unexpected = () => {
      telemetry.record("unexpected_error", 1);
      void telemetry.flush();
    };
    const pagehide = () => void telemetry.flush();
    window.addEventListener("error", unexpected);
    window.addEventListener("unhandledrejection", unexpected);
    window.addEventListener("pagehide", pagehide);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("error", unexpected);
      window.removeEventListener("unhandledrejection", unexpected);
      window.removeEventListener("pagehide", pagehide);
    };
  }, [telemetry]);

  useEffect(() => {
    let current = true;
    const unsubscribe = aiCapabilityStore.subscribe((capability) => {
      if (!current) return;
      setAiCapability(capability);
      setReport((existing) => {
        if (!existing) return existing;
        const states = new Map(existing.states);
        states.set(
          Capability.OnDeviceAI,
          capability === AiCapability.Ready
            ? CapabilityState.Available
            : CapabilityState.Unavailable,
        );
        return new CapabilityReport(states);
      });
      setPlan((existing) => ({
        ...existing,
        word:
          capability === AiCapability.Ready
            ? WordDecision.Enabled
            : WordDecision.Hidden,
      }));
    });
    void Promise.all([
      new CapabilityDetector().detect(),
      new AiCapabilityDetector(onDeviceModel, aiCapabilityStore).detect(),
    ]).then(([nextReport, modelCapability]) => {
      if (!current) return;
      const nextPlan = new DegradationPolicy().evaluate(nextReport);
      nextPlan.word =
        modelCapability === AiCapability.Ready
          ? WordDecision.Enabled
          : WordDecision.Hidden;
      setReport(nextReport);
      setAiCapability(modelCapability);
      setPlan(nextPlan);
    });
    return () => {
      current = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (aiCapability !== AiCapability.Downloading) return;
    const timer = window.setInterval(() => {
      void onDeviceModel
        .availability()
        .then((capability) => aiCapabilityStore.set(capability));
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [aiCapability]);

  useEffect(() => {
    document.documentElement.dataset.wordHidden = String(
      aiCapability === AiCapability.Unsupported,
    );
    return () => {
      delete document.documentElement.dataset.wordHidden;
    };
  }, [aiCapability]);

  const enterRoom = useCallback(
    (resources: LiveRoomResources, displayName: string) => {
      setActiveRoom({ resources, displayName });
      telemetry.record("origin_connect", 1);
      void telemetry.flush();
      navigate(`/room/${resources.room.code}`);
    },
    [telemetry],
  );

  const exitRoom = useCallback(() => {
    setActiveRoom((current) => {
      current?.resources.encoder.stop();
      current?.resources.transport.close();
      current?.resources.stream.getTracks().forEach((track) => track.stop());
      return null;
    });
    telemetry.record("origin_disconnect", 1);
    void telemetry.flush();
    navigate("/");
  }, [telemetry]);

  const wordUnavailable = (
    <AppShell>
      <StateView
        title="Word is unavailable here"
        message="This browser has no on-device AI runtime. Cenacle does not send private text to a cloud fallback."
      >
        <LinkButton to="/support" className="btn btn--primary">
          See browser support
        </LinkButton>
      </StateView>
    </AppShell>
  );
  const wordChecking = (
    <AppShell>
      <StateView
        mark="sage"
        title="Checking the on-device model"
        message="Cenacle is checking browser and model availability without sending private content."
      />
    </AppShell>
  );
  const gatedWord = (readyPage: ReactNode) => {
    if (!aiCapability) return wordChecking;
    if (aiCapability === AiCapability.Ready) return readyPage;
    if (
      aiCapability === AiCapability.Downloadable ||
      aiCapability === AiCapability.Downloading
    ) {
      return <ModelDownloadPage capability={aiCapability} />;
    }
    return wordUnavailable;
  };
  const greenRoomCode = path.match(/^\/r\/([A-HJ-NP-Z2-9]{6})$/)?.[1];

  let page;
  if (path === "/") page = <LandingPage report={report} />;
  else if (path === "/host")
    page = (
      <HostPage
        roomOrigin={roomOrigin}
        plan={plan}
        report={report}
        onEntered={enterRoom}
      />
    );
  else if (path === "/join") page = <JoinPage roomOrigin={roomOrigin} />;
  else if (greenRoomCode)
    page = (
      <GreenRoomPage
        code={greenRoomCode}
        roomOrigin={roomOrigin}
        plan={plan}
        report={report}
        onEntered={enterRoom}
      />
    );
  else if (/^\/room\//.test(path) && activeRoom)
    page = (
      <RoomPage
        {...activeRoom}
        roomOrigin={roomOrigin}
        plan={plan}
        onExit={exitRoom}
      />
    );
  else if (/^\/room\//.test(path))
    page = (
      <AppShell>
        <StateView
          title="This room session is no longer active"
          message="Use the invitation code to enter the room again."
        >
          <LinkButton to="/join" className="btn btn--primary">
            Join a room
          </LinkButton>
        </StateView>
      </AppShell>
    );
  else if (path === "/word/scripture") page = gatedWord(<ScripturePage />);
  else if (path === "/word/journal") page = gatedWord(<JournalPage />);
  else if (path === "/word/model") page = gatedWord(<ScripturePage />);
  else if (path === "/settings") page = <SettingsPage />;
  else if (path === "/support") page = <SupportPage report={report} />;
  else
    page = (
      <AppShell>
        <StateView
          title="Page not found"
          message="That Cenacle page does not exist."
        >
          <LinkButton to="/" className="btn btn--primary">
            Return home
          </LinkButton>
        </StateView>
      </AppShell>
    );

  return <ErrorBoundary>{page}</ErrorBoundary>;
}
