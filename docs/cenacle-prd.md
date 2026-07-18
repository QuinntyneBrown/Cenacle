# Cenacle — Product Requirements Document

**Working name:** Upper Room · **Preferred name:** Cenacle (Latin *cenaculum* — the upper room of Acts 1–2; distinctive and namespace-clean, unlike "Upper Room," which collides with the Methodist devotional brand)

**One-liner:** A browser-native gathering space where believers pray together with the immediacy of being in the same room — and where what's spoken to God stays between you and God.

---

## 1. Why this exists

Acts 2 opens with the disciples "all together in one place." Video church and prayer calls approximate the *gathering* but lose the *presence* — half-second lag turns corporate prayer into people talking over each other, and every word you speak is routed through someone's server.

Two web-platform shifts (both landed in the last few months) change what's possible in a plain browser tab:

- **Sub-second live presence.** WebCodecs (frame-level encode/decode) over WebTransport (QUIC) delivers latency below the WebRTC jitter buffer. It *feels* like the same room.
- **On-device AI.** The Prompt API (Gemini Nano) runs locally in Chrome. Reflections, transcripts, and Scripture surfacing happen on the device — nothing transmitted. For lament and confession, that privacy is the whole point.

**The "I didn't know the browser could do that" moments:** (1) a live feed that reacts faster than Zoom, no plugin, no app; (2) an AI companion for your most private prayers that provably never phones home.

## 2. Principles & non-goals

**Principles:** Presence over polish · Privacy by architecture (on-device by default) · Minimal surface · Graceful degradation on unsupported browsers.

**Non-goals (v1):** user accounts / social graph · recorded VOD library · text chat · payments/giving · native mobile · moderation tooling · large broadcast scale (v1 targets a *small gathered room*, not a megachurch livestream).

---

## 3. Architecture — 3 subsystems, 9 slices

### Subsystem A — **Presence** *(the live gathering)*
*Tech: getUserMedia · WebCodecs · WebTransport · Insertable Streams · requestVideoFrameCallback*

| # | Slice | What it does | The wow |
|---|-------|--------------|---------|
| A1 | **Host a room** | Capture camera/mic, encode with WebCodecs, publish over WebTransport to the room. | One tab becomes a broadcast origin — no encoder software, no RTMP. |
| A2 | **Join a room** | Pull the WebTransport stream, decode with WebCodecs, render to canvas/WebGPU with frame-accurate sync. | Sub-second latency — it feels co-located, not buffered. |
| A3 | **Corporate "Amen"** | Lightweight reactions (amen / a raised hand) sent as WebTransport datagrams, surfaced to everyone near-instantly. | The room responds *as one* — you feel the assent land in real time. |

### Subsystem B — **Word** *(the private companion)*
*Tech: Prompt API / Gemini Nano (on-device, multimodal in, text out)*

| # | Slice | What it does | The wow |
|---|-------|--------------|---------|
| B1 | **Scripture surfacing** | Type or speak a theme ("fear," "gratitude for provision") → local model suggests a fitting passage. | Instant, offline, no verse leaves the device. |
| B2 | **Private lament journal** | Write freely; on-device AI offers a gentle, grounded reflection. Text is never transmitted. | An AI you can be brutally honest with — architecturally incapable of leaking it. |
| B3 | **Live captions** | On-device transcription of the spoken prayer/teaching for accessibility. | Real-time captions with zero cloud, so even the transcript stays private. |

### Subsystem C — **Sanctuary** *(the ambient space)*
*Tech: WebGPU compute/render · Document Picture-in-Picture*

| # | Slice | What it does | The wow |
|---|-------|--------------|---------|
| C1 | **Ambient visuals** | A WebGPU-rendered atmosphere for the room (light, depth, motion) instead of a flat black frame. | GPU-native beauty at 60fps in a tab. |
| C2 | **Audio-reactive worship** | Visuals respond to the live worship audio in real time (amplitude/frequency → shader uniforms). | The room *breathes* with the music. |
| C3 | **Floating prayer companion** | Document PiP pops the room into an always-on-top window so it stays present while you read Scripture elsewhere. | The gathering "follows you" across the desktop. |

**Totals: 3 subsystems · 9 slices.**

---

## 4. The minimal spine (build order)

The smallest thing that still delivers the wow, in sequence:

1. **A1 + A2** — sub-second presence. This alone is the headline demo.
2. **B2** — private lament journal. Proves the on-device privacy story.
3. **C2** — audio-reactive visuals. Turns a video call into a sanctuary.

Everything else (A3, B1, B3, C1, C3) is additive polish once the spine lands.

## 5. Demo script (the 90-second "wow")

1. Host opens a room; a second device joins → clap on camera, watch it register on the other screen with no perceptible lag. *"Lower latency than your work video calls. Just a browser tab."*
2. Open the lament journal, write something raw, get a reflection back → open DevTools Network panel: **zero requests went out.** *"That never left the machine. It can't."*
3. Worship audio plays; the sanctuary visuals move with it. *"All GPU, all in the tab."*

## 6. Feasibility & sharp edges (flag early)

- **WebTransport server.** Needs an HTTP/3 origin. .NET/Kestrel supports HTTP/3, but WebTransport-over-HTTP/3 server support is still thin — validate the server-side library story before committing (this is the biggest infra risk).
- **On-device AI gating.** Prompt API is stable (Chrome 148) but requires a model download and a capable device, and output is text-only. Feature-detect and hide B-slices where unavailable rather than falling back to cloud — a cloud fallback silently breaks the privacy promise, so degrade, don't reroute.
- **Codec support.** Lean on H.264/VP9 for broad WebCodecs hardware paths; AV1 encode is still limited.
- **Scale.** v1 is a *small room* topology. Fan-out to hundreds is a later architecture problem (SFU / relay), explicitly out of scope.
- **Theological guardrails on B1/B2.** On-device Gemini Nano is small and can misattribute Scripture or reflect poorly. Ground B1 against a local verse index rather than free-generating references; keep B2 reflective, never authoritative/pastoral-directive.

## 7. Success signals (v1)

- Presence latency felt as "same-room" (target < 400 ms glass-to-glass on a LAN-class connection).
- A first-time user says some version of *"wait, this is just a browser?"*
- A user writes something in the lament journal they'd never type into a cloud app — and understands why they safely can.

## 8. Browser-API → capability map

| Capability | API(s) | Status (mid-2026) |
|---|---|---|
| Frame-level encode/decode | WebCodecs | Near-Baseline; broad Chromium support |
| Low-latency QUIC transport | WebTransport | Baseline (Mar 2026) |
| GPU visuals/compute | WebGPU | Baseline (Jan 2026) |
| On-device AI | Prompt API / Gemini Nano | Stable, Chrome 148; device-gated |
| Live frame processing | Insertable Streams | Chromium |
| Always-on-top UI | Document Picture-in-Picture | Chromium |

---

*Scope discipline: if a proposed feature doesn't strengthen presence, privacy, or the sanctuary feel, it belongs in v2.*
