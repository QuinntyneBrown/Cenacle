# Local and deployed testing

This guide explains how to validate Cenacle as a local client, as a complete local HTTP/3 application, and after deployment. It also defines the infrastructure and browser capabilities that must be in place before a deployed result can be considered healthy.

## Contents

- [Validation layers](#validation-layers)
- [Local prerequisites](#local-prerequisites)
- [Initial setup](#initial-setup)
- [Local UI development](#local-ui-development)
- [Automated local validation](#automated-local-validation)
- [Interactive local HTTP/3 validation](#interactive-local-http3-validation)
- [Deployment contract](#deployment-contract)
- [Build and start a deployed origin](#build-and-start-a-deployed-origin)
- [Validate a deployed version](#validate-a-deployed-version)
- [Continuous monitoring](#continuous-monitoring)
- [Troubleshooting](#troubleshooting)
- [Release sign-off checklist](#release-sign-off-checklist)

## Validation layers

No single test proves the whole application. Use the layer that matches the change, and run every layer before a release.

| Layer | Command or action | What it proves | External services |
| --- | --- | --- | --- |
| Type safety and build | `npm run build` | Strict TypeScript, Playwright spec compilation, and optimized client output | None |
| Client contracts | `npm test` | Presence, Word, Sanctuary, privacy, security, accessibility, and performance logic | None |
| Browser acceptance | `npm run test:e2e` | Production client rendering, interactions, breakpoints, degradation, zero-egress private actions, and a stubbed room relay | Local preview server; transport is stubbed |
| Origin contracts | `npm run test:origin` | Room lifecycle, authorization, throttling, capacity, CSP, telemetry schema, relay, and non-persistence | None; application is exercised in process |
| Native transport | `npm run test:h3` | Real certificate, HTTP/3, WebTransport, two isolated browser participants, live fake media, and latency budget | Local UDP socket and installed Chromium browser |
| Interactive local | Two Chrome windows or devices | Real permissions, user-facing controls, media behavior, and visual quality | Local HTTP/3 origin |
| Deployed acceptance | Health probe plus two real clients | DNS, trusted TLS, UDP routing, WebTransport, permissions, and end-to-end production behavior | Deployed infrastructure |

`npm run test:all` runs the client, browser, and origin suites. It intentionally does not run `test:h3`; run the native transport acceptance separately because it needs a UDP port, certificate generation, Python dependencies, and an installed browser.

## Local prerequisites

### Required for every contributor

- Node.js 22.12 or newer
- npm, using the committed `package-lock.json`
- A current desktop Google Chrome or Microsoft Edge installation
- A free local TCP port for Vite or Playwright (`5173` and `4178` are the defaults)

### Additionally required for origin and WebTransport testing

- x64 Python 3.14, or a Python version for which the pinned `aioquic` and `cryptography` releases provide compatible wheels
- Permission to create a virtual environment and bind a local UDP port
- A free UDP port `4433`
- Camera and microphone permission, or Playwright's fake media devices
- Local firewall rules that allow the selected browser and Python process to communicate over loopback UDP

### Browser capability expectations

Presence requires both `WebTransport` and `WebCodecs`. WebGPU and built-in on-device AI are optional and degrade independently. The support page reports four capability states:

1. WebTransport
2. WebCodecs
3. WebGPU
4. On-device AI

A machine can host or join when the first two are available. Missing WebGPU produces a still sanctuary backdrop. Missing on-device AI hides or disables AI-backed Word behavior; Cenacle never routes that private content to a cloud fallback.

## Initial setup

From the repository root in PowerShell:

```powershell
npm ci

py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r room_origin\requirements.txt
```

Confirm the toolchain:

```powershell
node --version
npm --version
.\.venv\Scripts\python.exe --version
npx playwright --version
```

The Playwright configuration uses an installed Edge browser by default. Set `CENACLE_BROWSER_CHANNEL=chrome` to use installed Google Chrome. If neither branded browser is available, install Playwright Chromium and use `CENACLE_BROWSER_CHANNEL=chromium`.

## Local UI development

Start the Vite development server:

```powershell
npm run dev
```

Open the URL Vite prints, normally `http://localhost:5173`. If that port is occupied, choose another explicitly:

```powershell
npm run dev -- --host 127.0.0.1 --port 4179 --strictPort
```

The development server is suitable for layout, navigation, settings, journal, Scripture, capability degradation, and other local client work. It does not by itself provide a real WebTransport room origin. Clicking **Go live** requires the origin described below.

Before accepting UI work, inspect at least these routes at 375 px and desktop widths:

- `/`
- `/host`
- `/join`
- `/word/scripture`
- `/word/journal`
- `/settings`
- `/support`
- an unknown route such as `/not-a-page`

Verify that there is no page-level horizontal overflow, keyboard focus is visible, dialogs trap and restore focus, and reduced-motion settings remove decorative animation.

## Automated local validation

### TypeScript and production build

```powershell
npm run typecheck
npm run build
```

The build must finish without TypeScript errors and produce `dist/index.html` plus hashed assets. The output directory is ignored by Git and can be regenerated at any time.

### Client unit and contract tests

```powershell
npm test
```

These deterministic tests use jsdom and cover client behavior without camera hardware, browser transport, or a running origin.

### Browser acceptance

Default installed Edge channel:

```powershell
npm run test:e2e
```

Installed Google Chrome channel:

```powershell
$env:CENACLE_BROWSER_CHANNEL = "chrome"
npm run test:e2e
```

The Playwright runner builds the production client, starts a strict local preview server at `http://127.0.0.1:4178`, grants fake camera and microphone permissions, and runs the specs in `e2e/`. The suite covers public routes across XS through XL widths, local-only Word actions, injection resistance, startup performance, reduced motion, capability degradation, live controls, accessible dialogs, reactions, latency presentation, and uncaught browser errors.

If a browser test fails, inspect the retained trace:

```powershell
npx playwright show-trace test-results\<failed-test>\trace.zip
```

### Room-origin contracts

```powershell
npm run test:origin
```

The pytest suite invokes the origin in process. It does not need a certificate or listening port. It verifies the API and relay rules, including that media is never written to disk.

### Complete deterministic suite

```powershell
npm run test:all
```

Run this before every push. Then run native HTTP/3 acceptance before any transport, certificate, deployment, media, or origin release.

### Native HTTP/3 and WebTransport acceptance

```powershell
$env:CENACLE_BROWSER_CHANNEL = "chrome"
npm run test:h3
```

This command:

1. Generates a disposable 13-day localhost certificate under `room_origin/data/`.
2. Builds the client for `https://127.0.0.1:4433`.
3. Starts the real aioquic HTTP/3 origin on UDP `4433`.
4. Launches host and guest in separate, isolated Chrome contexts with fake media devices.
5. Creates, resolves, joins, and relays a real room over native WebTransport.
6. Collects glass-to-glass samples and fails unless the median is below 400 ms.
7. Closes the browser and origin when the check finishes.

Certificate and key files are ignored by Git. Regenerate them when expired; never reuse them in production.

## Interactive local HTTP/3 validation

Use this workflow when a person needs to inspect the real live-room experience instead of the automated headless acceptance.

### 1. Generate a short-lived certificate

```powershell
.\.venv\Scripts\python.exe room_origin\scripts\generate_dev_cert.py
```

Copy the printed `VITE_WT_CERT_HASH` value into `.env.local`:

```dotenv
VITE_ROOM_ORIGIN=https://127.0.0.1:4433
VITE_WT_CERT_HASH=<base64 SHA-256 certificate hash printed above>
```

The hash is embedded in the development build and supplied to `WebTransport` through `serverCertificateHashes`. It is safe only because the generated certificate is short-lived. `.env.local` and `room_origin/data/` are ignored by Git.

### 2. Build the client

```powershell
npm run build
```

Vite environment variables are resolved at build time. Rebuild whenever `VITE_ROOM_ORIGIN` or `VITE_WT_CERT_HASH` changes.

### 3. Start the HTTP/3 origin

```powershell
$env:CENACLE_ALLOWED_ORIGINS = "https://127.0.0.1:4433"
$env:CENACLE_WEB_ROOT = (Resolve-Path .\dist).Path

.\.venv\Scripts\python.exe -m room_origin.cenacle_origin.server `
  --host 127.0.0.1 `
  --port 4433 `
  --certificate room_origin\data\certificate.pem `
  --private-key room_origin\data\certificate.key
```

The origin serves both the built client and room APIs over HTTP/3. Keep this terminal open.

### 4. Launch an isolated Chrome profile with local QUIC flags

Chrome flags only apply to a newly launched browser process. Use an isolated profile so an already-running Chrome instance cannot swallow the launch arguments.

```powershell
$spki = node --input-type=module -e "import { createHash, X509Certificate } from 'node:crypto'; import { readFileSync } from 'node:fs'; const cert = new X509Certificate(readFileSync('room_origin/data/certificate.pem')); const key = cert.publicKey.export({ type: 'spki', format: 'der' }); process.stdout.write(createHash('sha256').update(key).digest('base64'));"
$profile = Join-Path $env:TEMP "cenacle-chrome-http3"

Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList @(
  "--user-data-dir=$profile",
  "--origin-to-force-quic-on=127.0.0.1:4433",
  "--ignore-certificate-errors-spki-list=$spki",
  "--enable-features=WebTransportDeveloperMode",
  "https://127.0.0.1:4433"
)
```

Adjust the Chrome executable path if it is installed per-user or in `Program Files (x86)`. Do not use certificate-bypass flags with production endpoints.

### 5. Exercise two participants

Use the isolated Chrome profile as the host and another isolated profile or device as the participant.

1. Open `/support` and confirm WebTransport and WebCodecs are ready.
2. Host a room and grant camera and microphone access.
3. Copy the invitation link or six-character code.
4. Join from the second context, grant media access, and enter the room.
5. Confirm both clients show `2 present` and render live media.
6. Speak or clap and confirm the other client receives audio/video with the displayed glass-to-glass latency below 400 ms on a LAN-class connection.
7. Toggle microphone and camera, send Amen and raised-hand reactions, and open/close the invite dialog with the keyboard.
8. Enable captions where local transcription is available.
9. Leave from the participant and confirm the roster updates.
10. End from the host and confirm every participant is returned to a defined ended state.

## Deployment contract

A deployed Cenacle instance is valid only when all of the following are in place.

### Network and TLS

- A stable DNS name resolves to the room origin.
- The endpoint presents a publicly trusted certificate whose SAN covers that DNS name.
- The certificate and private key are readable only by the origin service account.
- HTTP/3 is reachable over UDP, normally UDP `443`; opening TCP `443` alone is not sufficient.
- Any firewall, load balancer, CDN, or edge in front of the service supports HTTP/3 and WebTransport end to end. A TCP-only HTTP/1.1 or HTTP/2 reverse proxy cannot carry this room transport.
- Clients can reach the room origin directly without a network policy that blocks QUIC.

### Build-time client configuration

- `VITE_ROOM_ORIGIN` is the exact public HTTPS origin used for room APIs and WebTransport, with no path component.
- `VITE_WT_CERT_HASH` is unset for a publicly trusted production certificate. It is only for the generated, short-lived local certificate.
- The client is rebuilt after any Vite environment value changes.
- If the client and room origin use different origins, the client host serves a single-page-app fallback and its CSP allows `connect-src` to the configured room origin.

### Runtime origin configuration

- `CENACLE_ALLOWED_ORIGINS` contains the exact browser application origin or comma-separated origins allowed to create WebTransport sessions and use the room API.
- `CENACLE_WEB_ROOT` points to the built `dist` directory when the Python origin serves the client.
- The origin is launched with the production certificate and private key paths.
- Process supervision restarts a failed origin and captures standard logs without recording request bodies or media.
- The `/healthz` endpoint is monitored over HTTP/3, not only through a TCP health check.

### Topology and lifecycle constraints

- Room state and media relay are process-local and in memory.
- A restart ends every room and invalidates every room credential.
- The current release has no shared room registry and must not be round-robin load-balanced across multiple independent replicas. All API and WebTransport traffic for a room must reach the same process.
- Each room accepts at most eight participants.
- Room bearer credentials expire after 12 hours.
- Recording, server-side journal storage, VOD, cloud transcription, and cloud AI are not implemented.

### Client environment

- The application is served from a secure HTTPS context.
- Users run a current desktop Chrome or Edge with WebTransport and WebCodecs enabled.
- Camera and microphone permissions are allowed by both the browser and operating system.
- WebGPU and on-device AI are optional; deployment acceptance must verify their defined degraded states as well as their available states.

## Build and start a deployed origin

The simplest supported topology serves the built client, room APIs, and WebTransport from the same HTTP/3 origin.

```powershell
npm ci
.\.venv\Scripts\python.exe -m pip install -r room_origin\requirements.txt

$env:VITE_ROOM_ORIGIN = "https://rooms.example.com"
Remove-Item Env:VITE_WT_CERT_HASH -ErrorAction SilentlyContinue
npm run build

$env:CENACLE_ALLOWED_ORIGINS = "https://rooms.example.com"
$env:CENACLE_WEB_ROOT = (Resolve-Path .\dist).Path

.\.venv\Scripts\python.exe -m room_origin.cenacle_origin.server `
  --host 0.0.0.0 `
  --port 443 `
  --certificate C:\secure\cenacle\fullchain.pem `
  --private-key C:\secure\cenacle\private.key
```

Binding UDP `443` may require platform-specific service permissions. A production service manager should provide the environment, restart policy, working directory, log collection, and least-privilege identity. Do not place certificate keys in the repository or web root.

For a split client/origin deployment, build with the room origin URL but allow the separate application origin at runtime:

```powershell
$env:VITE_ROOM_ORIGIN = "https://rooms.example.com"
npm run build

$env:CENACLE_ALLOWED_ORIGINS = "https://pray.example.com"
```

The static host at `https://pray.example.com` must return `index.html` for client-side routes such as `/host`, `/join`, and `/r/ABC234`. The room origin must remain reachable over HTTP/3 and WebTransport.

## Validate a deployed version

Run deployment validation against a staging environment before production. Use production only for non-destructive smoke checks unless a maintenance window explicitly permits origin restart or failure testing.

### 1. Probe the real HTTP/3 health contract

This one-shot probe exits nonzero if DNS, TLS, QUIC, HTTP/3, or the response contract fails:

```powershell
.\.venv\Scripts\python.exe -c "import asyncio; from room_origin.scripts.monitor import probe; ok = asyncio.run(probe('https://rooms.example.com/healthz', 10)); print('healthy' if ok else 'unhealthy'); raise SystemExit(0 if ok else 1)"
```

Expected response semantics are HTTP `200` with JSON containing:

```json
{"status":"ok","transport":"h3-webtransport"}
```

A generic HTTPS or TCP probe is not equivalent because it can pass while UDP or HTTP/3 is unavailable.

### 2. Verify the application shell in Chrome

1. Open the deployed application in a normal current Chrome profile without bypass flags.
2. Confirm the certificate is trusted and DevTools reports no mixed-content or CSP errors.
3. Visit every public route listed in [Local UI development](#local-ui-development).
4. Check desktop and 375 px responsive layouts.
5. Open `/support` and record the detected capabilities. WebTransport and WebCodecs must be ready for Presence acceptance.

### 3. Run a two-client live gathering

Use two browser profiles or, preferably, two physical devices on different networks so the validation crosses the deployed edge.

1. Host a room from client A.
2. Resolve and join the code from client B.
3. Confirm both clients show the same room code and `2 present`.
4. Confirm video, audio, roster updates, mute, camera, Amen, raised hand, invite, leave, and host-end behavior.
5. Collect at least 20 displayed latency samples after warm-up. The median target is less than 400 ms; investigate sustained regressions or large spikes.
6. Briefly interrupt client B's network, restore it, and verify the reconnect state either recovers or offers a clear retry/leave path.

### 4. Verify private actions do not egress

In Chrome DevTools:

1. Open the Network panel and wait for initial application telemetry to settle.
2. Clear the request list.
3. Surface a Scripture passage, save it, write and save a journal entry, and request an on-device reflection if available.
4. Confirm those actions generate no network requests.
5. Confirm text entered in Word features never appears in request URLs, headers, payloads, logs, or the room-origin telemetry endpoint.
6. Confirm journal entries and settings appear only under the deployed application's origin-scoped browser storage.

Repeat with on-device AI unavailable. The UI must explain the degradation and must not offer a cloud fallback.

### 5. Verify security and operational behavior

- Attempt an invalid room code repeatedly in staging and confirm rate limiting eventually returns `429`.
- Confirm a participant credential cannot end a room.
- Confirm the origin CSP includes `frame-ancestors 'none'`, `object-src 'none'`, and same-origin connection policy when serving the client.
- Confirm responses include `X-Content-Type-Options: nosniff`, a no-referrer policy, and camera/microphone permissions policy.
- Confirm logs contain only fixed operational events and no names, codes, journal text, captions, or media.
- In staging, restart the origin and confirm prior room codes no longer resolve. This demonstrates the documented ephemeral lifecycle.

### 6. Verify degradation

Test at least one environment with each optional capability unavailable:

- No WebGPU: Presence remains usable with a still backdrop.
- No on-device AI: Presence and private journal writing remain usable without reflection or cloud fallback.
- No WebTransport or WebCodecs: live entry is unavailable and the support page explains which browser/device is required.
- Reduced motion: decorative animations stop without hiding content or controls.

## Continuous monitoring

The bundled monitor probes HTTP/3 continuously and alerts once when the configured consecutive-failure threshold is reached:

```powershell
.\.venv\Scripts\python.exe room_origin\scripts\monitor.py `
  https://rooms.example.com/healthz `
  --interval 15 `
  --threshold 3 `
  --webhook https://monitor.example/hooks/cenacle
```

Use `--ca-certs <path>` only for a private CA that should be trusted explicitly. Use `--insecure` only against disposable development certificates, never in production monitoring.

Alerting should distinguish at least:

- DNS or certificate failure
- UDP/QUIC reachability failure
- origin process exit or restart loop
- latency regression above the 400 ms target
- room admission or authorization error-rate spikes
- repeated client capability degradation after a browser release

## Troubleshooting

| Symptom | Likely cause | Checks and resolution |
| --- | --- | --- |
| Vite URL shows another application | Port already belongs to another process | Use `--port <free-port> --strictPort`; verify the page title is `Cenacle — Upper room` |
| Development page is blank | Stale server/config, blocked scripts, or browser console error | Restart Vite after config changes; inspect DevTools Console and the response CSP |
| `test:e2e` cannot launch a browser | Configured branded channel is not installed | Install Chrome/Edge or install Playwright Chromium and set `CENACLE_BROWSER_CHANNEL=chromium` |
| `test:h3` exits before browser launch | Missing Python environment, package wheels, certificate generation, or occupied UDP port | Verify `.venv`, reinstall `room_origin/requirements.txt`, and free UDP `4433` |
| `/healthz` fails but normal HTTPS works | TCP succeeds while UDP/QUIC is blocked | Check UDP firewall, load balancer HTTP/3 support, ALPN, DNS, and certificate chain |
| Host setup loads but **Go live** fails | Client was built for the wrong origin, origin is down, CORS allowlist is wrong, or WebTransport is blocked | Inspect `VITE_ROOM_ORIGIN`, rebuild, probe `/healthz`, and compare the exact app origin with `CENACLE_ALLOWED_ORIGINS` |
| Local certificate is rejected | Certificate expired, hash is stale, or Chrome flags were ignored by an existing process | Regenerate the certificate, update `.env.local`, rebuild, recompute SPKI, and launch an isolated browser profile |
| Camera or microphone fails | Browser/OS permission denied, device is busy, or insecure context | Use HTTPS/localhost, grant permissions, close competing applications, or test audio-only recovery |
| WebGPU or on-device AI is unavailable | Hardware, browser build, policy, or model state does not support it | Confirm the support page shows the defined degraded state; do not treat optional capability absence as a Presence outage |
| Rooms intermittently disappear behind a load balancer | Requests are reaching independent origin processes | Deploy a single origin process; multi-replica room affinity/shared state is not implemented |
| Private text appears in network traffic | Privacy contract regression | Stop the release, preserve the trace securely, reproduce with the private-action browser test, and fix before deployment |

## Release sign-off checklist

### Code and controlled tests

- [ ] `npm ci` completes from the lockfile.
- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes.
- [ ] `npm run test:e2e` passes in the release Chrome or Edge channel.
- [ ] `npm run test:origin` passes.
- [ ] `npm run test:h3` passes with median glass-to-glass latency below 400 ms.
- [ ] `git diff --check` reports no whitespace errors.

### Deployment readiness

- [ ] Public DNS, trusted TLS, and UDP HTTP/3 reachability are confirmed.
- [ ] `VITE_ROOM_ORIGIN` matches the deployed room origin and the client was rebuilt.
- [ ] `VITE_WT_CERT_HASH` is absent from the production build.
- [ ] `CENACLE_ALLOWED_ORIGINS` contains only intended application origins.
- [ ] Certificate and key permissions are restricted.
- [ ] The deployment uses the documented single-process room topology.
- [ ] Process supervision, logs, and the HTTP/3 monitor are active.

### Deployed acceptance

- [ ] The one-shot HTTP/3 health probe passes.
- [ ] Public routes render in Chrome at mobile and desktop widths.
- [ ] Two real clients can host, join, exchange media, react, leave, and end.
- [ ] The observed median glass-to-glass latency is below 400 ms.
- [ ] Private Word actions make zero requests and private text is absent from logs.
- [ ] WebGPU, on-device AI, reduced-motion, and unsupported-Presence degradation states are correct.
- [ ] No browser console, CSP, mixed-content, certificate, or unhandled runtime errors remain.
