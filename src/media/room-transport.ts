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

export class RoomTransport {
  private transport: WebTransport | null = null;
  private datagramWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private readonly listeners: { [K in keyof ListenerMap]: Set<ListenerMap[K]> } = {
    control: new Set(),
    media: new Set(),
    drop: new Set()
  };
  private outboundPaused = false;

  constructor(readonly origin: string) {}

  async open(credential: RoomCredential, participantId: string, displayName: string, role: string): Promise<void> {
    if (!window.WebTransport) throw new DOMException("WebTransport is unavailable.", "NotSupportedError");
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
    void this.transport.closed.catch((error) => this.emit("drop", error));
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

  on<K extends keyof ListenerMap>(event: K, listener: ListenerMap[K]): () => void {
    (this.listeners[event] as Set<ListenerMap[K]>).add(listener);
    return () => (this.listeners[event] as Set<ListenerMap[K]>).delete(listener);
  }

  close(code = 0, reason = "left room"): void {
    this.datagramWriter?.releaseLock();
    this.transport?.close({ closeCode: code, reason });
    this.transport = null;
    this.datagramWriter = null;
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
      this.emit("drop", error);
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
      this.emit("drop", error);
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
}
