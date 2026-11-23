.PHONY: all test build-frontend build-win build-mac package clean

APP_NAME=dicebound
VERSION=$(shell tr -d '[:space:]' < VERSION 2>/dev/null || echo "1.0.0")

all: clean build-frontend build-win build-mac

test:
	go vet ./...
	go test -v -race ./...

build-frontend:
	@echo "Compilando Frontend React..."
	cd frontend && npm install --no-audit --no-fund && npm run build
	rm -rf pkg/embed/frontend_dist/*
	cp -R frontend/dist/. pkg/embed/frontend_dist/

build-win:
	@echo "Compilando ejecutable para Windows (amd64)..."
	mkdir -p dist/bin
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="-s -w -X main.version=$(VERSION)" -o "dist/bin/$(APP_NAME)-windows-amd64.exe" ./cmd/app

build-mac:
	@echo "Compilando ejecutable para macOS (Apple Silicon arm64)..."
	mkdir -p dist/bin
	CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags="-s -w -X main.version=$(VERSION)" -o "dist/bin/$(APP_NAME)-mac-arm64" ./cmd/app
	@echo "Compilando ejecutable para macOS (Intel amd64)..."
	CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -trimpath -ldflags="-s -w -X main.version=$(VERSION)" -o "dist/bin/$(APP_NAME)-mac-amd64" ./cmd/app

package:
	./Scripts/package_release.sh $(VERSION)

clean:
	rm -rf frontend/dist
	rm -rf dist/*
