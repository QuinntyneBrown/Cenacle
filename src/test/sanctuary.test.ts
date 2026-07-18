import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalStore } from "../core/local-store";
import {
  SanctuaryLayer,
  VisualMode,
  VisualsSettings,
} from "../sanctuary/sanctuary";
import {
  CompanionState,
  FloatingCompanionController,
} from "../sanctuary/floating-companion";

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
});

describe("Sanctuary visuals", () => {
  it("persists ambient and independently audio-reactive toggles", () => {
    const store = new LocalStore(localStorage);
    const settings = new VisualsSettings(store, { enabled: false, observe: () => () => undefined } as never);
    settings.setEnabled(false);
    settings.setAudioReactive(true);
    expect(settings.audioReactiveActive()).toBe(false);
    expect(settings.motionGain()).toBe(0);
    expect(store.loadSettings()).toMatchObject({ ambientVisualsEnabled: false, audioReactiveEnabled: true });
  });

  it("minimizes rather than amplifies audio motion under reduce-motion", () => {
    const settings = new VisualsSettings(
      new LocalStore(localStorage),
      { enabled: true, observe: () => () => undefined } as never,
    );
    expect(settings.motionGain()).toBe(0.08);
    settings.setAudioReactive(false);
    expect(settings.motionGain()).toBe(0);
  });

  it("uses WebGPU when enabled, including reduced motion, and a still when disabled", async () => {
    const store = new LocalStore(localStorage);
    const settings = new VisualsSettings(store, { enabled: true, observe: () => () => undefined } as never);
    const probe = { isAvailable: vi.fn().mockResolvedValue(true) };
    const layer = new SanctuaryLayer(settings, probe as never, { show: vi.fn(), hide: vi.fn() } as never);
    await expect(layer.resolve()).resolves.toBe(VisualMode.GpuAtmosphere);
    settings.setEnabled(false);
    await expect(layer.resolve()).resolves.toBe(VisualMode.Still);
  });
});

describe("Floating prayer companion", () => {
  it("moves and restores the same stage while compact native controls remain live", async () => {
    const pipDocument = document.implementation.createHTMLDocument("Floating Cenacle");
    const close = vi.fn();
    const listeners = new Map<string, () => void>();
    const pipWindow = {
      document: pipDocument,
      close,
      addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
    } as unknown as Window;
    Object.defineProperty(window, "documentPictureInPicture", {
      configurable: true,
      value: { requestWindow: vi.fn().mockResolvedValue(pipWindow) },
    });
    const original = document.createElement("section");
    const stage = document.createElement("div");
    original.append(stage);
    document.body.append(original);
    const toggleMute = vi.fn();
    const leave = vi.fn();
    const controller = new FloatingCompanionController();

    await controller.pop(stage, {
      muted: false,
      latencyMs: 245,
      captionLine: "Peace be with you",
      toggleMute,
      leave,
    });

    expect(controller.state).toBe(CompanionState.Floating);
    expect(stage.ownerDocument).toBe(pipDocument);
    expect(pipDocument.querySelector("[data-pip-caption]")?.textContent).toBe("Peace be with you");
    expect(pipDocument.querySelector("[data-pip-latency]")?.textContent).toBe("245 ms");
    (pipDocument.querySelector("[data-pip-mute]") as HTMLButtonElement).click();
    (pipDocument.querySelector("[data-pip-leave]") as HTMLButtonElement).click();
    expect(toggleMute).toHaveBeenCalledOnce();
    expect(leave).toHaveBeenCalledOnce();

    controller.update({ muted: true, latencyMs: 310, captionLine: "Amen", toggleMute, leave });
    expect(pipDocument.querySelector("[data-pip-caption]")?.textContent).toBe("Amen");
    expect(pipDocument.querySelector("[data-pip-mute]")?.textContent).toBe("Unmute");

    listeners.get("pagehide")?.();
    expect(controller.state).toBe(CompanionState.Docked);
    expect(stage.parentElement).toBe(original);
    expect(original.querySelector(".pip-native-controls")).toBeNull();
    expect(close).toHaveBeenCalledOnce();
  });
});
