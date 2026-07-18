from __future__ import annotations

import secrets
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable

ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
ROOM_CODE_LENGTH = 6
ROOM_CAPACITY = 8
TOKEN_TTL_SECONDS = 12 * 60 * 60

SessionSender = Callable[[dict], Awaitable[None]]


@dataclass(slots=True)
class Participant:
    id: str
    display_name: str
    role: str
    token: str
    expires_at: int
    is_muted: bool = False
    is_camera_off: bool = False
    is_speaking: bool = False
    send: SessionSender | None = None

    def public(self) -> dict:
        return {
            "id": self.id,
            "displayName": self.display_name,
            "role": self.role,
            "isMuted": self.is_muted,
            "isCameraOff": self.is_camera_off,
            "isSpeaking": self.is_speaking,
        }


@dataclass(slots=True)
class Room:
    code: str
    name: str
    host_id: str
    created_at: int
    participants: dict[str, Participant] = field(default_factory=dict)
    closed: bool = False

    @property
    def present(self) -> int:
        return sum(1 for participant in self.participants.values() if participant.send is not None)


class RoomCodeGenerator:
    alphabet = ROOM_CODE_ALPHABET
    length = ROOM_CODE_LENGTH

    def generate(self, occupied: set[str]) -> str:
        while True:
            code = "".join(secrets.choice(self.alphabet) for _ in range(self.length))
            if code not in occupied:
                return code


class RoomRegistry:
    """Process-local room state. No method writes room state or media to disk."""

    def __init__(self, capacity: int = ROOM_CAPACITY) -> None:
        self.capacity = capacity
        self.rooms: dict[str, Room] = {}
        self.generator = RoomCodeGenerator()

    def create(self, name: str, host_name: str, now: int | None = None) -> tuple[Room, Participant]:
        timestamp = now or int(time.time())
        code = self.generator.generate(set(self.rooms))
        host = self._participant(host_name, "host", timestamp)
        room = Room(code=code, name=name, host_id=host.id, created_at=timestamp)
        room.participants[host.id] = host
        self.rooms[code] = room
        return room, host

    def resolve(self, code: str) -> Room | None:
        room = self.rooms.get(code.upper())
        return room if room and not room.closed else None

    def admit(self, code: str, display_name: str, now: int | None = None) -> Participant:
        room = self.resolve(code)
        if room is None:
            raise RoomNotFound(code)
        if len(room.participants) >= self.capacity:
            raise RoomFull(code)
        participant = self._participant(display_name, "participant", now or int(time.time()))
        room.participants[participant.id] = participant
        return participant

    def authorize(self, code: str, participant_id: str, token: str, now: int | None = None) -> Participant:
        room = self.resolve(code)
        if room is None:
            raise RoomNotFound(code)
        participant = room.participants.get(participant_id)
        timestamp = now or int(time.time())
        if participant is None or not secrets.compare_digest(participant.token, token) or participant.expires_at <= timestamp:
            raise InvalidCredential(code)
        return participant

    def connect(self, code: str, participant_id: str, sender: SessionSender) -> Participant:
        room = self.resolve(code)
        if room is None:
            raise RoomNotFound(code)
        participant = room.participants[participant_id]
        participant.send = sender
        return participant

    def disconnect(self, code: str, participant_id: str) -> None:
        room = self.resolve(code)
        if room and participant_id in room.participants:
            room.participants[participant_id].send = None

    def leave(self, code: str, participant_id: str, token: str) -> None:
        participant = self.authorize(code, participant_id, token)
        room = self.rooms[code]
        if participant.role == "host":
            raise InvalidCredential(code)
        del room.participants[participant_id]

    def end(self, code: str, token: str) -> list[Participant]:
        room = self.resolve(code)
        if room is None:
            raise RoomNotFound(code)
        host = room.participants[room.host_id]
        if not secrets.compare_digest(host.token, token):
            raise InvalidCredential(code)
        room.closed = True
        participants = list(room.participants.values())
        del self.rooms[code]
        return participants

    def roster(self, code: str) -> list[dict]:
        room = self.resolve(code)
        if room is None:
            return []
        return [participant.public() for participant in room.participants.values() if participant.send is not None]

    def sessions(self, code: str, exclude: str | None = None) -> list[Participant]:
        room = self.resolve(code)
        if room is None:
            return []
        return [
            participant
            for participant in room.participants.values()
            if participant.send is not None and participant.id != exclude
        ]

    def update_presence(self, code: str, participant_id: str, update: dict) -> dict:
        room = self.resolve(code)
        if room is None or participant_id not in room.participants:
            raise RoomNotFound(code)
        participant = room.participants[participant_id]
        participant.is_muted = bool(update.get("isMuted", participant.is_muted))
        participant.is_camera_off = bool(update.get("isCameraOff", participant.is_camera_off))
        if "isSpeaking" in update:
            participant.is_speaking = bool(update["isSpeaking"])
        return participant.public()

    def _participant(self, display_name: str, role: str, now: int) -> Participant:
        return Participant(
            id=secrets.token_urlsafe(12),
            display_name=display_name,
            role=role,
            token=secrets.token_urlsafe(32),
            expires_at=now + TOKEN_TTL_SECONDS,
        )


class RoomRegistryError(Exception):
    code = "ROOM_ERROR"

    def __init__(self, room_code: str) -> None:
        self.room_code = room_code
        super().__init__(self.code)


class RoomNotFound(RoomRegistryError):
    code = "ROOM_NOT_FOUND"


class RoomFull(RoomRegistryError):
    code = "ROOM_FULL"


class InvalidCredential(RoomRegistryError):
    code = "INVALID_CREDENTIAL"
