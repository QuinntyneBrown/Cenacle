from __future__ import annotations

from typing import Any

import pytest

pytest.importorskip("aioquic")

from room_origin.cenacle_origin.http3 import WebTransportHandler


@pytest.mark.asyncio
async def test_relayed_media_uses_a_session_bound_webtransport_stream() -> None:
    calls: list[tuple] = []

    class FakeQuic:
        def send_stream_data(self, stream_id: int, data: bytes, end_stream: bool) -> None:
            calls.append(("send", stream_id, data, end_stream))

    class FakeConnection:
        _quic = FakeQuic()

        def create_webtransport_stream(
            self,
            session_id: int,
            is_unidirectional: bool,
        ) -> int:
            calls.append(("create", session_id, is_unidirectional))
            return 42

    transmitted: list[bool] = []
    handler = WebTransportHandler(
        FakeConnection(),  # type: ignore[arg-type]
        {"type": "webtransport"},
        stream_id=12,
        transmit=lambda: transmitted.append(True),
    )

    await handler.send({"type": "webtransport.stream.send", "data": b"frame"})

    assert calls == [
        ("create", 12, True),
        ("send", 42, b"frame", True),
    ]
    assert transmitted == [True]
