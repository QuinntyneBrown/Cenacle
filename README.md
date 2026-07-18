# Cenacle

Cenacle is a browser-native small-room prayer gathering built from the detailed designs in [`docs/detailed-designs`](docs/detailed-designs). Presence uses WebCodecs over authenticated WebTransport; Scripture matching, journal data, reflection, captions, and sanctuary analysis remain on the device.

## Prerequisites

- Node.js 22.12 or newer
- A current Microsoft Edge or Google Chrome browser
- x64 Python 3.14 (or another Python with wheels available for the pinned aioquic/cryptography versions)

## Install and verify

```powershell
npm install
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r room_origin\requirements.txt
npm run test:all
```

The full native transport acceptance additionally needs Edge (or `CENACLE_BROWSER_CHANNEL=chromium` with Playwright Chromium installed):

```powershell
npm run test:h3
```

That command generates a disposable 13-day localhost certificate, builds the production client for the local QUIC origin, starts the real aioquic HTTP/3 server, creates a host and participant in separate browser contexts, relays live fake-device media over native WebTransport, and fails if median glass-to-glass latency is not below 400 ms.

## Local HTTP/3 development

Generate a certificate and copy the printed hash into `.env.local` as `VITE_WT_CERT_HASH`:

```powershell
.\.venv\Scripts\python.exe room_origin\scripts\generate_dev_cert.py
npm run build
.\.venv\Scripts\python.exe -m room_origin.cenacle_origin.server --host 127.0.0.1 --port 4433
```

For a local self-signed H3-only origin, launch Chrome/Edge with a localhost force-QUIC rule and trust only the generated certificate's SPKI. `npm run test:h3` performs this safely and automatically. Production must use a publicly trusted certificate and advertise HTTP/3 through DNS HTTPS/SVCB or an H3-capable edge; no certificate-bypass flags belong in production.

Relevant environment variables:

- `VITE_ROOM_ORIGIN` — HTTPS/H3 room origin.
- `VITE_WT_CERT_HASH` — optional SHA-256 DER certificate hash for short-lived development certificates.
- `CENACLE_ALLOWED_ORIGINS` — comma-separated app origins allowed to open WebTransport sessions.
- `CENACLE_WEB_ROOT` — production client directory served by the H3 origin (defaults to `dist`).

## Operations

Probe the actual HTTP/3 health contract and alert after consecutive failures:

```powershell
.\.venv\Scripts\python.exe room_origin\scripts\monitor.py https://rooms.example/healthz --threshold 3 --webhook https://monitor.example/hooks/cenacle
```

The origin keeps room state and media only in memory. It does not implement recording, VOD, server-side journal storage, cloud transcription, cloud AI, or analytics. Telemetry accepts only the fixed non-identifying operational schema enforced in `room_origin/cenacle_origin/app.py`.

## Test layers

- `npm test` — deterministic Presence, Word, Sanctuary, privacy, security, accessibility, and performance units.
- `npm run test:e2e` — production-build Edge acceptance across XS–XL, private-action zero egress, inert rendering, reduced motion, capability degradation, live-room controls, dialogs, reactions, and a browser relay.
- `npm run test:origin` — room lifecycle, authorization, throttling, capacity, CSP, telemetry, relay, and non-persistence.
- `npm run test:h3` — real TLS + HTTP/3 + native WebTransport two-participant acceptance.
- `npm run build` — strict TypeScript (including Playwright specs) and optimized production bundle.
