# Detailed-design implementation verification

This matrix maps every requirement in `docs/specs/L2.md` and `docs/detailed-designs` to current implementation and executable evidence. Evidence keys:

- **P** — `src/test/presence.test.ts`
- **W** — `src/test/word.test.ts`
- **S** — `src/test/sanctuary.test.ts`
- **X** — `src/test/cross-cutting.test.tsx`
- **B** — `e2e/detailed-designs.spec.ts` (`npm run test:e2e`)
- **O** — `room_origin/tests` (`npm run test:origin`)
- **H** — `e2e/h3-live.mjs` (`npm run test:h3`), real TLS/HTTP3/native WebTransport with two browser contexts

| Requirement | Implemented evidence | Verification |
|---|---|---|
| L2-001 | `HostPage`, `GatheringSetup`, 1–60 character normalization and inert React rendering | P, B |
| L2-002 | `MediaDeviceService` enumeration and setup selectors | B, X |
| L2-003 | Setup caption/visual toggles seed saved room settings | B, X |
| L2-004 | Private `PreviewVideo` plus existing-stream `MediaStreamLevelMeter` dB meter | B, H |
| L2-005 | Transactional `GoLiveController`: admission, authenticated transport, WebCodecs publish, cleanup | B, H, O |
| L2-006 | Case-insensitive `RoomResolver` accepts code or `/r/{code}` link | P, O |
| L2-007 | `GreenRoomPage` resolves before permission acquisition and exposes room errors | B, H, O |
| L2-008 | `InviteArtifacts` keeps one code across display/link/QR | P, B |
| L2-009 | Accessible permission primer, safe decline, camera-off recovery | B, X |
| L2-010 | Transactional `EnterRoomController`, stream subscription, WebCodecs decode/render | B, H |
| L2-011 | H.264/VP9 negotiation with hardware preference/fallback; native media relay | P, H |
| L2-012 | Room-clock ping/pong normalizes capture and receiver timestamps | P, H |
| L2-013 | `LatencyMeter` room readout; sustained native median measured by H test | P, B, H |
| L2-014 | Local mute/camera controls gate tracks, encoders, and relayed presence | B, H |
| L2-015 | Authoritative roster relay, present count, late-listener roster replay | P, B, O, H |
| L2-016 | Local/remote audio levels drive `ActiveSpeakerDetector` and presence state | P, B, H |
| L2-017 | Host role is relayed and visibly marked in stage, roster, and tiles | P, B, O |
| L2-018 | Amen sends a WebTransport datagram and surfaces an accessible flame mote | P, B, O |
| L2-019 | `ReactionCounter` maintains and announces a rolling 60-second count | P, B |
| L2-020 | Client reaction interval plus authoritative per-participant origin limiter | P, O |
| L2-021 | Raised-hand reaction uses the same bounded corporate-reaction path | P, B, O |
| L2-022 | Persisted ambient and audio-reactive settings control room sanctuary behavior | S, X, B |
| L2-023 | `MoteRenderer` replaces animation with a static surface under reduced motion | P, B, X |
| L2-024 | Host-only invite button opens a labelled focus-trapped dialog | B |
| L2-025 | Invite dialog builds link, QR, and copy actions from one artifact | P, B |
| L2-026 | Unambiguous six-character code is exact across API, URL, QR, and room state | P, O, H |
| L2-027 | Leave confirmation stops media/transport and removes the participant | B, O |
| L2-028 | Host-only destructive end closes the room and broadcasts `room-ended` | B, O |
| L2-029 | Participant leave does not end the ephemeral room; credential can rejoin while valid | O |
| L2-030 | Bounded backoff reconnect pauses outbound media, reports attempts, retries, and allows leave | P, B |
| L2-031 | Server capacity eight and explicit recoverable room-full state | O, X |
| L2-032 | Invalid/closed codes resolve to explicit room-not-found state | O, X |
| L2-033 | Plain theme input, quick-theme chips, and inert echoed theme text | B |
| L2-034 | `VerseIndex` retrieves only existing local passages with no request | W, B |
| L2-035 | Another/context/save/why actions are present on passage results | W, B |
| L2-036 | No-match state offers local alternatives and invents no reference | W |
| L2-037 | Recent themes deduplicate and persist locally | W |
| L2-038 | Live `JournalEditor` word count runs without egress | W, B |
| L2-039 | Entries and kept reflections persist only through origin-scoped `LocalStore` | W, X |
| L2-040 | On-device reflection shows progress; unavailable reflection is hidden while writing/saving remains | W, X, B |
| L2-041 | `ReflectionPolicy` rejects directives/authority and requires tentative language plus writer's last word | W |
| L2-042 | Keep/dismiss feedback mutates only the local entry | W |
| L2-043 | Empty/populated drafts clear safely | W |
| L2-044 | Empty journal explicitly states private on-device behavior | W, B |
| L2-045 | `processLocally` speech recognition consumes the mixed local/remote audio track; no cloud fallback | W, B |
| L2-046 | Speaker-attributed final/interim captions; finalized lines announce through polite live region | W, X |
| L2-047 | Supported language selection, availability, local pack installation, and persistence | W, X |
| L2-048 | Caption on/off preference seeds green room and room across sessions | W, H |
| L2-049 | Prompt API/device/model detection contains failures and sends no private content | W, X, B |
| L2-050 | One-time local model download exposes size, percent, ETA, background continuation, and no reload | W, B |
| L2-051 | Settings expose status/size/recheck/removal guidance; Presence remains independent | W, X |
| L2-052 | Deferred WebGPU sanctuary renders behind Presence at a 60fps RAF target with still fallback | S, X, B |
| L2-053 | Host/settings toggles persist; OS reduced motion overrides motion gain | S, X, B |
| L2-054 | `AudioAnalyser` derives local amplitude/frequency bands for shader uniforms | S, B |
| L2-055 | Audio-reactive and ambient toggles remain independent; reduced motion minimizes gain | S, X |
| L2-056 | Document Picture-in-Picture capability gate and unavailable-message path | S |
| L2-057 | Floating view has one-line caption, latency, mute, and leave controls | S |
| L2-058 | The same media stage moves to PiP and restores with live session continuity | S |
| L2-059 | Settings list camera/mic/speaker and provide live meter, dB, and flat-input guidance | X, B |
| L2-060 | H.264/VP9 segmented choice, trade-off copy, and `< 400 ms` target | X, B |
| L2-061 | Caption toggle/language/model status appear under on-device Prompt API heading | X, B |
| L2-062 | Ambient/audio-reactive toggles, reduced-motion note, and WebGPU still-fallback notice | X, B |
| L2-063 | Explicit Save/Cancel draft semantics persist settings only to `LocalStore` | X, B |
| L2-064 | Four probes always yield a support matrix/count and contain rejected/time-limited probes | X, B |
| L2-065 | Missing WT/WebCodecs names supported browsers, explains requirements, copies link, and blocks entry | B, X |
| L2-066 | Missing AI hides Scripture/reflection/captions, preserves Presence and private journal, never reroutes | X, B, H |
| L2-067 | Missing WebGPU uses a zero-request still backdrop without disabling other areas | S, X, B |
| L2-068 | Permission/device-in-use resolver provides retry and camera-off/audio-only recovery | P, X, B |
| L2-069 | No server route or client call carries journal/theme/reflection/caption content | W, X, B, O |
| L2-070 | `NetworkGuard` actively blocks attempted private fetches; browser actions record zero requests; UI seals show zero | X, B |
| L2-071 | Origin relays bytes without disk writes; setup/green-room copy says nothing is recorded; no recording/VOD API | B, O, H |
| L2-072 | TLS H3 origin validates credential before accepting native WebTransport media | O, H |
| L2-073 | Domain/UI/origin length validation, control stripping, safe link parsing, and inert browser rendering | P, X, B, O |
| L2-074 | Production/Vite/origin CSP restricts script/font/connect/framing to self and room origin; fonts are bundled locally | X, O, B, H |
| L2-075 | Cryptographic room codes/tokens, expiry/host authorization, enumeration throttling, and server capacity | O, H |
| L2-076 | Private storage is app-origin local/session storage and clearable in settings | X, B |
| L2-077 | Low-latency decoder drops late queued deltas; native two-party H test enforces sustained median `<400 ms` | P, H |
| L2-078 | RAF rendering and `FrameScheduler` shed audio-reactive then ambient work before essential Presence | S, X, B, H |
| L2-079 | Capacity is eight; topology explicitly has no SFU/large fanout and origin enforces the bound | X, O |
| L2-080 | 3-second budget/deferred model+GPU strategy; production shell passes 4× CPU-throttled browser check | X, B |
| L2-081 | All public screens plus live room have browser overflow checks at XS/SM/MD/LG/XL | X, B |
| L2-082 | Native controls, global visible focus, focus traps, Escape close, and opener restoration | X, B |
| L2-083 | Labelled dialog/alertdialog roles and polite/assertive caption/reaction/reconnect live regions | W, X, B |
| L2-084 | OS reduced motion plus computed WCAG AA token contrast in manuscript and upper-room registers | S, X, B |
| L2-085 | AppShell applies light/night purpose registers; bundled serif is scoped to Scripture/reflection/journal writing | X, B |
| L2-086 | Known failures map to actionable defined states; `ErrorBoundary` contains unexpected failures | X, B |
| L2-087 | Client/origin accept only fixed numeric operational events; identifying/private fields are rejected | X, O |
| L2-088 | Real HTTP/3 health probe/alert script plus origin connection/reconnect UI with retry | O, H |

The matrix is considered current only when `npm run test:all` and `npm run test:h3` both pass from a clean install.
