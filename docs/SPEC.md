# Technical Specification (`docs/SPEC.md`)

**Dicebound** implements the complete architecture defined across `SDD-01` through `SDD-07`:

1. **Single-Binary Server & Embedded SPA (`pkg/embed`, `cmd/app`):**
   - Compiles React 18 + TypeScript + Tailwind CSS into `frontend/dist` and embeds it into the Go binary via `//go:embed all:frontend_dist`.
   - Uses pure-Go SQLite (`modernc.org/sqlite`) with WAL mode, foreign keys enabled, and zero CGO dependencies so cross-compilation works cleanly for Windows (`amd64`) and macOS (`arm64` / `amd64`).
   - Supports CLI flags: `-port` (default `8080`), `-dev`, `-no-browser`, `-data-dir`, `-pin`, `-version`.
2. **LAN Discovery, Presence & Turn Engine (`pkg/network`, `pkg/server`, `pkg/engine/turns.go`):**
   - `GetLocalIP()` enumerates active interfaces while filtering loopback, Docker, VirtualBox, VMWare, veth, WSL, and VPN interfaces.
   - `/ws` WebSocket hub (`github.com/coder/websocket`) runs a 15-second PING/PONG heartbeat measuring client RTT latency (`latency_ms`) and preserves turn order across mobile screen locks using `localStorage` (`dicebound_player_id`).
   - Turn order sorts players descending by `initiative` with sub-millisecond `created_at` tie-breaking (or manual DM drag-and-drop `turn_order`). Active players can trigger unlimited rolls across all 5 decision sets until clicking **Pasar Turno**.
3. **Cryptographic Decision Engines (`pkg/engine`):**
   - Zero `math/rand` imports (verified by `TestNoMathRandInEngine`). All draws use `crypto/rand.Int`.
   - **Set 1 (Polyhedral Dice):** `d2`, `d4`, `d6`, `d8`, `d10`, `d12`, `d20`, `d100`, full `NdX+M` expressions, Natural 20 (`is_critical`) and Natural 1 (`is_fumble`) flags.
   - **Set 2 (Realistic Coin):** `[0, 12000)` uniform draw: `val < 2` -> `CANTO` ($1/6000 \approx 0.0167\%$), `2..6000` -> `CARA` ($49.9917\%$), `6001..11999` -> `CRUZ` ($49.9917\%$). Validated by 600,000-iteration Monte Carlo test (`TestCoinMonteCarlo`).
   - **Set 3 (Magic 8 Ball):** 20 classic answers (10 affirmative, 5 neutral, 5 negative) + strict 50/50 Yes/No toggle.
   - **Set 4 (Customizable Peonza):** 6-face factory preset + customizable 4–12 faces, synchronized 2.5s rotation landing on the server-chosen face.
   - **Set 5 (Decision Wheel):** Dynamic 2–24 wedge SVG wheel landing on the server-chosen slice.
4. **HTML5 Canvas Tactical Map (`frontend/src/components/TacticalMapCanvas.tsx`):**
   - Renders $5 \times 5$ through $50 \times 50$ grid cells on a single `<canvas>` inside a `requestAnimationFrame` loop with pan, zoom, background image overlay, and grid coordinate math:
     $$X_{\text{grid}} = \left\lfloor \frac{px - O_x}{Z \cdot \text{CellW}} \right\rfloor, \quad Y_{\text{grid}} = \left\lfloor \frac{py - O_y}{Z \cdot \text{CellH}} \right\rfloor$$
   - Non-DM clients can only move their own `player_id` token; DM clients can move any token, toggle token visibility, or reset positions.
