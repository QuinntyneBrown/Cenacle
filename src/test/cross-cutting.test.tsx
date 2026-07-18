import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Breakpoint,
  FocusManager,
  ResponsiveLayout,
} from "../core/accessibility";
import {
  Capability,
  CapabilityDetector,
  CapabilityReport,
  CapabilityState,
  DegradationPolicy,
  PresenceDecision,
  SanctuaryDecision,
  WordDecision,
} from "../core/capabilities";
import { LocalStore } from "../core/local-store";
import {
  FrameScheduler,
  LatencyBudget,
  LatencyMeter,
  LoadStrategy,
  SmallRoomTopology,
  WorkClass,
} from "../core/performance";
import {
  CspPolicy,
  InputSanitizer,
  RateDecision,
  RateLimiter,
} from "../core/security";
import { defaultSettings } from "../core/types";
import { SettingsPage } from "../ui/settings";
import { JournalPanel } from "../ui/word";
import { NetworkGuard } from "../word/journal";

let mountedRoot: Root | null = null;
let mountedNode: HTMLDivElement | null = null;

afterEach(async () => {
  if (mountedRoot) await act(() => mountedRoot?.unmount());
  mountedNode?.remove();
  mountedRoot = null;
  mountedNode = null;
  localStorage.clear();
  sessionStorage.clear();
  Reflect.deleteProperty(window, "LanguageModel");
  Reflect.deleteProperty(navigator, "gpu");
  vi.restoreAllMocks();
});

async function render(element: React.ReactNode): Promise<HTMLDivElement> {
  mountedNode = document.createElement("div");
  document.body.append(mountedNode);
  mountedRoot = createRoot(mountedNode);
  await act(async () => {
    mountedRoot?.render(element);
    await Promise.resolve();
    await Promise.resolve();
  });
  return mountedNode;
}

describe("cross-cutting capability and degradation contracts", () => {
  it("classifies all four capabilities and degrades each feature independently", () => {
    const report = new CapabilityReport(
      new Map([
        [Capability.WebTransport, CapabilityState.Available],
        [Capability.WebCodecs, CapabilityState.Available],
        [Capability.WebGPU, CapabilityState.Unavailable],
        [Capability.OnDeviceAI, CapabilityState.Unavailable],
      ]),
    );

    expect(report.availableCount()).toBe(2);
    expect(new DegradationPolicy().evaluate(report)).toEqual({
      presence: PresenceDecision.Live,
      word: WordDecision.Hidden,
      sanctuary: SanctuaryDecision.StillBackdrop,
    });
  });

  it("contains rejected asynchronous probes instead of throwing at startup", async () => {
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: {
        requestAdapter: vi.fn().mockRejectedValue(new Error("blocked")),
      },
    });
    Object.defineProperty(window, "LanguageModel", {
      configurable: true,
      value: { availability: vi.fn().mockRejectedValue(new Error("blocked")) },
    });

    const report = await new CapabilityDetector().detect();

    expect(
      Object.values(Capability).map((capability) => report.stateOf(capability)),
    ).toHaveLength(4);
    expect(report.stateOf(Capability.WebGPU)).toBe(CapabilityState.Unavailable);
    expect(report.stateOf(Capability.OnDeviceAI)).toBe(
      CapabilityState.Unavailable,
    );
  });

  it("keeps journal writing available while hiding unavailable reflection", async () => {
    const node = await render(<JournalPanel reflectionEnabled={false} />);

    expect(node.querySelector("textarea")?.maxLength).toBe(10_000);
    expect(node.textContent).toContain("Save entry");
    expect(node.textContent).not.toContain("Ask for a reflection");
    expect(node.textContent).toContain(
      "will not send your entry to a cloud model",
    );
  });
});

describe("cross-cutting privacy and security contracts", () => {
  it("validates lengths, removes controls, encodes non-React sinks, and parses room links", () => {
    const sanitizer = new InputSanitizer();

    expect(sanitizer.validate("  prayer\u0000 room  ", 60, 1)).toBe(
      "prayer room",
    );
    expect(() => sanitizer.validate("x".repeat(61), 60, 1)).toThrow(RangeError);
    expect(sanitizer.encode(`<script data-x="1">&</script>`)).toBe(
      "&lt;script data-x=&quot;1&quot;&gt;&amp;&lt;/script&gt;",
    );
    expect(sanitizer.parseRoomReference("https://cenacle.test/r/abc234")).toBe(
      "ABC234",
    );
    expect(() => sanitizer.parseRoomReference("O0I1XX")).toThrow(TypeError);
  });

  it("actively blocks and counts an attempted request during a private action", async () => {
    const upstream = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    globalThis.fetch = upstream;
    const guard = new NetworkGuard();

    const safe = await guard.assertZeroEgress(() => "kept locally");
    expect(safe.guard).toEqual({ requestCount: 0, passed: true });

    await expect(
      guard.assertZeroEgress(async () => {
        await fetch("https://example.test/private").catch(() => undefined);
        return "unsafe result";
      }),
    ).rejects.toMatchObject({ name: "SecurityError" });
    expect(guard.outboundCount()).toBe(1);
    expect(upstream).not.toHaveBeenCalled();
    expect(globalThis.fetch).toBe(upstream);
  });

  it("ships an explicit room-only connection policy and fixed local rate limiting", () => {
    const policy = new CspPolicy("https://rooms.cenacle.test");
    expect(policy.header()).toContain("script-src 'self'");
    expect(policy.header()).toContain(
      "connect-src 'self' https://rooms.cenacle.test",
    );
    expect(policy.header()).toContain("frame-ancestors 'none'");
    expect(policy.header()).not.toMatch(/analytics|openai|anthropic/i);

    const limiter = new RateLimiter(2, 60_000);
    limiter.record("client", 0);
    limiter.record("client", 1);
    expect(limiter.check("client", 59_999)).toBe(RateDecision.Throttled);
    expect(limiter.check("client", 60_000)).toBe(RateDecision.Allowed);
  });

  it("persists every preference locally and clears all private origin data", () => {
    const store = new LocalStore(localStorage);
    const changed = {
      ...defaultSettings,
      cameraId: "camera-1",
      microphoneId: "microphone-1",
      speakerId: "speaker-1",
      captionsEnabled: false,
      ambientVisualsEnabled: false,
    };
    store.saveSettings(changed);
    store.saveEntry({
      id: "entry",
      text: "private",
      createdAt: new Date(0).toISOString(),
    });
    store.setSession({ token: "ephemeral" });

    expect(new LocalStore(localStorage).loadSettings()).toEqual(changed);
    expect(store.listEntries()).toHaveLength(1);
    store.clearAll();
    expect(store.listEntries()).toEqual([]);
    expect(store.loadSettings()).toEqual(defaultSettings);
    expect(store.getSession()).toBeNull();
  });
});

describe("cross-cutting performance and accessibility contracts", () => {
  it("holds the declared latency, load, topology, and frame-shedding budgets", () => {
    const meter = new LatencyMeter();
    const sample = meter.measure(1_000, 1_399);
    expect(new LatencyBudget().evaluate(sample)).toBe("within-budget");
    expect(meter.readout()).toBe("399 ms");
    expect(new LoadStrategy().ttiBudgetMs).toBe(3_000);
    expect(new SmallRoomTopology()).toMatchObject({
      capacity: 8,
      usesSfu: false,
    });

    const runs: string[] = [];
    const scheduler = new FrameScheduler();
    scheduler.shedNonEssential();
    vi.spyOn(performance, "now").mockReturnValue(0);
    scheduler.schedule([
      {
        workClass: WorkClass.AudioReactive,
        essential: false,
        run: () => runs.push("audio"),
      },
      {
        workClass: WorkClass.Ambient,
        essential: false,
        run: () => runs.push("ambient"),
      },
      {
        workClass: WorkClass.Presence,
        essential: true,
        run: () => runs.push("presence"),
      },
    ]);
    expect(runs).toEqual(["presence", "ambient"]);
  });

  it("resolves every XS–XL breakpoint and traps/restores keyboard focus", async () => {
    const layout = new ResponsiveLayout();
    expect(
      [320, 576, 768, 992, 1200].map((width) => layout.resolve(width)),
    ).toEqual([
      Breakpoint.XS,
      Breakpoint.SM,
      Breakpoint.MD,
      Breakpoint.LG,
      Breakpoint.XL,
    ]);

    const opener = document.createElement("button");
    const dialog = document.createElement("div");
    const first = document.createElement("button");
    const last = document.createElement("button");
    dialog.append(first, last);
    document.body.append(opener, dialog);
    opener.focus();
    const focus = new FocusManager();
    focus.trap(dialog, opener);
    await Promise.resolve();
    expect(document.activeElement).toBe(first);
    last.focus();
    last.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    expect(document.activeElement).toBe(first);
    first.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
      }),
    );
    expect(document.activeElement).toBe(last);
    focus.release();
    expect(document.activeElement).toBe(opener);
    opener.remove();
    dialog.remove();
  });

  it("renders every settings contract with explicit Save and Cancel", async () => {
    const node = await render(<SettingsPage webGpuAvailable={false} />);
    const copy = node.textContent ?? "";

    expect(copy).toContain("Camera & microphone");
    expect(copy).toContain("H.264");
    expect(copy).toContain("VP9");
    expect(copy).toContain("< 400 ms glass-to-glass");
    expect(copy).toContain("Captions & Word");
    expect(copy).toContain("Prompt API");
    expect(copy).toContain("Ambient visuals (WebGPU)");
    expect(copy).toContain("Audio-reactive worship");
    expect(copy).toContain("reduce-motion");
    expect(copy).toContain("A calm still backdrop will be used");
    expect(copy).toContain("Cancel");
    expect(copy).toContain("Save changes");
  });

  it("keeps both visual registers at WCAG AA text contrast and defines motion/focus fallbacks", () => {
    const css = readFileSync(resolve("docs/mocks/assets/cenacle.css"), "utf8");
    const nightStart = css.indexOf(".night {");
    const light = css.slice(0, nightStart);
    const night = css.slice(
      nightStart,
      css.indexOf("/* ---- Type", nightStart),
    );
    const token = (source: string, name: string) => {
      const value = source.match(
        new RegExp(`--${name}:\\s*#([0-9A-Fa-f]{6})`),
      )?.[1];
      if (!value) throw new Error(`Missing color token ${name}`);
      return `#${value}`;
    };

    const lightBackground = token(light, "vellum");
    for (const name of ["text", "text-soft", "muted", "faint", "ember-deep"]) {
      expect(
        contrast(token(light, name), lightBackground),
        name,
      ).toBeGreaterThanOrEqual(4.5);
    }
    const nightBackground = token(light, "ink");
    for (const name of ["text", "text-soft", "muted", "faint", "accent-ink"]) {
      expect(
        contrast(token(night, name), nightBackground),
        name,
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(
      contrast(token(light, "sage"), token(light, "paper")),
    ).toBeGreaterThanOrEqual(4.5);
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:/);
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toMatch(/\.sacred\s*\{[^}]*font-family:\s*var\(--f-sacred\)/);
    expect(css).toMatch(
      /\.journal-editor\s*\{[^}]*font-family:\s*var\(--f-sacred\)/,
    );
  });
});

function contrast(foreground: string, background: string): number {
  const luminance = (value: string) => {
    const channels = value
      .slice(1)
      .match(/../g)!
      .map((part) => Number.parseInt(part, 16) / 255)
      .map((part) =>
        part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4,
      );
    return (
      0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
    );
  };
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
