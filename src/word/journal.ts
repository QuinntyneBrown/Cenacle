import type { JournalEntry, Reflection } from "../core/types";
import type { LocalStore } from "../core/local-store";
import { InputSanitizer } from "../core/security";
import { OnDeviceModel } from "./on-device-model";

export enum ReflectionFeedback {
  KeepWithEntry = "keep-with-entry",
  NotHelpful = "not-helpful",
}

export class JournalEditor {
  draftText = "";
  readonly onDeviceSealVisible = true;
  get wordCount(): number {
    return this.countWords();
  }
  countWords(): number {
    return this.draftText.trim()
      ? this.draftText.trim().split(/\s+/).length
      : 0;
  }
  clear(): void {
    this.draftText = "";
  }
}

export class ReflectionService {
  constructor(
    private readonly model = new OnDeviceModel(),
    private readonly policy = new ReflectionPolicy(),
  ) {}
  async isAvailable(): Promise<boolean> {
    return (await this.model.availability()) === "ready";
  }

  async requestReflection(entryText: string): Promise<Reflection> {
    if (!entryText.trim())
      throw new RangeError("Write something before asking for a reflection.");
    let text = await this.model.prompt(
      `Reflect gently on the following journal entry. Name what you notice without diagnosing, directing, claiming divine authority, or telling the writer what to do. If you mention Scripture, call it illustrative. End by leaving the last word with the writer.\n\n${entryText}`,
      "You are a gentle, non-authoritative reflection aid running entirely on the user's device. Never claim to speak for God.",
    );
    if (!this.policy.isSafe(text)) {
      text = await this.model.prompt(
        `Rewrite this reflection so it contains no commands, diagnosis, claim to divine authority, or statement of what the writer should do. Use tentative language, label Scripture as illustrative, and explicitly leave the last word with the writer.\n\n${text}`,
        "You are a non-authoritative editing aid running on-device.",
      );
    }
    if (!this.policy.isSafe(text)) {
      throw new DOMException(
        "The local model did not produce a safely non-directive reflection.",
        "DataError",
      );
    }
    return {
      text,
      illustrativeReference: this.policy.illustrativeReference(text),
      affirmation:
        "Generated on this device · 0 requests out · the last word stays with you.",
      isDirective: false,
    };
  }
}

export class ReflectionPolicy {
  private readonly directive =
    /\b(you\s+(?:must|should|need to|have to)|god\s+(?:says|told me|wants you)|the lord\s+(?:says|commands)|diagnosis|diagnose[sd]?)\b/i;

  isSafe(text: string): boolean {
    const normalized = text.trim();
    const tentative =
      /\b(perhaps|may|might|could|seems?|notice|appears?)\b/i.test(normalized);
    const leavesLastWord =
      /\blast word\b[^.]{0,50}\b(you|writer|yours)\b/i.test(normalized);
    return (
      normalized.length > 0 &&
      tentative &&
      leavesLastWord &&
      !this.directive.test(normalized)
    );
  }

  illustrativeReference(text: string): string | undefined {
    const match = text.match(
      /\b(?:illustrative(?:ly)?(?:\s+scripture)?[:\s-]*)?((?:[1-3]\s+)?[A-Z][a-z]+\s+\d{1,3}:\d{1,3}(?:[–-]\d{1,3})?)/,
    );
    return match?.[1];
  }
}

export class JournalService {
  constructor(private readonly store: LocalStore) {}
  listEarlier(): JournalEntry[] {
    return this.store.listEntries();
  }
  save(text: string): JournalEntry {
    const normalized = new InputSanitizer().validate(text, 10_000, 1);
    const entry: JournalEntry = {
      id: crypto.randomUUID(),
      text: normalized,
      createdAt: new Date().toISOString(),
    };
    this.store.saveEntry(entry);
    return entry;
  }
  recordFeedback(
    entryId: string,
    reflection: Reflection,
    choice: ReflectionFeedback,
  ): void {
    if (choice === ReflectionFeedback.KeepWithEntry)
      this.store.keepReflection(entryId, reflection);
  }
}

export interface GuardResult {
  requestCount: number;
  passed: boolean;
}

/** Private actions are accepted only as local closures with no network capability. */
export class NetworkGuard {
  private requests = 0;
  outboundCount(): number {
    return this.requests;
  }
  async assertZeroEgress<T>(
    action: () => Promise<T> | T,
  ): Promise<{ result: T; guard: GuardResult }> {
    const originalFetch = globalThis.fetch;
    const before = this.requests;
    globalThis.fetch = ((..._args: Parameters<typeof fetch>) => {
      this.requests += 1;
      return Promise.reject(
        new DOMException(
          "A private action attempted a network request.",
          "SecurityError",
        ),
      );
    }) as typeof fetch;
    try {
      const result = await action();
      const count = this.requests - before;
      if (count > 0) {
        throw new DOMException(
          "The private action was stopped because it attempted a network request.",
          "SecurityError",
        );
      }
      return { result, guard: { requestCount: count, passed: count === 0 } };
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
}
