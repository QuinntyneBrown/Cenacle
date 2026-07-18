import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CapabilityDetector,
  CapabilityReport,
  DegradationPolicy,
  PresenceDecision,
  SanctuaryDecision,
  WordDecision,
  type DegradationPlan
} from "./core/capabilities";
import type { LiveRoomResources } from "./presence/controllers";
import { ErrorBoundary, LinkButton, StateView, AppShell } from "./ui/components";
import { GreenRoomPage, HostPage, JoinPage, LandingPage } from "./ui/presence-entry";
import { RoomPage } from "./ui/room";
import { navigate, usePath } from "./ui/router";
import { SettingsPage } from "./ui/settings";
import { SupportPage } from "./ui/support";
import { JournalPage, ScripturePage } from "./ui/word";

const unavailablePlan: DegradationPlan = {
  presence: PresenceDecision.Unsupported,
  word: WordDecision.Hidden,
  sanctuary: SanctuaryDecision.StillBackdrop
};

interface ActiveRoom {
  resources: LiveRoomResources;
  displayName: string;
}

export default function App() {
  const path = usePath();
  const roomOrigin = useMemo(
    () => (import.meta.env.VITE_ROOM_ORIGIN || "https://localhost:4433").replace(/\/$/, ""),
    []
  );
  const [report, setReport] = useState<CapabilityReport | null>(null);
  const [plan, setPlan] = useState<DegradationPlan>(unavailablePlan);
  const [activeRoom, setActiveRoom] = useState<ActiveRoom | null>(null);

  useEffect(() => {
    let current = true;
    void new CapabilityDetector().detect().then((nextReport) => {
      if (!current) return;
      setReport(nextReport);
      setPlan(new DegradationPolicy().evaluate(nextReport));
    });
    return () => { current = false; };
  }, []);

  const enterRoom = useCallback((resources: LiveRoomResources, displayName: string) => {
    setActiveRoom({ resources, displayName });
    navigate(`/room/${resources.room.code}`);
  }, []);

  const exitRoom = useCallback(() => {
    setActiveRoom((current) => {
      current?.resources.encoder.stop();
      current?.resources.transport.close();
      current?.resources.stream.getTracks().forEach((track) => track.stop());
      return null;
    });
    navigate("/");
  }, []);

  const wordUnavailable = <AppShell><StateView title="Word is unavailable here" message="This browser has no on-device AI runtime. Cenacle does not send private text to a cloud fallback."><LinkButton to="/support" className="btn btn--primary">See browser support</LinkButton></StateView></AppShell>;
  const greenRoomCode = path.match(/^\/r\/([A-HJ-NP-Z2-9]{6})$/)?.[1];

  let page;
  if (path === "/") page = <LandingPage report={report}/>;
  else if (path === "/host") page = <HostPage roomOrigin={roomOrigin} plan={plan} report={report} onEntered={enterRoom}/>;
  else if (path === "/join") page = <JoinPage roomOrigin={roomOrigin}/>;
  else if (greenRoomCode) page = <GreenRoomPage code={greenRoomCode} roomOrigin={roomOrigin} plan={plan} report={report} onEntered={enterRoom}/>;
  else if (/^\/room\//.test(path) && activeRoom) page = <RoomPage {...activeRoom} roomOrigin={roomOrigin} plan={plan} onExit={exitRoom}/>;
  else if (/^\/room\//.test(path)) page = <AppShell><StateView title="This room session is no longer active" message="Use the invitation code to enter the room again."><LinkButton to="/join" className="btn btn--primary">Join a room</LinkButton></StateView></AppShell>;
  else if (path === "/word/scripture") page = plan.word === WordDecision.Enabled ? <ScripturePage/> : wordUnavailable;
  else if (path === "/word/journal") page = plan.word === WordDecision.Enabled ? <JournalPage/> : wordUnavailable;
  else if (path === "/settings") page = <SettingsPage/>;
  else if (path === "/support") page = <SupportPage report={report}/>;
  else page = <AppShell><StateView title="Page not found" message="That Cenacle page does not exist."><LinkButton to="/" className="btn btn--primary">Return home</LinkButton></StateView></AppShell>;

  return <ErrorBoundary>{page}</ErrorBoundary>;
}
