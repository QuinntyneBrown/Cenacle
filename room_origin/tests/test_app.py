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
