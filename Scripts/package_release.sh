#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/go/bin:${PATH}"

DEFAULT_VER="$(tr -d '[:space:]' < "${ROOT_DIR}/VERSION" 2>/dev/null || echo "1.2.0")"
VERSION="${1:-${DEFAULT_VER}}"

"${SCRIPT_DIR}/build_binaries.sh" "${VERSION}"

BIN_DIR="${ROOT_DIR}/dist/bin"
APP_BUNDLE="${ROOT_DIR}/dist/Rollhaven.app"
RELEASE_DIR="${ROOT_DIR}/dist/release"
DMG_STAGE="/tmp/RollhavenDMGStage"
WIN_STAGE="/tmp/RollhavenWinStage"

rm -rf "${RELEASE_DIR}" "${DMG_STAGE}" "${WIN_STAGE}"
mkdir -p "${RELEASE_DIR}" "${DMG_STAGE}" "${WIN_STAGE}"

# 1. Direct standalone binaries
cp "${BIN_DIR}/rollhaven-windows-amd64.exe" "${RELEASE_DIR}/rollhaven-windows-amd64.exe"
cp "${BIN_DIR}/rollhaven-mac-arm64" "${RELEASE_DIR}/rollhaven-mac-arm64"
cp "${BIN_DIR}/rollhaven-mac-amd64" "${RELEASE_DIR}/rollhaven-mac-amd64"

# 2. Windows ZIP bundle (exe + README + LICENSE)
cp "${BIN_DIR}/rollhaven-windows-amd64.exe" "${WIN_STAGE}/rollhaven.exe"
cp "${ROOT_DIR}/README.md" "${WIN_STAGE}/README.md"
cp "${ROOT_DIR}/LICENSE" "${WIN_STAGE}/LICENSE"
WIN_ZIP="Rollhaven-${VERSION}-windows-amd64.zip"
(cd "${WIN_STAGE}" && zip -q -r "${RELEASE_DIR}/${WIN_ZIP}" .)

# 3. macOS .app.zip & .dmg (when running on macOS)
MAC_APP_ZIP="Rollhaven-${VERSION}-macOS.app.zip"
MAC_DMG="Rollhaven-${VERSION}-macOS.dmg"
if [[ "$(uname -s)" == "Darwin" ]]; then
    ditto -c -k --norsrc --noextattr --keepParent "${APP_BUNDLE}" "${RELEASE_DIR}/${MAC_APP_ZIP}"

    ditto --norsrc --noextattr "${APP_BUNDLE}" "${DMG_STAGE}/Rollhaven.app"
    ln -s /Applications "${DMG_STAGE}/Applications"
    if [[ -f "${APP_BUNDLE}/Contents/Resources/AppIcon.icns" ]]; then
        cp "${APP_BUNDLE}/Contents/Resources/AppIcon.icns" "${DMG_STAGE}/.VolumeIcon.icns"
    fi
    hdiutil create \
        -volname "Rollhaven" \
        -srcfolder "${DMG_STAGE}" \
        -ov \
        -format UDZO \
        "${RELEASE_DIR}/${MAC_DMG}"
fi

rm -rf "${DMG_STAGE}" "${WIN_STAGE}"

(
    cd "${RELEASE_DIR}"
    if command -v shasum >/dev/null 2>&1; then
        shasum -a 256 * > SHA256SUMS.txt
    else
        sha256sum * > SHA256SUMS.txt
    fi
)

echo "Release artifacts ready in ${RELEASE_DIR}:"
cat "${RELEASE_DIR}/SHA256SUMS.txt"
