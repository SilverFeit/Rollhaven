# Contributing to Dicebound

Thank you for contributing to **Dicebound**!

## Development Workflow

Requires Go 1.22+ (pure-Go SQLite via `modernc.org/sqlite` — zero CGO dependencies) and Node.js 20+:

```bash
# 1. Build React + TypeScript frontend and embed static assets
make build-frontend

# 2. Run all unit, Monte Carlo, and multi-client WebSocket tests
make test

# 3. Build Windows x64, macOS arm64/amd64, Dicebound.app & .dmg release artifacts
./Scripts/package_release.sh
```

## Pull Request Checklist
- [ ] `go vet ./...` and `go test -v -race ./...` pass completely.
- [ ] No `math/rand` imports inside `pkg/engine` (`TestNoMathRandInEngine` passes).
- [ ] Windows (`GOOS=windows GOARCH=amd64 CGO_ENABLED=0`) and macOS (`arm64` & `amd64`) cross-compilation succeed cleanly.
