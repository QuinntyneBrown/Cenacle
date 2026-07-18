# Cenacle mock — build contract

Every mock is a **single static HTML file** in `docs/mocks/` that links `assets/cenacle.css`.
All visual language (color, type, spacing, components) lives in that stylesheet. Your job is
to assemble semantic markup from its classes — **do not restyle tokens, colors, or components.**
A page-local `<style>` block is allowed ONLY for layout (grid/flex/positioning) unique to the page.

## The two registers

| Register | `<body>` | Use for | Feel |
|---|---|---|---|
| **Light — "manuscript"** | `<body>` | marketing, onboarding, forms, utility, most errors | warm vellum, navy ink, disciplined, airy |
| **Night — "upper room"** | `<body class="night">` | the live gathering, journal, PiP, in-room dialogs/overlays | deep contemplative dark, breathing ember glow |

Only a **night `<body>`** paints the fixed ambient background. A nested `.night` panel on a light
page (e.g. a demo "window") inherits dark tokens but no page background — that's intentional.

## Required `<head>` + sprite

```html
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Cenacle — {page}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="assets/cenacle.css">
</head>
```

First element inside `<body>` — the flame gradient sprite (enables `fill="url(#fl)"`):

```html
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <linearGradient id="fl" x1="0" y1="1" x2="0" y2="0">
    <stop offset="0" stop-color="#D2532A"/><stop offset=".55" stop-color="#E4923A"/><stop offset="1" stop-color="#F6CE8B"/>
  </linearGradient>
</defs></svg>
```

Flame logo (wordmark): 
```html
<a class="brand" href="index.html"><svg class="flame" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2c.6 4.2 4.8 6 6.6 9.8 1.9 4 .2 9.6-4.4 11.4-.2-2.2-.9-3.6-2.4-4.8.3 2 .1 3.6-1.1 5.2-3.3-.9-5.7-3.9-5.7-7.6 0-2.2 1-3.9 2.3-5.6.2 1.6.9 2.6 2 3.3C15 15 13.6 9 16 2Z" fill="url(#fl)"/></svg> Cenacle <small>upper room</small></a>
```

## Icon set — inline SVG, 24×24, `fill="none" stroke="currentColor" stroke-width="1.7"` round caps

Wrap each in `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">…</svg>`. Paths:

- **mic** `<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4"/>`
- **mic-off** `<path d="M4 4l16 16M9 5a3 3 0 0 1 6 1v3M15 12v-1M6 11a6 6 0 0 0 8.5 5.4M12 17v4"/>`
- **camera** `<path d="M15 10l4.5-2.6v9.2L15 14M4 7h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/>`
- **camera-off** camera path + `<path d="M3 3l18 18"/>`
- **amen (hand)** `<path d="M7 11V6a2 2 0 0 1 4 0v4M11 10V4.5a2 2 0 0 1 4 0V11M15 10.5V7a2 2 0 0 1 4 0v7a6 6 0 0 1-6 6h-1.6a5 5 0 0 1-3.7-1.6L4 15s1.2-1.4 3-1"/>`
- **captions** `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 11h3M7 14h6M14 11h3"/>`
- **word (book)** `<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z"/><path d="M19 17H6a2 2 0 0 0-2 2"/>`
- **pen (feather)** `<path d="M20 4C12 5 8 8 5 18l1 1C16 16 19 12 20 4Z"/><path d="M6 19l5-5"/>`
- **sparkle** `<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z"/>`
- **shield-check (privacy)** `<path d="M12 3l7 3v5c0 4.4-3 8.3-7 9.5C8 19.3 5 15.4 5 11V6l7-3Z"/><path d="M9 12l2 2 4-4"/>` (use stroke-width 2 inside `.seal__icon`)
- **lock** `<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>`
- **users** `<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M16 6a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6"/>`
- **download** `<path d="M12 3v12M7 11l5 5 5-5M5 21h14"/>`
- **wifi-off** `<path d="M3 3l18 18M9 17a4 4 0 0 1 6 0M6 12a9 9 0 0 1 4-2.4M18.5 12.4A9 9 0 0 0 16 10.8M2.5 8.5A15 15 0 0 1 8 6M21.5 8.5a15 15 0 0 0-6-3M12 21h.01"/>`
- **chip (gpu)** `<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M10 3v2M14 3v2M10 19v2M14 19v2M3 10h2M3 14h2M19 10h2M19 14h2"/>`
- **globe** `<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>`
- **bolt** `<path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/>`
- **check** `<path d="M4 12l5 5 11-11"/>` · **x** `<path d="M6 6l12 12M18 6L6 18"/>` · **plus** `<path d="M12 5v14M5 12h14"/>`
- **arrow-right** `<path d="M4 12h16M13 5l7 7-7 7"/>` · **chevron-right** `<path d="M9 6l6 6-6 6"/>`
- **alert-triangle** `<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/>`
- **info** `<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>`
- **copy** `<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>`
- **refresh** `<path d="M20 8a8 8 0 1 0 .8 6M20 4v4h-4"/>`
- **leave (phone-down)** `<path d="M3 6c6-3 12-3 18 0 .6.3 1 1 1 1.6V10c0 .8-.7 1.5-1.5 1.4l-3-.3a1.5 1.5 0 0 1-1.3-1.2l-.3-1.7c-3-1-5.8-1-8.8 0l-.3 1.7a1.5 1.5 0 0 1-1.3 1.2l-3 .3C2.7 11.5 2 10.8 2 10V7.6C2 7 2.4 6.3 3 6Z"/>`
- **pip-window** `<rect x="3" y="4" width="18" height="14" rx="2"/><rect x="12" y="11" width="7" height="5" rx="1"/>`
- **gear** `<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>`
- **clock** `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`

## Key components (from cenacle.css — use verbatim)

- **Buttons:** `.btn`, + `.btn--primary` (ember gradient, the main action), `.btn--ghost`, `.btn--quiet`, `.btn--danger`, `.btn--danger-solid`; sizes `.btn--lg/.btn--sm`, `.btn--block`. Add an icon SVG as first child where it clarifies the action.
- **Pills / status:** `.pill`, `.pill--accent`, `.pill--sage`, `.pill--danger`; dots `.dot.dot--live` (breathing red = broadcasting), `.dot--sage` (private/on-device), `.dot--ember`.
- **Privacy seal (signature):** `.seal` with `.seal__icon` (shield-check) — use anywhere the on-device promise is relevant. Pair with `.mono` for `0 requests` / `on-device`.
- **Cards / panels:** `.card`, `.feature-card`, `.panel` + `.panel__head`/`.panel__body`, `.glyph` (icon chip, `.glyph--sage`).
- **Forms:** `.field` > `.label` + `.input`/`.textarea`/`.select` + `.hint`; `.field--error`; `.code-input` (room codes); `.switch` (toggle); `.segmented`.
- **Dialog:** `.scrim` (fixed dim backdrop) > `.dialog` (`.dialog--wide/.dialog--sheet`) with optional `.dialog__accent` (flame bar), `.dialog__close`, `.dialog__head` (`.dialog__eyebrow` + `.dialog__title`), `.dialog__body`, `.dialog__foot`.
- **Presence:** `.stage`/`.stage__glow`, `.tile` + `.tile__fill`/`.tile__name`/`.tile--speaking`/`.tile--host`/`.tile__muted`, `.grid-tiles`, `.dock`+`.control` (`.control--accent/.control--off/.control--leave`, `.control__label`), `.captions` (`.cap-speaker`/`.cap-text`/`.live`), `.assent`, `.mote`.
- **Companion:** `.verse` blockquote (+`.ref`), `.verse-card`, `.journal-editor`, `.paper-panel`, `.reflection`.
- **Feedback:** `.banner` (`--warn/--danger/--sage`), `.toast`, `.seal`, `.steps`, `.progress`+`.progress__bar`.
- **States:** `.state` > `.state__inner` > `.state__mark` (`--sage/--danger`) + `h1` + `p` + `.cluster` of buttons. For in-room interruptions use `.overlay`.
- **Layout:** `.container` (`-narrow/-wide`), `.section`, `.stack`, `.cluster`, `.between`, `.grid` + `.cols-2/.cols-3/.split`. Gap utilities `.gap-2..6`, margins `.mt-*`/`.mb-*`.

## Voice

Warm, plain, unhurried; reverent without being pious. Sentence case. Active verbs; a control names
exactly what it does and keeps that name through the flow ("Host a room" → you're hosting).
Errors don't apologize and are never vague: say what happened and the one next step. Empty screens
invite the first action. Reserve the serif (`.sacred`, `.verse`, `.reflection`) for Scripture and
reflections only. Use `.mono` for the technical wow — latency (`312 ms`), room codes, `0 requests`.
Scripture references are illustrative; keep reflections gentle, never authoritative or pastoral-directive.

## Cross-linking

Brand logo → `index.html`. Wire primary actions to their real sibling mock (e.g. "Host a room" →
`create-room.html`; "Join" → `dialog-join-room.html`; in-room "Invite" → `dialog-invite.html`; a
dialog's backdrop should resemble the screen it belongs to). Dialog/overlay pages render the parent
screen behind the `.scrim` (a simplified version is fine — reuse the exemplar's structure).
