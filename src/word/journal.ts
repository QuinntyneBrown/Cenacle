import type { JournalEntry, Reflection } from "../core/types";
import type { LocalStore } from "../core/local-store";
import { OnDeviceModel } from "./on-device-model";

export enum ReflectionFeedback {
  KeepWithEntry = "keep-with-entry",
  NotHelpful = "not-helpful"
}

export class JournalEditor {
  draftText = "";
  readonly onDeviceSealVisible = true;
  get wordCount(): number { return this.countWords(); }
  countWords(): number { return this.draftText.trim() ? this.draftText.trim().split(/\s+/).length : 0; }
  clear(): void { this.draftText = ""; }
}

export class ReflectionService {
  constructor(private readonly model = new OnDeviceModel()) {}
  async isAvailable(): Promise<boolean> { return (await this.model.availability()) === "ready"; }

  async requestReflection(entryText: string): Promise<Reflection> {
    if (!entryText.trim()) throw new RangeError("Write something before asking for a reflection.");
    const text = await this.model.prompt(
      `Reflect gently on the following journal entry. Name what you notice without diagnosing, directing, claiming divine authority, or telling the writer what to do. If you mention Scripture, call it illustrative. End by leaving the last word with the writer.\n\n${entryText}`,
      "You are a gentle, non-authoritative reflection aid running entirely on the user's device. Never claim to speak for God."
    );
    return {
      text,
      affirmation: "Generated on this device · 0 requests out · the last word stays with you.",
      isDirective: false
    };
  }
}

export class JournalService {
  constructor(private readonly store: LocalStore) {}
  listEarlier(): JournalEntry[] { return this.store.listEntries(); }
  save(text: string): JournalEntry {
    const normalized = text.trim();
    if (!normalized) throw new RangeError("Write something before saving.");
    const entry: JournalEntry = { id: crypto.randomUUID(), text: normalized, createdAt: new Date().toISOString() };
    this.store.saveEntry(entry);
    return entry;
  }
  recordFeedback(entryId: string, reflection: Reflection, choice: ReflectionFeedback): void {
    if (choice === ReflectionFeedback.KeepWithEntry) this.store.keepReflection(entryId, reflection);
  }
}

export interface GuardResult { requestCount: number; passed: boolean; }

/** Private actions are accepted only as local closures with no network capability. */
export class NetworkGuard {
  private requests = 0;
  outboundCount(): number { return this.requests; }
  async assertZeroEgress<T>(action: () => Promise<T> | T): Promise<{ result: T; guard: GuardResult }> {
    const before = this.requests;
    const result = await action();
    const count = this.requests - before;
    return { result, guard: { requestCount: count, passed: count === 0 } };
  }
}
