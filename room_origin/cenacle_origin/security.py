from __future__ import annotations

import time
from collections import defaultdict, deque


class RateLimiter:
    def __init__(self, max_attempts: int = 8, window_seconds: int = 60) -> None:
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._attempts: dict[str, deque[float]] = defaultdict(deque)

    def allowed(self, client_key: str, now: float | None = None) -> bool:
        timestamp = now if now is not None else time.monotonic()
        attempts = self._attempts[client_key]
        while attempts and timestamp - attempts[0] >= self.window_seconds:
            attempts.popleft()
        return len(attempts) < self.max_attempts

    def record_invalid(self, client_key: str, now: float | None = None) -> None:
        self._attempts[client_key].append(now if now is not None else time.monotonic())


def bearer_token(headers: list[tuple[bytes, bytes]]) -> str:
    for key, value in headers:
        if key.lower() == b"authorization":
            text = value.decode("utf-8", "strict")
            if text.startswith("Bearer "):
                return text[7:]
    return ""
