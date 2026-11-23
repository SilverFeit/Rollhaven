# Security Policy (`SECURITY.md`)

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | :white_check_mark: |

## Security Architecture

1. **Cryptographic Randomness (`crypto/rand`):**
   - All dice rolls, coin flips (1/6000 edge odds), Magic 8 Ball draws, spinner results, and wheel selections execute exclusively on the Go host backend using `crypto/rand`. `math/rand` is prohibited in `pkg/engine` and verified by `TestNoMathRandInEngine`.
2. **Dungeon Master Access Control (`/dm`):**
   - Local loopback (`127.0.0.1` / `::1`) connections are auto-authorized on the host machine.
   - Remote LAN connections to `/dm`, `DM_OVERRIDE` WebSocket commands, DM notes, and map uploads require a random 4-digit per-session PIN generated via `crypto/rand` on startup.
3. **Upload & Path Traversal Hardening:**
   - Map and character sheet uploads enforce strict file extension whitelists (`.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`), size caps (10 MB for sheets, 25 MB for maps), sanitized filenames, and canonical directory prefix checks when serving `/uploads/*`.
4. **Token Ownership Enforcement:**
   - Non-DM WebSocket clients can only move their own `player_id` token on the tactical map.
