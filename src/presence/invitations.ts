import QRCode from "qrcode";
import { inviteLink, type Room } from "../core/types";

export interface QrCode { dataUrl: string; }

export class QrEncoder {
  async encode(text: string): Promise<QrCode> {
    return {
      dataUrl: await QRCode.toDataURL(text, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 320,
        color: { dark: "#0A1420", light: "#FCFAF4" }
      })
    };
  }
}

export class InviteArtifacts {
  link = "";
  code = "";
  qr: QrCode | null = null;

  constructor(private readonly encoder = new QrEncoder()) {}

  async build(room: Room): Promise<void> {
    this.code = room.code;
    this.link = inviteLink(room);
    this.qr = await this.encoder.encode(this.link);
  }
}

export class Clipboard {
  isAvailable(): boolean { return Boolean(navigator.clipboard?.writeText); }

  async writeText(text: string): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
}
