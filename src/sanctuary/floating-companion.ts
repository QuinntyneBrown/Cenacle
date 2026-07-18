export enum CompanionState {
  Docked = "docked",
  Floating = "floating",
  Unsupported = "unsupported",
}

export interface FloatingRoomSession {
  muted: boolean;
  latencyMs: number | null;
  captionLine: string;
  toggleMute(): void;
  leave(): void;
}

export class PipWindow {
  constructor(readonly window: Window) {}
  close(): void {
    this.window.close();
  }
}

export class FloatingCompanionController {
  state = CompanionState.Docked;
  private pip: PipWindow | null = null;
  private movedNode: HTMLElement | null = null;
  private placeholder: Comment | null = null;
  private controls: HTMLElement | null = null;
  private session: FloatingRoomSession | null = null;

  isSupported(): boolean {
    return Boolean(window.documentPictureInPicture?.requestWindow);
  }

  async pop(
    node: HTMLElement,
    session: FloatingRoomSession,
  ): Promise<PipWindow> {
    if (this.pip) {
      this.update(session);
      return this.pip;
    }
    if (!this.isSupported()) {
      this.state = CompanionState.Unsupported;
      throw new DOMException(
        "Document Picture-in-Picture is unavailable.",
        "NotSupportedError",
      );
    }
    const pipWindow = await window.documentPictureInPicture!.requestWindow({
      width: 420,
      height: 300,
    });
    this.copyStyles(pipWindow.document);
    pipWindow.document.body.className = "night pip-body";
    this.placeholder = document.createComment("cenacle-pip-placeholder");
    node.before(this.placeholder);
    pipWindow.document.body.append(node);
    this.controls = this.createControls(pipWindow.document);
    node.append(this.controls);
    this.movedNode = node;
    this.pip = new PipWindow(pipWindow);
    this.state = CompanionState.Floating;
    pipWindow.addEventListener("pagehide", () => this.onWindowClosed());
    this.update(session);
    return this.pip;
  }

  update(session: FloatingRoomSession): void {
    this.session = session;
    if (!this.controls) return;
    const caption = this.controls.querySelector<HTMLElement>("[data-pip-caption]");
    const latency = this.controls.querySelector<HTMLElement>("[data-pip-latency]");
    const mute = this.controls.querySelector<HTMLButtonElement>("[data-pip-mute]");
    if (caption) caption.textContent = session.captionLine || "Captions will appear here";
    if (latency) latency.textContent = session.latencyMs == null ? "— ms" : `${Math.round(session.latencyMs)} ms`;
    if (mute) mute.textContent = session.muted ? "Unmute" : "Mute";
  }

  returnToTab(): void {
    this.controls?.remove();
    this.controls = null;
    this.session = null;
    if (this.placeholder && this.movedNode)
      this.placeholder.replaceWith(this.movedNode);
    this.placeholder = null;
    this.movedNode = null;
    const pip = this.pip;
    this.pip = null;
    this.state = CompanionState.Docked;
    pip?.close();
  }

  onWindowClosed(): void {
    if (this.state === CompanionState.Floating) this.returnToTab();
  }

  private copyStyles(target: Document): void {
    for (const style of document.querySelectorAll(
      'link[rel="stylesheet"], style',
    )) {
      target.head.append(style.cloneNode(true));
    }
  }

  private createControls(document: Document): HTMLElement {
    const controls = document.createElement("div");
    controls.className = "pip-native-controls";
    controls.innerHTML = '<p class="pip-caption-line" data-pip-caption aria-live="polite"></p><div class="pip-control-row"><span class="mono" data-pip-latency>— ms</span><button class="btn btn--ghost btn--sm" type="button" data-pip-mute>Mute</button><button class="btn btn--danger btn--sm" type="button" data-pip-leave>Leave</button></div>';
    controls.querySelector("[data-pip-mute]")?.addEventListener("click", () => {
      const current = this.session;
      if (!current) return;
      current.toggleMute();
      this.update({ ...current, muted: !current.muted });
    });
    controls.querySelector("[data-pip-leave]")?.addEventListener("click", () => this.session?.leave());
    return controls;
  }
}
