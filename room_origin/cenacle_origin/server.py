from __future__ import annotations

import argparse
import asyncio
import logging
from functools import partial

from aioquic.asyncio import serve
from aioquic.h3.connection import H3_ALPN
from aioquic.quic.configuration import QuicConfiguration
from aioquic.quic.logger import QuicFileLogger

from .app import app
from .http3 import Http3ServerProtocol


async def run(args: argparse.Namespace) -> None:
    configuration = QuicConfiguration(
        alpn_protocols=H3_ALPN,
        is_client=False,
        max_datagram_frame_size=65_536,
        quic_logger=QuicFileLogger(args.quic_log) if args.quic_log else None,
    )
    configuration.load_cert_chain(args.certificate, args.private_key)
    await serve(
        args.host,
        args.port,
        configuration=configuration,
        create_protocol=partial(Http3ServerProtocol, application=app),
        retry=args.retry,
    )
    logging.getLogger("cenacle.origin").info("HTTP/3 + WebTransport origin listening on %s:%d", args.host, args.port)
    await asyncio.Future()


def main() -> None:
    parser = argparse.ArgumentParser(description="Cenacle HTTP/3 + WebTransport room origin")
    parser.add_argument("--host", default="::")
    parser.add_argument("--port", type=int, default=4433)
    parser.add_argument("--certificate", default="room_origin/data/certificate.pem")
    parser.add_argument("--private-key", default="room_origin/data/certificate.key")
    parser.add_argument("--quic-log")
    parser.add_argument("--retry", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    try:
        asyncio.run(run(args))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
