import { ParticipantRole, type Room, type RoomCredential } from "../core/types";

export class RoomApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = "RoomApiError";
  }
}

interface CreateRoomResponse {
  code: string;
  participantId: string;
  token: string;
  expiresAt: number;
}

export class RoomApi {
  constructor(readonly origin: string) {}

  async create(name: string, hostName: string): Promise<Room> {
    const data = await this.request<CreateRoomResponse>("/api/rooms", {
      method: "POST",
      body: JSON.stringify({ name, hostName })
    });
    return this.toRoom(data, ParticipantRole.Host);
  }

  async resolve(code: string): Promise<{ code: string; name: string; present: number; capacity: number } | null> {
    const response = await this.fetch(`${this.origin}/api/rooms/${encodeURIComponent(code)}`, {
      headers: { accept: "application/json" },
      cache: "no-store"
    });
    if (response.status === 404) return null;
    if (!response.ok) throw await this.error(response);
    return response.json() as Promise<{ code: string; name: string; present: number; capacity: number }>;
  }

  async admit(code: string, displayName: string): Promise<Room> {
    const data = await this.request<CreateRoomResponse>(`/api/rooms/${encodeURIComponent(code)}/admissions`, {
      method: "POST",
      body: JSON.stringify({ displayName })
    });
    return this.toRoom(data, ParticipantRole.Participant);
  }

  async leave(room: Room): Promise<void> {
    await this.request(`/api/rooms/${room.code}/participants/${room.participantId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${room.credential.token}` }
    });
  }

  async end(room: Room): Promise<void> {
    await this.request(`/api/rooms/${room.code}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${room.credential.token}` }
    });
  }

  private toRoom(data: CreateRoomResponse, role: ParticipantRole): Room {
    const credential: RoomCredential = { code: data.code, token: data.token, expiresAt: data.expiresAt };
    return {
      code: data.code,
      role,
      appOrigin: window.location.origin,
      participantId: data.participantId,
      credential
    };
  }

  private async request<T = void>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetch(`${this.origin}${path}`, {
      ...init,
      headers: { "content-type": "application/json", accept: "application/json", ...init.headers }
    });
    if (!response.ok) throw await this.error(response);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  private async error(response: Response): Promise<RoomApiError> {
    const body = await response.json().catch(() => ({ code: "ORIGIN_ERROR", message: response.statusText })) as {
      code?: string;
      message?: string;
    };
    return new RoomApiError(body.code ?? "ORIGIN_ERROR", body.message ?? "The room origin could not complete the request.", response.status);
  }

  private async fetch(input: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(input, init);
    } catch {
      throw new RoomApiError(
        "ORIGIN_UNREACHABLE",
        "The live room origin could not be reached. Check the connection and try again.",
        0,
      );
    }
  }
}
