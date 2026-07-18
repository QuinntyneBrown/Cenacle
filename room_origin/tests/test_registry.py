from __future__ import annotations

import asyncio
import re

import pytest

from room_origin.cenacle_origin.registry import (
    ROOM_CODE_ALPHABET,
    InvalidCredential,
    RoomFull,
    RoomNotFound,
    RoomRegistry,
)
from room_origin.cenacle_origin.security import RateLimiter


async def _sender(_: dict) -> None:
    await asyncio.sleep(0)


def test_room_codes_are_unambiguous_unique_and_reserved_only_while_open() -> None:
    registry = RoomRegistry()
    first, host = registry.create("Evening prayer", "Host", now=1_000)
    second, _ = registry.create("Morning prayer", "Host", now=1_000)

    assert first.code != second.code
    assert re.fullmatch(f"[{re.escape(ROOM_CODE_ALPHABET)}]{{6}}", first.code)
    assert not ({"0", "O", "1", "I"} & set(first.code))

    registry.end(first.code, host.token)
    assert registry.resolve(first.code) is None


def test_capacity_is_enforced_authoritatively_and_room_remains_rejoinable() -> None:
    registry = RoomRegistry(capacity=2)
    room, host = registry.create("Prayer", "Host", now=1_000)
    guest = registry.admit(room.code.lower(), "Guest", now=1_000)

    with pytest.raises(RoomFull):
        registry.admit(room.code, "Another", now=1_000)

    registry.connect(room.code, host.id, _sender)
    registry.connect(room.code, guest.id, _sender)
    assert room.present == 2
    registry.disconnect(room.code, guest.id)
    assert room.present == 1
    assert registry.authorize(room.code, guest.id, guest.token, now=1_001) is guest


def test_credentials_expire_and_only_the_host_can_end() -> None:
    registry = RoomRegistry()
    room, host = registry.create("Prayer", "Host", now=1_000)
    guest = registry.admit(room.code, "Guest", now=1_000)

    with pytest.raises(InvalidCredential):
        registry.authorize(room.code, guest.id, "wrong", now=1_001)
    with pytest.raises(InvalidCredential):
        registry.authorize(room.code, guest.id, guest.token, now=guest.expires_at)
    with pytest.raises(InvalidCredential):
        registry.end(room.code, guest.token)

    registry.end(room.code, host.token)
    with pytest.raises(RoomNotFound):
        registry.admit(room.code, "Late guest", now=1_001)


def test_roster_contains_only_connected_people_and_presence_is_relay_ready() -> None:
    registry = RoomRegistry()
    room, host = registry.create("Prayer", "Host", now=1_000)
    registry.connect(room.code, host.id, _sender)
    update = registry.update_presence(
        room.code,
        host.id,
        {"isMuted": True, "isCameraOff": True, "isSpeaking": True},
    )

    assert update == {
        "id": host.id,
        "displayName": "Host",
        "role": "host",
        "isMuted": True,
        "isCameraOff": True,
        "isSpeaking": True,
    }
    assert registry.roster(room.code) == [update]


def test_invalid_join_rate_limit_rolls_over_after_the_window() -> None:
    limiter = RateLimiter(max_attempts=2, window_seconds=60)
    assert limiter.allowed("client", now=0)
    limiter.record_invalid("client", now=0)
    limiter.record_invalid("client", now=1)
    assert not limiter.allowed("client", now=59)
    assert limiter.allowed("client", now=60)
