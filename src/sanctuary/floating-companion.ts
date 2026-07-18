export enum CompanionState {
  Docked = "docked",
  Floating = "floating",
  Unsupported = "unsupported"
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
  close(): void { this.window.close(); }
}

export class FloatingCompanionController {
  state = CompanionState.Docked;
  private pip: PipWindow | null = null;
  private movedNode: HTMLElement | null = null;
  private placeholder: Comment | null = null;

  isSupported(): boolean { return Boolean(window.documentPictureInPicture?.requestWindow); }

  async pop(node: HTMLElement, session: FloatingRoomSession): Promise<PipWindow> {
    if (!this.isSupported()) {
      this.state = CompanionState.Unsupported;
      throw new DOMException("Document Picture-in-Picture is unavailable.", "NotSupportedError");
    }
    const pipWindow = await window.documentPictureInPicture!.requestWindow({ width: 420, height: 300 });
    this.copyStyles(pipWindow.document);
    pipWindow.document.body.className = "night pip-body";
    this.placeholder = document.createComment("cenacle-pip-placeholder");
    node.before(this.placeholder);
    pipWindow.document.body.append(node);
    this.movedNode = node;
    this.pip = new PipWindow(pipWindow);
    this.state = CompanionState.Floating;
    pipWindow.addEventListener("pagehide", () => this.onWindowClosed());
    node.dataset.caption = session.captionLine;
    node.dataset.latency = session.latencyMs == null ? "— ms" : `${Math.round(session.latencyMs)} ms`;
    return this.pip;
  }

  returnToTab(): void {
    if (this.placeholder && this.movedNode) this.placeholder.replaceWith(this.movedNode);
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
    for (const style of document.querySelectorAll('link[rel="stylesheet"], style')) {
      target.head.append(style.cloneNode(true));
    }
  }
}
