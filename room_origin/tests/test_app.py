from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from room_origin.cenacle_origin.app import CenacleApplication


async def request(
    app: CenacleApplication,
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
    headers: list[tuple[bytes, bytes]] | None = None,
    client: str = "127.0.0.1",
) -> tuple[int, dict[bytes, bytes], bytes]:
    incoming = [{
        "type": "http.request",
        "body": json.dumps(payload).encode() if payload is not None else b"",
        "more_body": False,
    }]
    outgoing: list[dict] = []

    async def receive() -> dict:
        return incoming.pop(0)

    async def send(message: dict) -> None:
        outgoing.append(message)

    await app({
        "type": "http",
        "method": method,
        "path": path,
        "headers": headers or [],
        "client": (client, 1234),
    }, receive, send)
    start = next(message for message in outgoing if message["type"] == "http.response.start")
    body = b"".join(message.get("body", b"") for message in outgoing if message["type"] == "http.response.body")
    return start["status"], dict(start["headers"]), body


@pytest.mark.asyncio
async def test_create_resolve_admit_leave_and_end_lifecycle(tmp_path: Path) -> None:
    app = CenacleApplication(web_root=tmp_path)
    status, headers, body = await request(app, "POST", "/api/rooms", {"name": "Evening prayer", "hostName": "Host"})
    host = json.loads(body)
    code = host["code"]

    assert status == 201
    assert len(code) == 6
    assert b"frame-ancestors 'none'" in headers[b"content-security-policy"]

    status, _, body = await request(app, "GET", f"/api/rooms/{code}")
    assert status == 200
    assert json.loads(body) == {"code": code, "name": "Evening prayer", "present": 0, "capacity": 8}

    status, _, body = await request(app, "POST", f"/api/rooms/{code}/admissions", {"displayName": "Guest"})
    guest = json.loads(body)
    assert status == 201
    assert guest["code"] == code

    status, _, _ = await request(
        app,
        "DELETE",
        f"/api/rooms/{code}/participants/{guest['participantId']}",
        headers=[(b"authorization", f"Bearer {guest['token']}".encode())],
    )
    assert status == 204

    status, _, _ = await request(
        app,
        "DELETE",
        f"/api/rooms/{code}",
        headers=[(b"authorization", f"Bearer {host['token']}".encode())],
    )
    assert status == 204
    status, _, body = await request(app, "GET", f"/api/rooms/{code}")
    assert status == 404
    assert json.loads(body)["code"] == "ROOM_NOT_FOUND"


@pytest.mark.asyncio
async def test_capacity_and_host_authorization_are_server_enforced(tmp_path: Path) -> None:
    app = CenacleApplication(web_root=tmp_path)
    _, _, body = await request(app, "POST", "/api/rooms", {"name": "Prayer", "hostName": "Host"})
    host = json.loads(body)
    code = host["code"]
    guests = []
    for index in range(7):
        status, _, guest_body = await request(
            app,
            "POST",
            f"/api/rooms/{code}/admissions",
            {"displayName": f"Guest {index}"},
        )
        assert status == 201
        guests.append(json.loads(guest_body))

    status, _, body = await request(app, "POST", f"/api/rooms/{code}/admissions", {"displayName": "Full"})
    assert status == 409
    assert json.loads(body)["code"] == "ROOM_FULL"

    status, _, body = await request(
        app,
        "DELETE",
        f"/api/rooms/{code}",
        headers=[(b"authorization", f"Bearer {guests[0]['token']}".encode())],
    )
    assert status == 403
    assert json.loads(body)["code"] == "INVALID_CREDENTIAL"


@pytest.mark.asyncio
async def test_invalid_room_enumeration_is_rate_limited(tmp_path: Path) -> None:
    app = CenacleApplication(web_root=tmp_path)
    for _ in range(8):
        status, _, body = await request(
            app,
            "POST",
            "/api/rooms/ABC234/admissions",
            {"displayName": "Guest"},
            client="198.51.100.8",
        )
        assert status == 404
        assert json.loads(body)["code"] == "ROOM_NOT_FOUND"

    status, _, body = await request(
        app,
        "POST",
        "/api/rooms/ABC234/admissions",
        {"displayName": "Guest"},
        client="198.51.100.8",
    )
    assert status == 429
    assert json.loads(body)["code"] == "RATE_LIMITED"


@pytest.mark.asyncio
async def test_telemetry_rejects_arbitrary_or_identifying_fields(tmp_path: Path) -> None:
    app = CenacleApplication(web_root=tmp_path)
    status, _, _ = await request(app, "POST", "/api/telemetry", {
        "events": [{"name": "latency_ms", "value": 220, "at": 1_000}],
    })
    assert status == 204

    status, _, body = await request(app, "POST", "/api/telemetry", {
        "events": [{"name": "latency_ms", "value": 220, "at": 1_000, "journal": "private"}],
    })
    assert status == 400
    assert json.loads(body)["code"] == "INVALID_TELEMETRY"


@pytest.mark.asyncio
async def test_room_resolution_enumeration_is_rate_limited(tmp_path: Path) -> None:
    app = CenacleApplication(web_root=tmp_path)
    for _ in range(8):
        status, _, body = await request(
            app,
            "GET",
            "/api/rooms/ABC234",
            client="198.51.100.20",
        )
        assert status == 404
        assert json.loads(body)["code"] == "ROOM_NOT_FOUND"

    status, _, body = await request(
        app,
        "GET",
        "/api/rooms/ABC234",
        client="198.51.100.20",
    )
    assert status == 429
    assert json.loads(body)["code"] == "RATE_LIMITED"


@pytest.mark.asyncio
async def test_csp_allows_only_self_connections_and_excludes_ai_analytics(tmp_path: Path) -> None:
    app = CenacleApplication(web_root=tmp_path)
    status, headers, _ = await request(app, "GET", "/healthz")
    policy = headers[b"content-security-policy"].decode()

    assert status == 200
    assert "connect-src 'self'" in policy
    assert "script-src 'self'" in policy
    assert "font-src 'self'" in policy
    assert "frame-ancestors 'none'" in policy
    assert "https://" not in policy
    assert "openai" not in policy.lower()
    assert "analytics" not in policy.lower()


async def webtransport(
    app: CenacleApplication,
    query: bytes,
    incoming: list[dict],
    client: str = "127.0.0.1",
) -> list[dict]:
    messages = list(incoming)
    outgoing: list[dict] = []

    async def receive() -> dict:
        return messages.pop(0)

    async def send(message: dict) -> None:
        outgoing.append(message)

    await app(
        {
            "type": "webtransport",
            "headers": [(b"origin", b"https://localhost:4433")],
            "query_string": query,
            "client": (client, 443),
        },
        receive,
        send,
    )
    return outgoing


@pytest.mark.asyncio
async def test_webtransport_requires_a_valid_room_credential(tmp_path: Path) -> None:
    app = CenacleApplication(web_root=tmp_path)
    room, host = app.registry.create("Prayer", "Host")
    query = f"code={room.code}&participant={host.id}&token=wrong".encode()

    outgoing = await webtransport(
        app,
        query,
        [{"type": "webtransport.connect"}],
    )

    assert outgoing == [{"type": "webtransport.reject", "status": 403}]


@pytest.mark.asyncio
async def test_media_is_relayed_ephemerally_and_never_written_to_disk(tmp_path: Path) -> None:
    app = CenacleApplication(web_root=tmp_path)
    room, host = app.registry.create("Prayer", "Host")
    guest = app.registry.admit(room.code, "Guest")
    relayed: list[dict] = []

    async def receive_relay(item: dict) -> None:
        relayed.append(item)

    app.registry.connect(room.code, guest.id, receive_relay)
    payload = b"encoded-frame"
    query = f"code={room.code}&participant={host.id}&token={host.token}".encode()
    outgoing = await webtransport(
        app,
        query,
        [
            {"type": "webtransport.connect"},
            {
                "type": "webtransport.stream.receive",
                "stream": 0,
                "data": payload,
                "stream_ended": True,
            },
            {"type": "webtransport.disconnect"},
        ],
    )

    assert any(message["type"] == "webtransport.accept" for message in outgoing)
    assert {"type": "media", "data": payload} in relayed
    assert list(tmp_path.iterdir()) == []


@pytest.mark.asyncio
async def test_oversized_media_stream_is_dropped_before_relay(tmp_path: Path) -> None:
    app = CenacleApplication(web_root=tmp_path)
    room, host = app.registry.create("Prayer", "Host")
    guest = app.registry.admit(room.code, "Guest")
    relayed: list[dict] = []

    async def receive_relay(item: dict) -> None:
        relayed.append(item)

    app.registry.connect(room.code, guest.id, receive_relay)
    query = f"code={room.code}&participant={host.id}&token={host.token}".encode()
    await webtransport(
        app,
        query,
        [
            {"type": "webtransport.connect"},
            {
                "type": "webtransport.stream.receive",
                "stream": 0,
                "data": b"x" * (2 * 1024 * 1024 + 1),
                "stream_ended": True,
            },
            {"type": "webtransport.disconnect"},
        ],
    )

    assert not any(item["type"] == "media" for item in relayed)
    assert list(tmp_path.iterdir()) == []
