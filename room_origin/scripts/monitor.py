from __future__ import annotations

import argparse
import asyncio
import json
import logging
import urllib.request


def probe(url: str, timeout: float) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return response.status == 200
    except Exception:
        return False


def alert(webhook: str, failures: int) -> None:
    if not webhook:
        logging.error("Room origin unreachable after %d checks", failures)
        return
    request = urllib.request.Request(
        webhook,
        data=json.dumps({"event": "cenacle_origin_unreachable", "consecutiveFailures": failures}).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    urllib.request.urlopen(request, timeout=5).close()


async def main() -> None:
    parser = argparse.ArgumentParser(description="Monitor Cenacle room-origin availability")
    parser.add_argument("url", help="HTTP/3 health URL, e.g. https://rooms.example/healthz")
    parser.add_argument("--interval", type=float, default=15)
    parser.add_argument("--threshold", type=int, default=3)
    parser.add_argument("--webhook", default="")
    args = parser.parse_args()
    failures = 0
    while True:
        healthy = await asyncio.to_thread(probe, args.url, min(10, args.interval))
        failures = 0 if healthy else failures + 1
        if failures == args.threshold:
            await asyncio.to_thread(alert, args.webhook, failures)
        await asyncio.sleep(args.interval)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
