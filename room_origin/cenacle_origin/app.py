from __future__ import annotations

import asyncio
import json
import logging
import mimetypes
import os
import re
import time
from pathlib import Path
from typing import Any, Awaitable, Callable
from urllib.parse import parse_qs

from .registry import InvalidCredential, RoomFull, RoomNotFound, RoomRegistry, RoomRegistryError
from .security import RateLimiter, bearer_token

Receive = Callable[[], Awaitable[dict]]
Send = Callable[[dict], Awaitable[None]]

LOGGER = logging.getLogger("cenacle.origin")
ROOM_CODE = re.compile(r"^[A-HJ-NP-Z2-9]{6}$")
MAX_BODY = 32_768
MAX_MEDIA_STREAM = 2 * 1024 * 1024
ALLOWED_EVENT_NAMES = {
    "app_interactive_ms",
    "origin_connect",
    "origin_disconnect",
    "reconnect_attempt",
    "latency_ms",
    "frame_budget_exceeded",
    "unexpected_error",
}


def _allowed_origins() -> set[str]:
    configured = os.getenv(
        "CENACLE_ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,https://localhost:4433",
    )
    return {item.strip() for item in configured.split(",") if item.strip()}


def _header(scope: dict, name: bytes) -> str:
    for key, value in scope.get("headers", []):
        if key.lower() == name:
            return value.decode("utf-8", "replace")
    return ""


def _clean_text(value: Any, minimum: int, maximum: int, fallback: str | None = None) -> str:
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", str(value or "")).strip()
    if not text and fallback is not None:
        text = fallback
    if len(text) < minimum or len(text) > maximum:
        raise ValueError(f"Enter between {minimum} and {maximum} characters.")
    return text


class CenacleApplication:
    def __init__(self, web_root: str | Path | None = None) -> None:
        self.registry = RoomRegistry()
        self.rate_limiter = RateLimiter()
        self.reaction_limiter = RateLimiter(max_attempts=90, window_seconds=60)
        self.allowed_origins = _allowed_origins()
        self.web_root = Path(web_root or os.getenv("CENACLE_WEB_ROOT", "dist")).resolve()

    async def __call__(self, scope: dict, receive: Receive, send: Send) -> None:
        if scope["type"] == "webtransport":
            await self.webtransport(scope, receive, send)
        elif scope["type"] == "http":
            await self.http(scope, receive, send)

    async def http(self, scope: dict, receive: Receive, send: Send) -> None:
        method = scope["method"].upper()
        path = scope["path"]
        origin = _header(scope, b"origin")
        if method == "OPTIONS":
            await self._response(send, 204, b"", origin=origin)
            return
        try:
            if path == "/healthz" and method == "GET":
                await self._json(send, 200, {"status": "ok", "transport": "h3-webtransport"}, origin)
                return
            if path == "/api/telemetry" and method == "POST":
                body = await self._body(receive)
                events = json.loads(body or b"{}").get("events", [])
                valid = [
                    event
                    for event in events[:50]
                    if isinstance(event, dict)
                    and event.get("name") in ALLOWED_EVENT_NAMES
                    and isinstance(event.get("value"), (int, float))
                    and isinstance(event.get("at"), (int, float))
                    and set(event) <= {"name", "value", "at"}
                ]
                if len(valid) != len(events[:50]):
                    await self._error(send, 400, "INVALID_TELEMETRY", "Only fixed, non-identifying operational events are accepted.", origin)
                    return
                LOGGER.info("operational-events count=%d", len(valid))
                await self._response(send, 204, b"", origin=origin)
                return
            if path == "/api/rooms" and method == "POST":
                payload = json.loads(await self._body(receive) or b"{}")
                name = _clean_text(payload.get("name"), 1, 60)
                host_name = _clean_text(payload.get("hostName"), 1, 60, "Host")
                room, host = self.registry.create(name, host_name)
                await self._json(send, 201, self._credential(room.code, host), origin)
                return
            match = re.fullmatch(r"/api/rooms/([A-HJ-NP-Z2-9]{6})", path)
            if match and method == "GET":
                code = match.group(1)
                client_key = scope.get("client", ("unknown", 0))[0]
                if not self.rate_limiter.allowed(client_key):
                    await self._error(send, 429, "RATE_LIMITED", "Too many invalid room attempts. Wait a minute and try again.", origin)
                    return
                room = self.registry.resolve(code)
                if room is None:
                    self.rate_limiter.record_invalid(client_key)
                    await self._error(send, 404, "ROOM_NOT_FOUND", "That code does not match an open room.", origin)
                else:
                    await self._json(send, 200, {
                        "code": room.code,
                        "name": room.name,
                        "present": room.present,
                        "capacity": self.registry.capacity,
                    }, origin)
                return
            if match and method == "DELETE":
                participants = self.registry.end(match.group(1), bearer_token(scope.get("headers", [])))
                await asyncio.gather(*[
                    participant.send({"type": "control", "message": {"type": "room-ended"}})
                    for participant in participants if participant.send
                ], return_exceptions=True)
                await self._response(send, 204, b"", origin=origin)
                return
            match = re.fullmatch(r"/api/rooms/([A-HJ-NP-Z2-9]{6})/admissions", path)
            if match and method == "POST":
                client_key = scope.get("client", ("unknown", 0))[0]
                if not self.rate_limiter.allowed(client_key):
                    await self._error(send, 429, "RATE_LIMITED", "Too many invalid room attempts. Wait a minute and try again.", origin)
                    return
                payload = json.loads(await self._body(receive) or b"{}")
                display_name = _clean_text(payload.get("displayName"), 1, 60, "Guest")
                try:
                    participant = self.registry.admit(match.group(1), display_name)
                except RoomNotFound:
                    self.rate_limiter.record_invalid(client_key)
                    raise
                await self._json(send, 201, self._credential(match.group(1), participant), origin)
                return
            match = re.fullmatch(r"/api/rooms/([A-HJ-NP-Z2-9]{6})/participants/([^/]+)", path)
            if match and method == "DELETE":
                self.registry.leave(match.group(1), match.group(2), bearer_token(scope.get("headers", [])))
                await self._response(send, 204, b"", origin=origin)
                return
            if method == "GET":
                await self._static(path, send, origin)
                return
            await self._error(send, 404, "NOT_FOUND", "No route matches this request.", origin)
        except RoomFull:
            await self._error(send, 409, "ROOM_FULL", "This room is full. Rooms stay small on purpose.", origin)
        except RoomNotFound:
            await self._error(send, 404, "ROOM_NOT_FOUND", "That code does not match an open room.", origin)
        except InvalidCredential:
            await self._error(send, 403, "INVALID_CREDENTIAL", "The room credential is invalid or expired.", origin)
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            await self._error(send, 400, "INVALID_INPUT", str(error), origin)
        except RoomRegistryError:
            await self._error(send, 400, "ROOM_ERROR", "The room request could not be completed.", origin)

    async def webtransport(self, scope: dict, receive: Receive, send: Send) -> None:
        message = await receive()
        if message["type"] != "webtransport.connect":
            await send({"type": "webtransport.reject", "status": 400})
            return
        origin = _header(scope, b"origin")
        if origin and origin not in self.allowed_origins:
            await send({"type": "webtransport.reject", "status": 403})
            return
        query = parse_qs(scope.get("query_string", b"").decode("ascii", "ignore"))
        code = query.get("code", [""])[0].upper()
        token = query.get("token", [""])[0]
        participant_id = query.get("participant", [""])[0]
        client_key = scope.get("client", ("unknown", 0))[0]
        if not self.rate_limiter.allowed(client_key):
            await send({"type": "webtransport.reject", "status": 429})
            return
        if not ROOM_CODE.fullmatch(code):
            self.rate_limiter.record_invalid(client_key)
            await send({"type": "webtransport.reject", "status": 400})
            return
        try:
            participant = self.registry.authorize(code, participant_id, token)
        except RoomRegistryError:
            self.rate_limiter.record_invalid(client_key)
            await send({"type": "webtransport.reject", "status": 403})
            return

        async def session_send(item: dict) -> None:
            if item["type"] == "control":
                await send({"type": "webtransport.datagram.send", "data": json.dumps(item["message"], separators=(",", ":")).encode()})
            elif item["type"] == "media":
                await send({"type": "webtransport.stream.send", "data": item["data"]})

        await send({"type": "webtransport.accept", "origin": origin})
        self.registry.connect(code, participant.id, session_send)
        await self._broadcast_roster(code)
        stream_buffers: dict[int, bytearray] = {}
        rejected_streams: set[int] = set()
        try:
            while True:
                message = await receive()
                if message["type"] == "webtransport.disconnect":
                    break
                if message["type"] == "webtransport.datagram.receive":
                    await self._handle_datagram(code, participant.id, message["data"], session_send)
                elif message["type"] == "webtransport.stream.receive":
                    stream_id = message["stream"]
                    if stream_id in rejected_streams:
                        if message.get("stream_ended"):
                            rejected_streams.discard(stream_id)
                        continue
                    stream_buffers.setdefault(stream_id, bytearray()).extend(message["data"])
                    if len(stream_buffers[stream_id]) > MAX_MEDIA_STREAM:
                        stream_buffers.pop(stream_id, None)
                        rejected_streams.add(stream_id)
                        continue
                    if message.get("stream_ended"):
                        payload = bytes(stream_buffers.pop(stream_id))
                        await asyncio.gather(*[
                            peer.send({"type": "media", "data": payload})
                            for peer in self.registry.sessions(code, exclude=participant.id) if peer.send
                        ], return_exceptions=True)
        finally:
            self.registry.disconnect(code, participant.id)
            await self._broadcast_control(code, {"type": "participant-left", "participantId": participant.id})
            await self._broadcast_roster(code)

    async def _handle_datagram(self, code: str, participant_id: str, data: bytes, reply: Callable[[dict], Awaitable[None]]) -> None:
        if len(data) > 4096:
            return
        try:
            message = json.loads(data)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return
        kind = message.get("type")
        if kind == "ping" and isinstance(message.get("clientTime"), (int, float)):
            await reply({"type": "control", "message": {
                "type": "pong", "clientTime": message["clientTime"], "serverTime": int(time.time() * 1000)
            }})
        elif kind == "presence" and isinstance(message.get("update"), dict):
            public = self.registry.update_presence(code, participant_id, message["update"])
            await self._broadcast_control(code, {"type": "presence", "update": {
                "participantId": participant_id,
                "isMuted": public["isMuted"],
                "isCameraOff": public["isCameraOff"],
                "isSpeaking": public["isSpeaking"],
            }})
        elif kind == "reaction" and isinstance(message.get("reaction"), dict):
            reaction = message["reaction"]
            if (
                self.reaction_limiter.allowed(participant_id)
                and
                reaction.get("senderId") == participant_id
                and reaction.get("kind") in {"amen", "raised-hand"}
                and isinstance(reaction.get("sentAt"), (int, float))
            ):
                self.reaction_limiter.record_invalid(participant_id)
                await self._broadcast_control(code, {"type": "reaction", "reaction": reaction})

    async def _broadcast_roster(self, code: str) -> None:
        await self._broadcast_control(code, {"type": "roster", "participants": self.registry.roster(code)})

    async def _broadcast_control(self, code: str, message: dict) -> None:
        await asyncio.gather(*[
            participant.send({"type": "control", "message": message})
            for participant in self.registry.sessions(code) if participant.send
        ], return_exceptions=True)

    async def _body(self, receive: Receive) -> bytes:
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] != "http.request":
                continue
            body.extend(message.get("body", b""))
            if len(body) > MAX_BODY:
                raise ValueError("Request body is too large.")
            if not message.get("more_body", False):
                return bytes(body)

    async def _static(self, path: str, send: Send, origin: str) -> None:
        relative = "index.html" if path == "/" else path.lstrip("/")
        candidate = (self.web_root / relative).resolve()
        if not candidate.is_relative_to(self.web_root) or not candidate.is_file():
            candidate = self.web_root / "index.html"
        if not candidate.is_file():
            await self._error(send, 404, "NOT_FOUND", "Build the web client before serving it from the room origin.", origin)
            return
        body = await asyncio.to_thread(candidate.read_bytes)
        content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        await self._response(send, 200, body, content_type, origin, cache="no-cache" if candidate.name == "index.html" else "public, max-age=31536000, immutable")

    def _credential(self, code: str, participant: Any) -> dict:
        return {
            "code": code,
            "participantId": participant.id,
            "token": participant.token,
            "expiresAt": participant.expires_at * 1000,
        }

    async def _json(self, send: Send, status: int, payload: dict, origin: str = "") -> None:
        await self._response(send, status, json.dumps(payload, separators=(",", ":")).encode(), "application/json", origin)

    async def _error(self, send: Send, status: int, code: str, message: str, origin: str = "") -> None:
        await self._json(send, status, {"code": code, "message": message}, origin)

    async def _response(
        self,
        send: Send,
        status: int,
        body: bytes,
        content_type: str = "text/plain; charset=utf-8",
        origin: str = "",
        cache: str = "no-store",
    ) -> None:
        headers = [
            (b"content-type", content_type.encode()),
            (b"content-length", str(len(body)).encode()),
            (b"cache-control", cache.encode()),
            (b"x-content-type-options", b"nosniff"),
            (b"referrer-policy", b"no-referrer"),
            (b"permissions-policy", b"camera=(self), microphone=(self), display-capture=()"),
            (b"content-security-policy", (
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                "font-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; "
                "connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; "
                "form-action 'self'; frame-ancestors 'none'"
            ).encode()),
        ]
        if origin in self.allowed_origins:
            headers.extend([
                (b"access-control-allow-origin", origin.encode()),
                (b"vary", b"origin"),
                (b"access-control-allow-methods", b"GET, POST, DELETE, OPTIONS"),
                (b"access-control-allow-headers", b"content-type, authorization"),
            ])
        await send({"type": "http.response.start", "status": status, "headers": headers})
        await send({"type": "http.response.body", "body": body})


app = CenacleApplication()
