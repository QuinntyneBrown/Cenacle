import type { PresenceUpdate, Reaction, RoomCredential } from "../core/types";
import { deserializeMediaPacket, serializeMediaPacket, type EncodedMediaPacket } from "./codec";

export type ControlMessage =
  | { type: "presence"; update: PresenceUpdate }
  | { type: "reaction"; reaction: Reaction }
  | { type: "roster"; participants: unknown[] }
  | { type: "room-ended" }
  | { type: "participant-left"; participantId: string }
  | { type: "ping"; clientTime: number }
  | { type: "pong"; clientTime: number; serverTime: number };

type ListenerMap = {
  control: (message: ControlMessage) => void;
  media: (packet: EncodedMediaPacket) => void;
  drop: (error?: unknown) => void;
};

/** Maps local epoch time into the room origin's clock using the lowest-RTT sample. */
export class RoomClock {
  private offsetMs = 0;
  private bestRttMs = Number.POSITIVE_INFINITY;

  observe(clientSentAt: number, serverAt: number, clientReceivedAt: number): void {
    const rtt = Math.max(0, clientReceivedAt - clientSentAt);
    if (rtt > this.bestRttMs) return;
    this.bestRttMs = rtt;
    this.offsetMs = serverAt - (clientSentAt + clientReceivedAt) / 2;
  }

  now(localNow = Date.now()): number { return localNow + this.offsetMs; }
  uncertaintyMs(): number | null { return Number.isFinite(this.bestRttMs) ? this.bestRttMs / 2 : null; }
}

export class RoomTransport {
  private transport: WebTransport | null = null;
  private datagramWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private readonly listeners: { [K in keyof ListenerMap]: Set<ListenerMap[K]> } = {
    control: new Set(),
    media: new Set(),
    drop: new Set()
  };
  private outboundPaused = false;
  private closing = false;
  private clockTimer = 0;
  readonly clock = new RoomClock();

  constructor(readonly origin: string) {}

  async open(credential: RoomCredential, participantId: string, displayName: string, role: string): Promise<void> {
    if (!window.WebTransport) throw new DOMException("WebTransport is unavailable.", "NotSupportedError");
    this.closeTransportOnly();
    this.closing = false;
    const url = new URL("/wt", this.origin);
    url.searchParams.set("code", credential.code);
    url.searchParams.set("token", credential.token);
    url.searchParams.set("participant", participantId);
    url.searchParams.set("name", displayName);
    url.searchParams.set("role", role);
    const options: WebTransportOptions = { allowPooling: false, requireUnreliable: true };
    const hash = import.meta.env.VITE_WT_CERT_HASH;
    if (hash) {
      const binary = atob(hash);
      options.serverCertificateHashes = [{
        algorithm: "sha-256",
        value: Uint8Array.from(binary, (character) => character.charCodeAt(0))
      }];
    }
    this.transport = new window.WebTransport(url.toString(), options);
    await this.transport.ready;
    this.datagramWriter = this.transport.datagrams.writable.getWriter();
    void this.readDatagrams();
    void this.readStreams();
    const opened = this.transport;
    void opened.closed.then(
      () => { if (!this.closing && this.transport === opened) this.emit("drop", new DOMException("The room connection closed.", "NetworkError")); },
      (error) => { if (!this.closing && this.transport === opened) this.emit("drop", error); }
    );
    await this.synchronizeClock();
    this.clockTimer = window.setInterval(() => void this.synchronizeClock(), 30_000);
  }

  async sendDatagram(message: ControlMessage): Promise<void> {
    if (!this.datagramWriter) throw new DOMException("The room transport is not open.", "InvalidStateError");
    const bytes = new TextEncoder().encode(JSON.stringify(message));
    await this.datagramWriter.ready;
    await this.datagramWriter.write(bytes);
  }

  async publish(packet: EncodedMediaPacket): Promise<void> {
    if (this.outboundPaused || !this.transport) return;
    const stream = await this.transport.createUnidirectionalStream();
    const writer = stream.getWriter();
    await writer.write(serializeMediaPacket(packet));
    await writer.close();
  }

  signalPresence(update: PresenceUpdate): Promise<void> {
    return this.sendDatagram({ type: "presence", update });
  }

  sendReaction(reaction: Reaction): Promise<void> {
    return this.sendDatagram({ type: "reaction", reaction });
  }

  setAudioSending(stream: MediaStream | null, on: boolean): void {
    stream?.getAudioTracks().forEach((track) => { track.enabled = on; });
  }

  setVideoSending(stream: MediaStream | null, on: boolean): void {
    stream?.getVideoTracks().forEach((track) => { track.enabled = on; });
  }

  pauseOutbound(): void { this.outboundPaused = true; }
  resumeOutbound(): void { this.outboundPaused = false; }
  isConnected(): boolean { return Boolean(this.transport); }
  roomNow(): number { return this.clock.now(); }

  async synchronizeClock(timeoutMs = 800): Promise<boolean> {
    const clientTime = Date.now();
    return new Promise<boolean>((resolve) => {
      let timer = 0;
      let settled = false;
      let unsubscribe: () => void = () => undefined;
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        unsubscribe();
        resolve(result);
      };
      unsubscribe = this.on("control", (message) => {
        if (message.type !== "pong" || message.clientTime !== clientTime) return;
        this.clock.observe(clientTime, message.serverTime, Date.now());
        finish(true);
      });
      timer = window.setTimeout(() => finish(false), timeoutMs);
      void this.sendDatagram({ type: "ping", clientTime }).catch(() => finish(false));
    });
  }

  on<K extends keyof ListenerMap>(event: K, listener: ListenerMap[K]): () => void {
    (this.listeners[event] as Set<ListenerMap[K]>).add(listener);
    return () => (this.listeners[event] as Set<ListenerMap[K]>).delete(listener);
  }

  close(code = 0, reason = "left room"): void {
    this.closing = true;
    this.closeTransportOnly(code, reason);
  }

  private async readDatagrams(): Promise<void> {
    if (!this.transport) return;
    const reader = this.transport.datagrams.readable.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        try {
          this.emit("control", JSON.parse(new TextDecoder().decode(value)) as ControlMessage);
        } catch {
          // Malformed control messages are dropped rather than reaching UI state.
        }
      }
    } catch (error) {
      if (!this.closing) this.emit("drop", error);
    } finally {
      reader.releaseLock();
    }
  }

  private async readStreams(): Promise<void> {
    if (!this.transport) return;
    const streamReader = this.transport.incomingUnidirectionalStreams.getReader();
    try {
      while (true) {
        const { done, value } = await streamReader.read();
        if (done) return;
        void this.consumeStream(value);
      }
    } catch (error) {
      if (!this.closing) this.emit("drop", error);
    } finally {
      streamReader.releaseLock();
    }
  }

  private async consumeStream(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      length += value.length;
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      this.emit("media", deserializeMediaPacket(bytes));
    } catch {
      // Invalid media is isolated to this one stream.
    }
  }

  private emit<K extends keyof ListenerMap>(event: K, value: Parameters<ListenerMap[K]>[0]): void {
    for (const listener of this.listeners[event]) {
      (listener as (item: typeof value) => void)(value);
    }
  }

  private closeTransportOnly(code = 0, reason = "replaced connection"): void {
    window.clearInterval(this.clockTimer);
    this.clockTimer = 0;
    try { this.datagramWriter?.releaseLock(); } catch { /* A pending writer is released by transport close. */ }
    try { this.transport?.close({ closeCode: code, reason }); } catch { /* Already closed. */ }
    this.transport = null;
    this.datagramWriter = null;
  }
}
