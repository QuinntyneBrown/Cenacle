export enum Breakpoint {
  XS = "xs",
  SM = "sm",
  MD = "md",
  LG = "lg",
  XL = "xl"
}

export enum VisualRegister {
  Manuscript = "manuscript",
  UpperRoom = "upper-room"
}

export enum LiveRegionPoliteness {
  Polite = "polite",
  Assertive = "assertive"
}

export class ResponsiveLayout {
  current = this.resolve(typeof window === "undefined" ? 1200 : window.innerWidth);

  resolve(width: number): Breakpoint {
    if (width >= 1200) return Breakpoint.XL;
    if (width >= 992) return Breakpoint.LG;
    if (width >= 768) return Breakpoint.MD;
    if (width >= 576) return Breakpoint.SM;
    return Breakpoint.XS;
  }

  observe(listener: (breakpoint: Breakpoint) => void): () => void {
    const handler = () => {
      this.current = this.resolve(window.innerWidth);
      listener(this.current);
    };
    window.addEventListener("resize", handler, { passive: true });
    return () => window.removeEventListener("resize", handler);
  }

  hasNoHorizontalOverflow(): boolean {
    return document.documentElement.scrollWidth <= document.documentElement.clientWidth;
  }
}

export class ReduceMotion {
  enabled = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  observe(listener: (enabled: boolean) => void): () => void {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = () => {
      this.enabled = query.matches;
      listener(this.enabled);
    };
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }

  shouldAnimate(): boolean {
    return !this.enabled;
  }
}

export class FocusManager {
  private opener: HTMLElement | null = null;
  private cleanup: (() => void) | null = null;

  trap(container: HTMLElement, opener: HTMLElement | null): void {
    this.release(false);
    this.opener = opener;
    const selector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = () => [...container.querySelectorAll<HTMLElement>(selector)].filter((el) => !el.hidden);
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    container.addEventListener("keydown", keydown);
    this.cleanup = () => container.removeEventListener("keydown", keydown);
    queueMicrotask(() => focusables()[0]?.focus());
  }

  release(restore = true): void {
    this.cleanup?.();
    this.cleanup = null;
    if (restore) this.opener?.focus();
    this.opener = null;
  }
}

export class LiveRegionAnnouncer {
  announce(text: string, politeness: LiveRegionPoliteness = LiveRegionPoliteness.Polite): void {
    const element = document.querySelector<HTMLElement>(`[data-live-region="${politeness}"]`);
    if (!element) return;
    element.textContent = "";
    window.setTimeout(() => {
      element.textContent = text;
    }, 20);
  }
}

export const liveRegionAnnouncer = new LiveRegionAnnouncer();
