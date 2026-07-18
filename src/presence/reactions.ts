import { liveRegionAnnouncer, LiveRegionPoliteness } from "../core/accessibility";
import { ReactionKind, type Reaction } from "../core/types";
import type { RoomTransport } from "../media/room-transport";

export class ReactionSender {
  readonly minIntervalMs = 750;
  lastSentAt = 0;

  constructor(private readonly senderId: string, private readonly transport: RoomTransport) {}

  async send(kind: ReactionKind, now = Date.now()): Promise<boolean> {
    if (now - this.lastSentAt < this.minIntervalMs) return false;
    this.lastSentAt = now;
    await this.transport.sendReaction({ kind, senderId: this.senderId, sentAt: now });
    return true;
  }
}

export class ReactionCounter {
  readonly windowMs = 60_000;
  private reactions: Reaction[] = [];

  record(reaction: Reaction): void {
    this.reactions.push(reaction);
    this.prune(Date.now());
    liveRegionAnnouncer.announce(`${this.count()} reactions in the last minute`, LiveRegionPoliteness.Polite);
  }

  count(now = Date.now()): number {
    this.prune(now);
    return this.reactions.length;
  }

  prune(now: number): void {
    this.reactions = this.reactions.filter((reaction) => now - reaction.sentAt < this.windowMs);
  }
}

export class MoteRenderer {
  constructor(readonly reducedMotion: boolean, private readonly surface: HTMLElement) {}

  surfaceReaction(reaction: Reaction): void {
    const mote = document.createElement("span");
    mote.className = this.reducedMotion ? "reaction-static" : "mote";
    mote.textContent = reaction.kind === ReactionKind.Amen ? "🔥" : "🙌";
    mote.setAttribute("aria-hidden", "true");
    this.surface.append(mote);
    window.setTimeout(() => mote.remove(), this.reducedMotion ? 900 : 2_400);
  }
}

export class ReactionReceiver {
  constructor(readonly renderer: MoteRenderer, readonly counter: ReactionCounter) {}
  onReaction(reaction: Reaction): void {
    this.renderer.surfaceReaction(reaction);
    this.counter.record(reaction);
  }
}
