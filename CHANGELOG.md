# Changelog

All notable changes to **Rollhaven** (formerly Dicebound) are documented in this file.

## [1.3.0] — 2026-11-24

### Fixed & Added
- **Hardware Haptics & Mobile Vibration (Android & iOS):**
  - Tuned collision/bounce pulse durations (`48ms` light, `68ms` medium, `[65, 50, 90]` heavy) with a non-cancelling vibration lock to clear Android ERM/LRA spin-up latency, plus synchronous trusted user-gesture triggers (`pointerdown`/`pointermove`/`pointerup`/`click`) for both `navigator.vibrate()` and iOS Taptic `<input type="checkbox" switch />`.
- **DM All-5 Decision Sets & WebSocket Stability:**
  - Fixed the stale-connection race in `useDiceboundSocket` when upgrading `DMDashboard` from unauthenticated to `role=dm`, and allowed DM PIN/localhost auto-elevation on `ROLL_ACTION` so all 5 decision sets (Dice, Coin, Magic 8 Ball, Peonza, Ruleta) broadcast cleanly from the DM panel (with an optional simultaneous "Ver los 5 Sets" view).
- **True Rectangular Maps with 1:1 Square Grid Cells:**
  - Replaced the forced `1:1` board frame in `TacticalMapCanvas` with `cols * 50` × `rows * 50` logical dimensions so rectangular maps (`20x30`, `25x30`, hallways) adjust their outer aspect ratio while keeping every internal tile strictly square.
- **DM Tactical Map Entities (`map_entities`):**
  - Added SQLite persistence (`map_entities` table) and DM WebSocket controls (`ADD_MAP_ENTITY`, `MOVE_MAP_ENTITY`, `UPDATE_MAP_ENTITY`, `DELETE_MAP_ENTITY`, `CLEAR_MAP_ENTITIES`) for Enemies, Traps, Items/Loot, NPCs, Hazards, and Doors/POIs with HP tracking, sizes (`1x1`–`4x4`), notes, and DM-only hidden visibility (`is_hidden`).

---

## [1.2.0] — 2026-11-23

### Changed & Added
- **Rebrand to Rollhaven (`github.com/SilverFeit/Rollhaven`):**
  - Renamed application, Go module, Windows/macOS executables (`rollhaven-windows-amd64.exe`, `rollhaven-mac-arm64`, `rollhaven-mac-amd64`, `Rollhaven.app`, `Rollhaven-1.2.0-macOS.dmg`), TLS Root CA (`rollhaven-ca.crt`), cookies (`rollhaven_dm_pin`), and UI branding across all views to **Rollhaven**.
  - Updated GitHub repository to `SilverFeit/Rollhaven` with discovery topics/tags (`dnd`, `dungeons-and-dragons`, `dice-roller`, `tabletop-rpg`, `ttrpg`, `virtual-tabletop`, `lan`, `golang`, `react`, `typescript`, `sqlite`, `websockets`, `html5-canvas`, `windows`, `macos`, `open-source`, `rollhaven`).

---

## [1.1.2] — 2026-11-23

### Fixed & Added
- **Dual HTTP + HTTPS (`wss://`) Multiplexer on Port 8080 (`pkg/server/tls.go`):**
  - Automatically generates a local Root CA and TLS certificate for `localhost` and the active LAN IP (`192.168.x.x`), multiplexing both `http://` and `https://` (`wss://`) on the same port `8080` so mobile browsers run in a Secure Context (`window.isSecureContext === true`) required by `DeviceMotionEvent` on iOS Safari, iOS Chrome, and Android Chrome.
  - DM Dashboard QR defaults to `https://<LAN_IP>:<PORT>` with a quick `HTTPS / HTTP` toggle.
- **Mobile Accelerometer & iOS Shake-to-Undo Fix (`DicePhysicsArena.tsx`):**
  - Fixes `null` `ev.acceleration` properties by subtracting consecutive `ev.accelerationIncludingGravity` deltas, monitoring `rotationRate` & `deviceorientation`, blurring active inputs before shake to prevent iOS "Shake to Undo" dialogs, and offering a 1-tap **Cambiar a HTTPS** redirect if opened over plain HTTP.
- **Cross-Platform Haptic Feedback (`frontend/src/lib/haptics.ts`):**
  - Triggers tactile feedback on every die-to-wall bounce, die-to-die collision, Peonza wall bounce, and final landing using `navigator.vibrate`, iOS Safari 17.4+ `<input type="checkbox" switch />`, and a low-frequency WebAudio tactile thud.

---

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
