"""Minimal HTTP/3 + WebTransport ASGI bridge.

Adapted from aioquic's BSD-licensed HTTP/3 server example. The bridge is kept
small so the application layer can own room admission and relay semantics.
"""

from __future__ import annotations

import asyncio
import time
from collections import deque
from email.utils import formatdate
from typing import Callable, Deque

from aioquic.asyncio import QuicConnectionProtocol
from aioquic.h3.connection import H3_ALPN, H3Connection
from aioquic.h3.events import (
    DataReceived,
    DatagramReceived,
    H3Event,
    HeadersReceived,
    WebTransportStreamDataReceived,
)
from aioquic.quic.events import ConnectionTerminated, ProtocolNegotiated, QuicEvent

SERVER_NAME = b"cenacle-room-origin/0.1"


class HttpRequestHandler:
    def __init__(
        self,
        connection: H3Connection,
        scope: dict,
        stream_id: int,
        stream_ended: bool,
        transmit: Callable[[], None],
    ) -> None:
        self.connection = connection
        self.scope = scope
        self.stream_id = stream_id
        self.transmit = transmit
        self.queue: asyncio.Queue[dict] = asyncio.Queue()
        if stream_ended:
            self.queue.put_nowait({"type": "http.request", "body": b"", "more_body": False})

    def event_received(self, event: H3Event) -> None:
        if isinstance(event, DataReceived):
            self.queue.put_nowait({
                "type": "http.request",
                "body": event.data,
                "more_body": not event.stream_ended,
            })
        elif isinstance(event, HeadersReceived) and event.stream_ended:
            self.queue.put_nowait({"type": "http.request", "body": b"", "more_body": False})

    async def receive(self) -> dict:
        return await self.queue.get()

    async def send(self, message: dict) -> None:
        if message["type"] == "http.response.start":
            self.connection.send_headers(
                stream_id=self.stream_id,
                headers=[
                    (b":status", str(message["status"]).encode()),
                    (b"server", SERVER_NAME),
                    (b"date", formatdate(time.time(), usegmt=True).encode()),
                    *message.get("headers", []),
                ],
            )
        elif message["type"] == "http.response.body":
            self.connection.send_data(
                stream_id=self.stream_id,
                data=message.get("body", b""),
                end_stream=not message.get("more_body", False),
            )
        self.transmit()


class WebTransportHandler:
    def __init__(
        self,
        connection: H3Connection,
        scope: dict,
        stream_id: int,
        transmit: Callable[[], None],
    ) -> None:
        self.connection = connection
        self.scope = scope
        self.stream_id = stream_id
        self.transmit = transmit
        self.accepted = False
        self.closed = False
        self.backlog: Deque[H3Event] = deque()
        self.queue: asyncio.Queue[dict] = asyncio.Queue()
        self.queue.put_nowait({"type": "webtransport.connect"})

    def event_received(self, event: H3Event) -> None:
        if self.closed:
            return
        if not self.accepted:
            self.backlog.append(event)
            return
        if isinstance(event, DatagramReceived):
            self.queue.put_nowait({"type": "webtransport.datagram.receive", "data": event.data})
        elif isinstance(event, WebTransportStreamDataReceived):
            self.queue.put_nowait({
                "type": "webtransport.stream.receive",
                "data": event.data,
                "stream": event.stream_id,
                "stream_ended": event.stream_ended,
            })

    async def receive(self) -> dict:
        return await self.queue.get()

    async def send(self, message: dict) -> None:
        message_type = message["type"]
        if message_type == "webtransport.accept":
            self.accepted = True
            headers = [
                (b":status", b"200"),
                (b"server", SERVER_NAME),
                (b"date", formatdate(time.time(), usegmt=True).encode()),
                (b"sec-webtransport-http3-draft", b"draft02"),
            ]
            if message.get("origin"):
                headers.append((b"access-control-allow-origin", message["origin"].encode()))
            self.connection.send_headers(stream_id=self.stream_id, headers=headers)
            while self.backlog:
                self.event_received(self.backlog.popleft())
        elif message_type == "webtransport.reject":
            self.connection.send_headers(
                stream_id=self.stream_id,
                headers=[(b":status", str(message.get("status", 403)).encode())],
                end_stream=True,
            )
            self.closed = True
        elif message_type == "webtransport.close":
            self.connection.send_data(stream_id=self.stream_id, data=b"", end_stream=True)
            self.closed = True
        elif message_type == "webtransport.datagram.send":
            self.connection.send_datagram(stream_id=self.stream_id, data=message["data"])
        elif message_type == "webtransport.stream.send":
            stream_id = self.connection._quic.get_next_available_stream_id(is_unidirectional=True)
            self.connection._quic.send_stream_data(stream_id, message["data"], end_stream=True)
        self.transmit()

    def disconnect(self) -> None:
        if not self.closed:
            self.closed = True
            self.queue.put_nowait({"type": "webtransport.disconnect"})


class Http3ServerProtocol(QuicConnectionProtocol):
    def __init__(self, *args, application, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.application = application
        self.http: H3Connection | None = None
        self.handlers: dict[int, HttpRequestHandler | WebTransportHandler] = {}

    def quic_event_received(self, event: QuicEvent) -> None:
        if isinstance(event, ProtocolNegotiated) and event.alpn_protocol in H3_ALPN:
            self.http = H3Connection(self._quic, enable_webtransport=True)
        if isinstance(event, ConnectionTerminated):
            for handler in self.handlers.values():
                if isinstance(handler, WebTransportHandler):
                    handler.disconnect()
        if self.http is not None:
            for http_event in self.http.handle_event(event):
                self.http_event_received(http_event)

    def http_event_received(self, event: H3Event) -> None:
        if isinstance(event, HeadersReceived) and event.stream_id not in self.handlers:
            headers: list[tuple[bytes, bytes]] = []
            method = ""
            protocol = ""
            authority = b""
            raw_path = b"/"
            for key, value in event.headers:
                if key == b":method":
                    method = value.decode()
                elif key == b":protocol":
                    protocol = value.decode()
                elif key == b":authority":
                    authority = value
                    headers.append((b"host", value))
                elif key == b":path":
                    raw_path = value
                elif not key.startswith(b":"):
                    headers.append((key, value))
            path_bytes, _, query_string = raw_path.partition(b"?")
            client_address = self._quic._network_paths[0].addr
            common = {
                "client": (client_address[0], client_address[1]),
                "headers": headers,
                "http_version": "3",
                "method": method,
                "path": path_bytes.decode("utf-8", "replace"),
                "query_string": query_string,
                "raw_path": raw_path,
                "root_path": "",
                "scheme": "https",
                "server": (authority.decode("utf-8", "replace"), None),
            }
            if method == "CONNECT" and protocol == "webtransport":
                handler: HttpRequestHandler | WebTransportHandler = WebTransportHandler(
                    self.http, {**common, "type": "webtransport"}, event.stream_id, self.transmit
                )
            else:
                handler = HttpRequestHandler(
                    self.http,
                    {**common, "type": "http", "extensions": {}},
                    event.stream_id,
                    event.stream_ended,
                    self.transmit,
                )
            self.handlers[event.stream_id] = handler
            asyncio.create_task(self._run(handler))
        elif isinstance(event, (DataReceived, HeadersReceived)) and event.stream_id in self.handlers:
            self.handlers[event.stream_id].event_received(event)
        elif isinstance(event, DatagramReceived):
            handler = self.handlers.get(event.stream_id)
            if handler:
                handler.event_received(event)
        elif isinstance(event, WebTransportStreamDataReceived):
            handler = self.handlers.get(event.session_id)
            if handler:
                handler.event_received(event)

    async def _run(self, handler: HttpRequestHandler | WebTransportHandler) -> None:
        try:
            await self.application(handler.scope, handler.receive, handler.send)
        finally:
            if isinstance(handler, WebTransportHandler) and not handler.closed:
                await handler.send({"type": "webtransport.close"})
