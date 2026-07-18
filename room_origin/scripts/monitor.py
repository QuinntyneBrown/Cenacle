from __future__ import annotations

import argparse
import asyncio
import json
import logging
import ssl
import urllib.request
from typing import Any, cast
from urllib.parse import urlsplit

from aioquic.asyncio.client import connect
from aioquic.asyncio.protocol import QuicConnectionProtocol
from aioquic.h3.connection import H3_ALPN, H3Connection
from aioquic.h3.events import DataReceived, HeadersReceived
from aioquic.quic.configuration import QuicConfiguration
from aioquic.quic.events import QuicEvent


class HealthProtocol(QuicConnectionProtocol):
    """Minimal HTTP/3 client used only for the origin health contract."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.http = H3Connection(self._quic)
        self.responses: dict[int, dict[str, Any]] = {}

    async def get(self, authority: str, path: str) -> tuple[int, bytes]:
        stream_id = self._quic.get_next_available_stream_id()
        future = self._loop.create_future()
        self.responses[stream_id] = {"status": 0, "body": bytearray(), "future": future}
        self.http.send_headers(
            stream_id=stream_id,
            headers=[
                (b":method", b"GET"),
                (b":scheme", b"https"),
                (b":authority", authority.encode()),
                (b":path", path.encode()),
                (b"user-agent", b"cenacle-origin-monitor/1"),
            ],
            end_stream=True,
        )
        self.transmit()
        return await asyncio.shield(future)

    def quic_event_received(self, event: QuicEvent) -> None:
        for http_event in self.http.handle_event(event):
            if not isinstance(http_event, (HeadersReceived, DataReceived)):
                continue
            response = self.responses.get(http_event.stream_id)
            if response is None:
                continue
            if isinstance(http_event, HeadersReceived):
                for name, value in http_event.headers:
                    if name == b":status":
                        response["status"] = int(value)
            else:
                response["body"].extend(http_event.data)
            if http_event.stream_ended:
                self.responses.pop(http_event.stream_id, None)
                response["future"].set_result((response["status"], bytes(response["body"])))


async def probe(url: str, timeout: float, insecure: bool = False, ca_certs: str = "") -> bool:
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname:
        return False
    configuration = QuicConfiguration(is_client=True, alpn_protocols=H3_ALPN)
    if insecure:
        configuration.verify_mode = ssl.CERT_NONE
    elif ca_certs:
        configuration.load_verify_locations(ca_certs)
    authority = parsed.netloc
    path = parsed.path or "/healthz"
    if parsed.query:
        path += f"?{parsed.query}"
    try:
        async with connect(
            parsed.hostname,
            parsed.port or 443,
            configuration=configuration,
            create_protocol=HealthProtocol,
        ) as connection:
            client = cast(HealthProtocol, connection)
            status, body = await asyncio.wait_for(client.get(authority, path), timeout)
            payload = json.loads(body or b"{}")
            return status == 200 and payload.get("transport") == "h3-webtransport"
    except Exception:
        return False


def alert(webhook: str, failures: int) -> None:
    if not webhook:
        logging.error("Room origin HTTP/3 unavailable after %d checks", failures)
        return
    request = urllib.request.Request(
        webhook,
        data=json.dumps({"event": "cenacle_origin_unreachable", "consecutiveFailures": failures}).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    urllib.request.urlopen(request, timeout=5).close()


async def main() -> None:
    parser = argparse.ArgumentParser(description="Monitor Cenacle HTTP/3 room-origin availability")
    parser.add_argument("url", help="HTTP/3 health URL, e.g. https://rooms.example/healthz")
    parser.add_argument("--interval", type=float, default=15)
    parser.add_argument("--threshold", type=int, default=3)
    parser.add_argument("--webhook", default="")
    parser.add_argument("--ca-certs", default="")
    parser.add_argument("--insecure", action="store_true", help="Development certificates only")
    args = parser.parse_args()
    failures = 0
    while True:
        healthy = await probe(args.url, min(10, args.interval), args.insecure, args.ca_certs)
        failures = 0 if healthy else failures + 1
        if failures == args.threshold:
            await asyncio.to_thread(alert, args.webhook, failures)
        await asyncio.sleep(args.interval)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
