export enum BudgetVerdict {
  WithinBudget = "within-budget",
  Exceeded = "exceeded"
}

export enum WorkClass {
  Presence = "presence",
  Ambient = "ambient",
  AudioReactive = "audio-reactive"
}

export interface LatencySample {
  captureTs: number;
  renderTs: number;
  glassToGlassMs: number;
}

export class LatencyMeter {
  private latest: LatencySample | null = null;

  measure(captureTs: number, renderTs: number): LatencySample {
    this.latest = { captureTs, renderTs, glassToGlassMs: Math.max(0, renderTs - captureTs) };
    return this.latest;
  }

  readout(): string {
    return this.latest ? `${Math.round(this.latest.glassToGlassMs)} ms` : this.placeholder();
  }

  placeholder(): string {
    return "— ms";
  }
}

export class LatencyBudget {
  readonly targetMs = 400;
  readonly prioritizeLowLatency = true;

  evaluate(sample: LatencySample): BudgetVerdict {
    return sample.glassToGlassMs < this.targetMs ? BudgetVerdict.WithinBudget : BudgetVerdict.Exceeded;
  }

  shouldDrop(sample: LatencySample): boolean {
    return this.prioritizeLowLatency && sample.glassToGlassMs > this.targetMs * 1.5;
  }
}

export interface RenderTask {
  workClass: WorkClass;
  essential: boolean;
  run(): void;
}

export class FrameScheduler {
  readonly frameBudgetMs = 1000 / 60;
  private shedLevel = 0;

  schedule(tasks: RenderTask[]): void {
    const started = performance.now();
    const ordered = [...tasks].sort((a, b) => Number(b.essential) - Number(a.essential));
    for (const task of ordered) {
      if (!task.essential && this.shouldShed(task.workClass, performance.now() - started)) continue;
      task.run();
    }
    this.shedLevel = performance.now() - started > this.frameBudgetMs ? Math.min(3, this.shedLevel + 1) : Math.max(0, this.shedLevel - 1);
  }

  shedNonEssential(): void {
    this.shedLevel = Math.min(3, this.shedLevel + 1);
  }

  private shouldShed(workClass: WorkClass, elapsed: number): boolean {
    if (elapsed > this.frameBudgetMs) return true;
    if (workClass === WorkClass.AudioReactive) return this.shedLevel >= 1;
    if (workClass === WorkClass.Ambient) return this.shedLevel >= 2;
    return false;
  }
}

export class LoadStrategy {
  readonly ttiBudgetMs = 3_000;

  firstPaint(task: () => void): void {
    task();
  }

  deferModelDownload(task: () => void): void {
    this.defer(task);
  }

  deferGpuInit(task: () => void): void {
    this.defer(task);
  }

  private defer(task: () => void): void {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(task, { timeout: 2_000 });
    } else {
      globalThis.setTimeout(task, 0);
    }
  }
}

export class SmallRoomTopology {
  readonly capacity = 8;
  readonly usesSfu = false;

  admit(present: number): boolean {
    return present < this.capacity;
  }
}
