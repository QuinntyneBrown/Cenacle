import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalStore } from "../core/local-store";
import { CaptionSegmentStatus } from "../core/types";
import { CaptionController } from "../word/captions";
import {
  JournalEditor,
  JournalService,
  ReflectionFeedback,
  ReflectionPolicy,
  ReflectionService,
} from "../word/journal";
import {
  AiCapability,
  AiCapabilityDetector,
  CapabilityStore,
  ModelDownloadController,
} from "../word/on-device-model";
import { PassageMatcher, VerseIndex } from "../word/verse-index";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Scripture surfacing", () => {
  it("retrieves an existing indexed passage and never invents a reference", () => {
    const index = new VerseIndex();
    const matches = index.lookup("I feel anxious and need peace");
    expect(matches[0]).toMatchObject({
      reference: "Philippians 4:6–7",
      themes: expect.arrayContaining(["anxiety", "peace"]),
    });
    expect(matches[0]?.text).toContain("peace of God");

    const unmatched = new PassageMatcher(index).surface("orbital mechanics");
    expect(unmatched.matched).toBe(false);
    expect(unmatched.passage).toBeUndefined();
    expect(unmatched.suggestions.length).toBeGreaterThan(0);
  });

  it("stores recent themes locally without issuing a request", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const store = new LocalStore(localStorage);
    store.addRecentTheme(" Fear ");
    store.addRecentTheme("fear");
    store.addRecentTheme("Waiting");
    expect(store.recentThemes()).toEqual(["Waiting", "fear"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("Private journal", () => {
  it("counts words live and clears an empty or populated draft safely", () => {
    const editor = new JournalEditor();
    expect(editor.wordCount).toBe(0);
    editor.clear();
    editor.draftText = "grief, hope, and patient waiting";
    expect(editor.wordCount).toBe(5);
    editor.clear();
    expect(editor.draftText).toBe("");
  });

  it("saves entries and feedback only in the origin-scoped store", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const store = new LocalStore(localStorage);
    const service = new JournalService(store);
    const entry = service.save("A private lament");
    const reflection = {
      text: "Perhaps grief and hope are both present; the last word remains with you.",
      affirmation: "Generated on this device · 0 requests out.",
      isDirective: false as const,
    };
    service.recordFeedback(entry.id, reflection, ReflectionFeedback.KeepWithEntry);
    expect(service.listEarlier()[0]?.keptReflection).toEqual(reflection);
    service.recordFeedback(entry.id, reflection, ReflectionFeedback.NotHelpful);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("repairs directive model output locally before presenting it", async () => {
    const model = {
      availability: vi.fn().mockResolvedValue(AiCapability.Ready),
      prompt: vi
        .fn()
        .mockResolvedValueOnce("You should pray harder because God says so.")
        .mockResolvedValueOnce(
          "Perhaps a desire for rest is present. Psalm 34:18 is illustrative, and the last word remains with you.",
        ),
    };
    const reflection = await new ReflectionService(model as never).requestReflection("I am tired.");
    expect(model.prompt).toHaveBeenCalledTimes(2);
    expect(reflection.isDirective).toBe(false);
    expect(reflection.illustrativeReference).toBe("Psalm 34:18");
    expect(reflection.affirmation).toContain("0 requests out");
  });

  it("refuses model text that remains authoritative after one local repair", async () => {
    const model = { prompt: vi.fn().mockResolvedValue("You must do this because the Lord commands it.") };
    await expect(new ReflectionService(model as never).requestReflection("I am unsure.")).rejects.toMatchObject({ name: "DataError" });
    expect(new ReflectionPolicy().isSafe("You should obey.")).toBe(false);
  });
});

describe("On-device model lifecycle", () => {
  it("detects downloadable state without sending private input", async () => {
    const model = { availability: vi.fn().mockResolvedValue(AiCapability.Downloadable) };
    const store = new CapabilityStore();
    await expect(new AiCapabilityDetector(model as never, store).detect()).resolves.toBe(AiCapability.Downloadable);
    expect(store.current).toBe(AiCapability.Downloadable);
  });

  it("publishes download progress and enables Word on completion", async () => {
    const model = {
      download: vi.fn(async (listener: (progress: { bytesTotal: number; bytesDone: number; percent: number; etaSeconds: number }) => void) => {
        listener({ bytesTotal: 1_900_000_000, bytesDone: 950_000_000, percent: 50, etaSeconds: 20 });
      }),
    };
    const store = new CapabilityStore();
    const controller = new ModelDownloadController(model as never, store);
    const seen: number[] = [];
    controller.subscribe((progress) => { if (progress) seen.push(progress.percent); });
    await controller.start(() => undefined);
    expect(seen).toEqual([50, 100]);
    expect(store.current).toBe(AiCapability.Ready);
    expect(controller.progress?.bytesTotal).toBe(1_900_000_000);
  });
});

describe("Local captions", () => {
  it("persists language and on/off state and passes the mixed audio track", () => {
    const store = new LocalStore(localStorage);
    const start = vi.fn();
    const transcriber = {
      isAvailable: () => true,
      configure: vi.fn(),
      start,
      stop: vi.fn(),
      push: vi.fn(),
    };
    const controller = new CaptionController(transcriber as never, store);
    controller.setLanguage("fr-FR");
    controller.setEnabled(true);
    const track = { kind: "audio", readyState: "live" } as MediaStreamTrack;
    controller.start("p1", "Maria", () => undefined, track);
    expect(start.mock.calls[0]?.[3]).toBe(track);
    expect(store.loadSettings()).toMatchObject({ captionLanguage: "fr-FR", captionsEnabled: true });
    expect(() => controller.setLanguage("xx-ZZ")).toThrow(RangeError);
  });

  it("keeps finalized and in-progress caption segments distinct", () => {
    const controller = new CaptionController({ isAvailable: () => false } as never, new LocalStore(localStorage));
    const listener = vi.fn();
    (controller as unknown as { onSegmentListener: typeof listener }).onSegmentListener = listener;
    controller.onSegment({ speakerId: "p1", speakerName: "Maria", text: "Praying", status: CaptionSegmentStatus.InProgress });
    controller.onSegment({ speakerId: "p1", speakerName: "Maria", text: "Praying together", status: CaptionSegmentStatus.Finalized });
    expect(listener.mock.calls.map(([segment]) => segment.status)).toEqual([
      CaptionSegmentStatus.InProgress,
      CaptionSegmentStatus.Finalized,
    ]);
  });
});
