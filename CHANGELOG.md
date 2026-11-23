# Changelog

All notable changes to **Dicebound** are documented in this file.

## [1.1.1] — 2026-11-23

### Added
- **Global Footer with License & Version:** Added a bottom footer (`AppFooter`) across Onboarding, Player Workspace, and DM Dashboard showing the current app version (`v1.1.1`, synced from `/api/v1/health`) and `Licencia MIT (Copyright © 2026 SilverFeit)`.
- **Health Endpoint Metadata:** `/api/v1/health` now returns `version` and `license` fields.

---

## [1.1.0] — 2026-11-23

### Added
- **3D Perspective Bouncing Peonza Arena (`frontend/src/components/PeonzaArenaCanvas.tsx`):**
  - Renders the Peonza / Pirinola in true 3D perspective (conical tip, beveled polygonal facet drum for 4–12 faces, precession wobble, and upper stem) clearly distinct from the top-down Ruleta.
  - Moves along a randomized trajectory inside a perspective bounding box, deflecting randomly on wall bounces while decreasing both linear velocity and spin speed on every impact until tilting onto the server-determined winning face.
- **1:1 Physical Dice Arena (`frontend/src/components/DicePhysicsArena.tsx`):**
  - Dedicated `1:1` square HTML5 `<canvas>` dice tray (`d2`, `d4`, `d6`, `d8`, `d10`, `d12`, `d20`, `d100`) with polyhedral shapes, wall bounces, and elastic die-to-die collisions.
  - **Hold-to-Shake ("Batir los dados"):** Holding on the `1:1` tray, the shake button, or any `d2..d100` button continuously swirls and collides the dice until release.
  - **Mobile Accelerometer Shake Gesture (`DeviceMotionEvent`):** Supports shaking the phone (`Agitar Celular` with iOS `requestPermission()` support and HTTP LAN fallback guidance) to agitate and throw the dice.

---

## [1.0.0] — 2026-11-23

### Added
- **Single-Binary Cross-Platform LAN Server (`cmd/app`, `pkg/embed`, `pkg/database`, `pkg/network`):**
  - Pure-Go embedded SQLite (`modernc.org/sqlite`, `CGO_ENABLED=0`) with automatic migrations (`sessions`, `players`, `inventory_items`, `player_notes`, `dm_notes`, `action_log`) and zero external runtime requirements on Windows x64 and macOS (`arm64` / `amd64` + Universal `Dicebound.app`).
  - Automatic Wi-Fi/Ethernet LAN IPv4 discovery filtering loopback, Docker, VirtualBox, VMWare, WSL, and VPN interfaces.
  - Auto-launches the host browser straight to `/dm` and prints the LAN URL and 4-digit remote DM PIN in the terminal.
- **Cryptographic Decision Engines (`pkg/engine` — 100% `crypto/rand`, zero `math/rand`):**
  - **Set 1 — Polyhedral Dice:** Full `d2`, `d4`, `d6`, `d8`, `d10`, `d12`, `d20`, `d100` support with `NdX+M` notation and Natural 20 / Natural 1 critical highlights.
  - **Set 2 — Realistic Physics Coin:** Exact probability model (`CANTO` $1/6000 \approx 0.0167\%$, `CARA` $5999/12000$, `CRUZ` $5999/12000$) validated via 600,000-iteration Monte Carlo testing.
  - **Set 3 — Magic 8 Ball:** All 20 classic answers (10 affirmative, 5 neutral, 5 negative) plus a strict 50/50 Yes/No toggle.
  - **Set 4 — Customizable Peonza (4–12 Faces):** 6-face factory preset + custom label editor and synchronized 2.5s rotation landing on the server-chosen face.
  - **Set 5 — Dynamic Decision Wheel:** Configurable SVG multi-wedge wheel with smooth 2.5s animation landing on the server-selected outcome.
- **WebSocket Real-Time Turn Engine (`pkg/server`):**
  - Descending initiative order with sub-millisecond `created_at` tie-breaking, unlimited rolls per turn until explicit `Pasar Turno`, 15-second PING/PONG heartbeat with latency measurement, and `localStorage` session rehydration on mobile screen-lock/reconnect.
- **Dungeon Master Dashboard (`/dm`) & Mobile Player Suite (`/`):**
  - QR code LAN onboarding, live connected-device presence table (client IP, device/browser, latency, inline initiative editing, drag-and-drop reordering, force next/prev turn, kick), global audit log, and 500 ms debounced private DM notes.
  - Minimalist player onboarding (Name + Initiative), offline SVG race selector (9 races), 10 MB PDF/image character sheet uploader & modal viewer, interactive inventory tracker (`+/-`), and 500 ms debounced personal notes.
  - Optional HTML5 `<canvas>` tactical map (`5×5` to `50×50` grid) with 60 fps Pan/Zoom, custom background map upload, token visibility toggle, and strict per-player token movement permissions.
