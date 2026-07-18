export class InputSanitizer {
  validate(text: string, maxLength: number, minLength = 0): string {
    const value = text
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .trim();
    if (value.length < minLength || value.length > maxLength) {
      throw new RangeError(
        `Enter between ${minLength} and ${maxLength} characters.`,
      );
    }
    return value;
  }

  /** React renders returned strings as inert text. This helper is for non-React sinks. */
  encode(text: string): string {
    return text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  parseRoomReference(input: string): string {
    const trimmed = input.trim();
    let candidate = trimmed;
    try {
      const url = new URL(trimmed, window.location.origin);
      const match = url.pathname.match(/\/r\/([A-Za-z2-9]{6})\/?$/);
      if (match?.[1]) candidate = match[1];
    } catch {
      // The code path below handles a plain non-URL value.
    }
    const code = candidate.toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) {
      throw new TypeError("Enter a six-character room code or invite link.");
    }
    return code;
  }
}

export class CspPolicy {
  constructor(readonly roomOrigin: string) {}

  readonly scriptSrc = ["'self'"];
  readonly frameAncestors = ["'none'"];

  get connectSrc(): string[] {
    return ["'self'", this.roomOrigin];
  }

  permits(origin: string): boolean {
    return origin === window.location.origin || origin === this.roomOrigin;
  }

  header(): string {
    return [
      "default-src 'self'",
      `script-src ${this.scriptSrc.join(" ")}`,
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      `connect-src ${this.connectSrc.join(" ")}`,
      `frame-ancestors ${this.frameAncestors.join(" ")}`,
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");
  }
}

export enum RateDecision {
  Allowed = "allowed",
  Throttled = "throttled",
}

/** Used by the browser's local demo path; the origin has the authoritative limiter. */
export class RateLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    readonly maxAttempts = 8,
    readonly windowMs = 60_000,
  ) {}

  check(clientKey: string, now = Date.now()): RateDecision {
    const active = (this.attempts.get(clientKey) ?? []).filter(
      (at) => now - at < this.windowMs,
    );
    this.attempts.set(clientKey, active);
    return active.length >= this.maxAttempts
      ? RateDecision.Throttled
      : RateDecision.Allowed;
  }

  record(clientKey: string, now = Date.now()): void {
    this.attempts.set(clientKey, [
      ...(this.attempts.get(clientKey) ?? []),
      now,
    ]);
  }
}
