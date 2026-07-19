# Cenacle

The upper room, now a browser tab: a small-room prayer gathering with sub-second presence and private, on-device companion features.

![Node.js 22.12+](https://img.shields.io/badge/Node.js-22.12%2B-339933?logo=node.js&logoColor=white)
![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111827)
![TypeScript 7](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)
![Playwright](https://img.shields.io/badge/Browser_tests-Playwright-2EAD33?logo=playwright&logoColor=white)

[Product requirements](docs/cenacle-prd.md) | [Detailed designs](docs/detailed-designs) | [Design mocks](docs/mocks) | [Local and deployed testing guide](docs/testing-and-deployment.md)

## About the project

Cenacle is a browser-native gathering space where believers can pray together with the immediacy of being in the same room while private writing, Scripture themes, captions, and reflections remain on the participant's device.

The application is organized around three independently degrading subsystems:

- **Presence** uses camera and microphone capture, WebCodecs, and authenticated WebTransport over HTTP/3 for a live room with a target of less than 400 ms glass-to-glass latency.
- **Word** keeps Scripture matching, lament journal entries, live captions, and optional Prompt API reflections on the local device. There is no cloud-AI fallback.
- **Sanctuary** uses WebGPU for ambient and audio-reactive visuals and Document Picture-in-Picture for a floating prayer companion, with a still backdrop when GPU features are unavailable.

The room origin is deliberately ephemeral. Room membership, credentials, presence, and encoded media exist only in process memory; the implementation does not record gatherings or persist room state. The current topology is intended for one small room-origin process and up to eight participants per room, not large broadcast or horizontally scaled deployment.

## Features

- Host a gathering or join with an unambiguous six-character room code
- Browser-native H.264 or VP9 media over WebCodecs and WebTransport
- Mute, camera, captions, reactions, invitations, leave, end, and reconnect controls
- Server-authoritative room admission, capacity, expiring credentials, and rate limits
- Local Scripture surfacing grounded in a bundled verse index
- A device-local lament journal with optional on-device reflection
- Local captions and model lifecycle controls where the browser supports them
- WebGPU sanctuary visuals with performance-aware degradation
- Responsive layouts, reduced-motion handling, accessible dialogs, and live regions
- Fixed-schema, non-identifying operational telemetry only
- Explicit degraded states when WebTransport, WebCodecs, WebGPU, or on-device AI is absent

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 22.12 or newer and npm
- Current Google Chrome or Microsoft Edge on desktop
- x64 Python 3.14, or another Python version with wheels available for the pinned `aioquic` and `cryptography` versions, for the room origin and Python tests
- Camera and microphone access for live-room validation
- UDP access to the HTTP/3 room-origin port for native WebTransport validation

### Local UI development

```powershell
git clone https://github.com/QuinntyneBrown/Cenacle.git
cd Cenacle
npm ci
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`. This is enough to develop the application shell and local-only features. A real live gathering also requires the HTTP/3 room origin and certificate setup described in the [testing and deployment guide](docs/testing-and-deployment.md#interactive-local-http3-validation).

### Install the room origin

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r room_origin\requirements.txt
```

Do not commit `.env.local`, certificates, private keys, or production secrets. The generated development certificate is short-lived and is only for localhost testing.

## Technology

| Area | Technologies |
| --- | --- |
| Client | React 19, TypeScript 7, Vite 8 |
| Presence | MediaDevices, WebCodecs, WebTransport, Web Audio |
| Room origin | Python, asyncio, aioquic, HTTP/3 |
| Word | Prompt API / built-in AI, local verse index, origin-scoped browser storage |
| Sanctuary | WebGPU, Web Audio, Document Picture-in-Picture |
| Quality | Vitest, Testing Library, Playwright, pytest |
| Security | Content Security Policy, explicit CORS allowlist, bearer room credentials, input limits, rate limiting |

## Testing

```powershell
npm test             # deterministic client unit and contract tests
npm run test:e2e     # production-build browser acceptance
npm run test:origin  # room lifecycle, security, relay, and non-persistence
npm run test:all     # client + browser + origin suites
npm run test:h3      # real TLS, HTTP/3, WebTransport, and two browser participants
```

Browser acceptance defaults to Microsoft Edge. To run the same checks in installed Google Chrome:

```powershell
$env:CENACLE_BROWSER_CHANNEL = "chrome"
npm run test:e2e
npm run test:h3
```

See [Local and deployed testing](docs/testing-and-deployment.md) for environment preparation, the complete test matrix, interactive local HTTP/3 setup, deployment requirements, deployed acceptance checks, monitoring, and troubleshooting.

## Project structure

```text
src/
  core/                 Capability, privacy, security, storage, and performance policies
  media/                Capture, codecs, decoding, and WebTransport client
  presence/             Room API, admission, invitations, reactions, and controllers
  sanctuary/            WebGPU visuals and floating companion
  ui/                   Application screens and accessible components
  word/                 Captions, journal, local model, and verse index
  test/                 Vitest suites
room_origin/
  cenacle_origin/       HTTP/3 server, room registry, security, and relay
  scripts/              Development certificate generation and health monitoring
  tests/                pytest origin and transport contracts
e2e/                    Playwright browser and native HTTP/3 acceptance
docs/
  cenacle-prd.md         Product requirements and scope
  detailed-designs/     Feature and cross-cutting designs with C4/UML diagrams
  mocks/                Screen-by-screen HTML design references
```

## Documentation

| Document | Purpose |
| --- | --- |
| [Product requirements](docs/cenacle-prd.md) | Product principles, scope, feature slices, browser capabilities, and success signals |
| [Detailed designs](docs/detailed-designs) | Presence, Word, Sanctuary, and cross-cutting implementation contracts |
| [Design mocks](docs/mocks) | Static screen, dialog, empty-state, and error-state references |
| [Testing and deployment](docs/testing-and-deployment.md) | Local setup, automated suites, real HTTP/3 testing, deployment prerequisites, production checks, and troubleshooting |

## Privacy and security

Cenacle does not implement recording, VOD, server-side journal storage, cloud transcription, cloud AI, or arbitrary analytics. The origin relays encoded live media in memory and accepts only a fixed operational event schema without text or identifiers. Journal entries, recent themes, saved passages, model state, and settings are origin-scoped to the local browser profile.

Production operators must use a publicly trusted certificate, restrict `CENACLE_ALLOWED_ORIGINS`, protect the private key, expose HTTP/3 over UDP, and understand that restarting the single room-origin process ends every active room. See the [deployment contract](docs/testing-and-deployment.md#deployment-contract) before exposing an instance publicly.

## Operations

The origin exposes an HTTP/3 health contract at `/healthz`. The bundled monitor validates the actual HTTP/3 response and can alert after consecutive failures:

```powershell
.\.venv\Scripts\python.exe room_origin\scripts\monitor.py `
  https://rooms.example.com/healthz `
  --threshold 3 `
  --webhook https://monitor.example/hooks/cenacle
```
