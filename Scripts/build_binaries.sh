#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/go/bin:${PATH}"

DEFAULT_VER="$(tr -d '[:space:]' < "${ROOT_DIR}/VERSION" 2>/dev/null || echo "1.0.0")"
VERSION="${1:-${DEFAULT_VER}}"

BIN_DIR="${ROOT_DIR}/dist/bin"
EMBED_DIR="${ROOT_DIR}/pkg/embed/frontend_dist"

rm -rf "${BIN_DIR}"
mkdir -p "${BIN_DIR}" "${EMBED_DIR}"

echo "[1/5] Building React + TypeScript Frontend (frontend/)..."
(
    cd "${ROOT_DIR}/frontend"
    if [[ ! -d "node_modules" ]]; then
        npm install --no-audit --no-fund
    fi
    npm run build
)
rm -rf "${EMBED_DIR:?}"/*
cp -R "${ROOT_DIR}/frontend/dist/." "${EMBED_DIR}/"

echo "[2/5] Running Go Vet & Unit / Monte Carlo / WebSocket Tests..."
(
    cd "${ROOT_DIR}"
    go vet ./...
    go test -v -race ./...
)

echo "[3/5] Cross-compiling Windows x64 binary (dicebound-windows-amd64.exe)..."
(
    cd "${ROOT_DIR}"
    CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath \
        -ldflags="-s -w -X main.version=${VERSION}" \
        -o "${BIN_DIR}/dicebound-windows-amd64.exe" ./cmd/app
)

echo "[4/5] Cross-compiling macOS Apple Silicon (arm64) & Intel (amd64) binaries..."
(
    cd "${ROOT_DIR}"
    CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -trimpath \
        -ldflags="-s -w -X main.version=${VERSION}" \
        -o "${BIN_DIR}/dicebound-mac-arm64" ./cmd/app
    CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -trimpath \
        -ldflags="-s -w -X main.version=${VERSION}" \
        -o "${BIN_DIR}/dicebound-mac-amd64" ./cmd/app
)

echo "[5/5] Assembling macOS Universal App Bundle (Dicebound.app)..."
APP_BUNDLE="${ROOT_DIR}/dist/Dicebound.app"
STAGE_APP="/tmp/DiceboundAppStage.app"
rm -rf "${APP_BUNDLE}" "${STAGE_APP}"
mkdir -p "${STAGE_APP}/Contents/MacOS" "${STAGE_APP}/Contents/Resources"

# Create Universal macOS binary when lipo is available (on macOS runners), else copy arm64/amd64
if command -v lipo >/dev/null 2>&1; then
    lipo -create -output "${STAGE_APP}/Contents/MacOS/Dicebound" \
        "${BIN_DIR}/dicebound-mac-arm64" "${BIN_DIR}/dicebound-mac-amd64"
else
    cp "${BIN_DIR}/dicebound-mac-arm64" "${STAGE_APP}/Contents/MacOS/Dicebound"
fi
chmod 755 "${STAGE_APP}/Contents/MacOS/Dicebound"

if [[ -f "${ROOT_DIR}/Scripts/AppIcon.icns" ]]; then
    cp "${ROOT_DIR}/Scripts/AppIcon.icns" "${STAGE_APP}/Contents/Resources/AppIcon.icns"
fi

cat << EOF > "${STAGE_APP}/Contents/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>es</string>
    <key>CFBundleDisplayName</key>
    <string>Dicebound</string>
    <key>CFBundleExecutable</key>
    <string>Dicebound</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundleIdentifier</key>
    <string>com.silverfeit.dicebound</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>Dicebound</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>${VERSION}</string>
    <key>CFBundleVersion</key>
    <string>${VERSION}</string>
    <key>LSMinimumSystemVersion</key>
    <string>12.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSHumanReadableCopyright</key>
    <string>Released under the MIT License. Copyright © 2026 SilverFeit.</string>
</dict>
</plist>
EOF

if command -v codesign >/dev/null 2>&1; then
    xattr -cr "${STAGE_APP}" || true
    codesign --force --deep --sign - "${STAGE_APP}" || true
fi

cp -R "${STAGE_APP}" "${APP_BUNDLE}"
rm -rf "${STAGE_APP}"

echo "[✓] Build complete in ${BIN_DIR} and ${APP_BUNDLE}"
