## Summary / Resumen

- **Module(s) Touched:** (`cmd/app`, `pkg/engine`, `pkg/server`, `pkg/store`, `pkg/network`, `frontend`, `Scripts`)

## Verification Checklist
- [ ] `go test -v -race ./...` passes (including `TestCoinMonteCarlo` and `TestNoMathRandInEngine`)
- [ ] Frontend compiles cleanly (`cd frontend && npm run build`)
- [ ] Cross-compilation succeeds (`GOOS=windows GOARCH=amd64`, `GOOS=darwin GOARCH=arm64`, `GOOS=darwin GOARCH=amd64`)
